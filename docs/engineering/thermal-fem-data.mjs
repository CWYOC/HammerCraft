import {cadFingerprint} from './cad-model.mjs';
import {quantity,dimensions} from './units.mjs';
import {faceSupport,normalizeFaceReference,resolveFaceReference} from './face-references.mjs';
import {inspectVolumeMesh,tetraMeasure} from './volume-mesh.mjs';
export const FEM_SOLVER='hc-thermal-fem-1';
export const FEM_SETTINGS={id:FEM_SOLVER,library:'scikit-fem',version:'12.0.2',linearSolver:'SciPy CG',scipy:'1.18.1',element:'TetP1',relativeTolerance:1e-10,absoluteTolerance:1e-12,maxIterations:5000};
export const FEM_RUST_SETTINGS={id:FEM_SOLVER,library:'HammerCraft Rust',version:'0.1.0',linearSolver:'Jacobi CG',element:'TetP1',relativeTolerance:1e-10,absoluteTolerance:1e-12,maxIterations:5000};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(v);
const expr=v=>{if(typeof v!=='string'||v.length>512||!v.trim())throw Error('Invalid thermal expression.');return v;};
const bounded=(v,lo,hi,label)=>{if(!Number.isFinite(v)||v<lo||v>hi)throw Error(`${label} is outside supported limits.`);return v;};
export function resolveFemPhysics(input,values,bodyId){
  if(!input||!id(input.id)||input.type!=='heat-conduction-tetra'||input.bodyId!==bodyId||!Array.isArray(input.support)||!input.support.length||input.support.length>25||input.support.some(s=>typeof s!=='string'||!/^[-\w.]+:[-\w]+$/.test(s)))throw Error('Invalid CAD thermal physics or feature support.');
  if(!Array.isArray(input.boundaries)||input.boundaries.length>128)throw Error('Use at most 128 CAD surface conditions.');
  const boundaries=input.boundaries.map(b=>{
    const face=normalizeFaceReference(b.face);
    if(b.type==='temperature')return {face,type:b.type,expression:expr(b.expression)};
    if(b.type==='convection')return {face,type:b.type,ambient:expr(b.ambient),coefficient:expr(b.coefficient)};
    throw Error('Choose fixed temperature or convection. Unassigned surfaces are insulated.');
  });
  if(new Set(boundaries.map(b=>b.face.id)).size!==boundaries.length||new Set(boundaries.map(b=>JSON.stringify(b.face.anchor))).size!==boundaries.length)throw Error('Assign each CAD surface only once.');
  const resolved=boundaries.map(b=>({face:b.face,type:b.type,...(b.type==='temperature'?{temperature:bounded(quantity(b.expression,dimensions.temperature,values),0,5000,'Temperature')}:{ambient:bounded(quantity(b.ambient,dimensions.temperature,values),0,5000,'Ambient temperature'),coefficient:bounded(quantity(b.coefficient,dimensions.heatTransfer,values),1e-6,1e8,'Convection coefficient')})}));
  if(input.geometryKey!==undefined&&(typeof input.geometryKey!=='string'||!input.geometryKey||input.geometryKey.length>2*1024*1024))throw Error('Invalid CAD physics geometry identity.');
  const source={id:input.id,type:input.type,bodyId,...(input.geometryKey===undefined?{}:{geometryKey:input.geometryKey}),support:[...input.support],boundaries,heatGeneration:expr(input.heatGeneration)};
  return {source,boundaries:resolved,heatGeneration:bounded(quantity(input.heatGeneration,dimensions.heatSource,values),-1e12,1e12,'Heat generation')};
}
export function femRequest(model,mesh,{historical=false}={}){
  const p=model.source.physics.find(p=>p.type==='heat-conduction-tetra');if(!p)throw Error('Create a CAD thermal study first.');
  if(JSON.stringify(p.support)!==JSON.stringify(faceSupport(model.source)))throw Error('The feature sequence changed. Reselect the CAD surface conditions.');
  if((!historical||p.geometryKey!==undefined)&&p.geometryKey!==cadFingerprint(model.source))throw Error('CAD geometry changed. Review and reselect surface conditions for this solid.');
  const physics=resolveFemPhysics(p,model.values,model.source.features[0].bodyId);
  if(!physics.boundaries.length)throw Error('Assign at least one temperature or convection surface.');
  if(model.material.k===null)throw Error('CAD thermal solving requires constant isotropic conductivity. Temperature-dependent conductivity is not implemented.');
  const boundaries=physics.boundaries.map(({face,...bc})=>({tag:resolveFaceReference(face,mesh.boundary).tag,...bc}));
  if(new Set(boundaries.map(b=>b.tag)).size!==boundaries.length)throw Error('Several conditions resolve to one surface. Reselect boundaries.');
  const prescribed=new Map();for(const b of boundaries)if(b.type==='temperature')for(const n of mesh.boundary.find(g=>g.tag===b.tag).triangles){if(prescribed.has(n)&&Math.abs(prescribed.get(n)-b.temperature)>1e-8)throw Error('Different fixed temperatures meet at shared nodes. Select non-touching surfaces or equal temperatures.');prescribed.set(n,b.temperature);}
  return {kind:'thermal-tetra',mesh,conductivity:bounded(model.material.k,1e-6,1e6,'Constant conductivity (1e-6–1e6 W/(m·K))'),heatGeneration:physics.heatGeneration,boundaries};
}
export function validateFemRecord(input,validateSource,imported=false){
  const p=input?.provenance;
  if(!id(input?.id)||!id(p?.projectId)||!id(p.meshId)||!Number.isSafeInteger(p.revision)||p.revision<0||!Number.isFinite(Date.parse(p.createdAt)))throw Error('Invalid CAD thermal result provenance.');
  const model=validateSource(p.source);
  if(p.fingerprint!==JSON.stringify(model.source))throw Error('CAD thermal source fingerprint differs.');
  const {mesh,stats}=inspectVolumeMesh(input.mesh),request=femRequest(model,mesh,{historical:true}),r=input.solution;
  if(!r||!r.solver||[FEM_SETTINGS,FEM_RUST_SETTINGS].every(settings=>Object.entries(settings).some(([k,v])=>r.solver[k]!==v)))throw Error('Unsupported FEM solver settings.');
  for(const [key,count] of [['temperatures',stats.nodes],['gradients',stats.elements*3],['heatFlux',stats.elements*3]])if(!Array.isArray(r[key])||r[key].length!==count||r[key].some(v=>!Number.isFinite(v)))throw Error('FEM field size or values differ from the mesh.');
  if(r.temperatures.some(t=>t<0||t>1e7)||!Number.isInteger(r.iterations)||r.iterations<0||r.iterations>5000||!Number.isFinite(r.residual)||r.residual<0||r.residual>1e-7)throw Error('Invalid FEM convergence or temperature.');
  for(const b of request.boundaries)if(b.type==='temperature')for(const n of mesh.boundary.find(g=>g.tag===b.tag).triangles)if(Math.abs(r.temperatures[n]-b.temperature)>1e-6)throw Error('Result violates prescribed surface temperature.');
  let weighted=0;
  for(let i=0;i<mesh.tetrahedra.length;i+=4){
    const ns=mesh.tetrahedra.slice(i,i+4),points=ns.map(n=>mesh.nodes.slice(n*3,n*3+3));const {volume}=tetraMeasure(points);
    weighted+=volume*ns.reduce((s,n)=>s+r.temperatures[n],0)/4;
    const gradient=r.gradients.slice(i/4*3,i/4*3+3);
    for(let j=1;j<4;j++){const delta=points[j].map((v,k)=>v-points[0][k]),predicted=delta.reduce((s,v,k)=>s+v*gradient[k],0),actual=r.temperatures[ns[j]]-r.temperatures[ns[0]];if(Math.abs(predicted-actual)>1e-6*Math.max(1,Math.abs(actual)))throw Error('Temperature gradient is inconsistent with nodal values.');}
    for(let j=0;j<3;j++)if(Math.abs(r.heatFlux[i/4*3+j]+request.conductivity*gradient[j])>1e-7*Math.max(1,Math.abs(r.heatFlux[i/4*3+j])))throw Error('Heat flux is inconsistent with conductivity.');
  }
  const balance=r.balance;if(!balance||['generated','fixedOutward','convectionOutward','error'].some(k=>!Number.isFinite(balance[k])))throw Error('Missing heat balance.');
  const scale=Math.max(1,...Object.values(balance).map(Math.abs));
  if(Math.abs(balance.generated-request.heatGeneration*stats.volume)>1e-8*scale||Math.abs(balance.error)>1e-7*scale||Math.abs(balance.fixedOutward+balance.convectionOutward-balance.generated-balance.error)>1e-8*scale)throw Error('Heat balance does not match the solved source.');
  if(!Number.isFinite(r.volumeMeanTemperature)||Math.abs(r.volumeMeanTemperature-weighted/stats.volume)>1e-6)throw Error('Volume mean differs from nodal temperatures.');
  return {id:input.id,provenance:{projectId:p.projectId,revision:p.revision,createdAt:p.createdAt,meshId:p.meshId,fingerprint:p.fingerprint,source:model.source},mesh,solution:{solver:{...(r.solver.library==='HammerCraft Rust'?FEM_RUST_SETTINGS:FEM_SETTINGS)},temperatures:r.temperatures.map(v=>v||0),gradients:r.gradients.map(v=>v||0),heatFlux:r.heatFlux.map(v=>v||0),iterations:r.iterations,residual:r.residual,balance:{generated:balance.generated||0,fixedOutward:balance.fixedOutward||0,convectionOutward:balance.convectionOutward||0,error:balance.error||0},volumeMeanTemperature:r.volumeMeanTemperature},verified:!imported&&input.verified===true};
}
export function femCSV(record){
  const lines=['node,x_m,y_m,z_m,temperature_K'];for(let i=0;i<record.mesh.nodes.length/3;i++)lines.push([i,...record.mesh.nodes.slice(i*3,i*3+3),record.solution.temperatures[i]].join(','));return lines.join('\n')+'\n';
}
export function femVTK(record){
  const {mesh:m,solution:r}=record,n=m.nodes.length/3,e=m.tetrahedra.length/4,lines=['# vtk DataFile Version 3.0','HammerCraft CAD thermal solution; SI units','ASCII','DATASET UNSTRUCTURED_GRID',`POINTS ${n} double`];
  for(let i=0;i<n;i++)lines.push(m.nodes.slice(i*3,i*3+3).join(' '));lines.push(`CELLS ${e} ${e*5}`);for(let i=0;i<e;i++)lines.push('4 '+m.tetrahedra.slice(i*4,i*4+4).join(' '));lines.push(`CELL_TYPES ${e}`);for(let i=0;i<e;i++)lines.push('10');lines.push(`POINT_DATA ${n}`,'SCALARS temperature_K double 1','LOOKUP_TABLE default');for(const t of r.temperatures)lines.push(String(t));lines.push(`CELL_DATA ${e}`,'VECTORS heat_flux_W_m2 double');for(let i=0;i<e;i++)lines.push(r.heatFlux.slice(i*3,i*3+3).join(' '));lines.push('VECTORS temperature_gradient_K_m double');for(let i=0;i<e;i++)lines.push(r.gradients.slice(i*3,i*3+3).join(' '));return lines.join('\n')+'\n';
}
