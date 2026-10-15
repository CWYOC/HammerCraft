import {quantity,dimensions} from './units.mjs';
import {cadFingerprint} from './cad-model.mjs';
import {faceSupport,normalizeFaceReference,resolveFaceReference} from './face-references.mjs';
import {inspectVolumeMesh,tetraMeasure} from './volume-mesh.mjs';
export const STRUCTURAL_SOLVER='hc-structural-fem-1';
export const STRUCTURAL_SETTINGS={id:STRUCTURAL_SOLVER,library:'scikit-fem',version:'12.0.2',linearSolver:'SciPy CG',scipy:'1.18.1',element:'VectorTetP1',relativeTolerance:1e-10,absoluteTolerance:1e-12,maxIterations:10000};
export const STRUCTURAL_RUST_SETTINGS={id:STRUCTURAL_SOLVER,library:'HammerCraft Rust',version:'0.1.0',linearSolver:'Jacobi CG',element:'VectorTetP1',relativeTolerance:1e-10,absoluteTolerance:1e-12,maxIterations:10000};
const force=[1,1,-2,0,0],acceleration=[1,0,-2,0,0];
const identity=v=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(v);
const expression=v=>{if(typeof v!=='string'||!v.trim()||v.length>512)throw Error('Invalid structural expression.');return v;};
const bounded=(v,lo,hi,label)=>{if(!Number.isFinite(v)||v<lo||v>hi)throw Error(`${label} must be ${lo}–${hi} in SI units.`);return v;};
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const equal=(a,b,abs=1e-8,rel=1e-6)=>Math.abs(a-b)<=abs+rel*Math.max(Math.abs(a),Math.abs(b));
export function resolveStructuralPhysics(input,values,bodyId){
  if(!input||!identity(input.id)||input.type!=='linear-elasticity'||input.bodyId!==bodyId||typeof input.geometryKey!=='string'||!input.geometryKey||input.geometryKey.length>2*1024*1024||!Array.isArray(input.support)||!input.support.length||input.support.length>25||input.support.some(s=>typeof s!=='string'||!/^[-\w.]+:[-\w]+$/.test(s)))throw Error('Invalid structural physics geometry reference.');
  if(!Array.isArray(input.boundaries)||input.boundaries.length>128)throw Error('Use at most 128 structural surface conditions.');
  function vector(v,dim,limit,partial=false){if(!Array.isArray(v)||v.length!==3||partial&&v.every(n=>n===null))throw Error('Provide three vector components; at least one displacement must be prescribed.');return v.map(n=>n===null&&partial?null:bounded(quantity(expression(n),dim,values),-limit,limit,'Vector component'));}
  const gravity=vector(input.gravity,acceleration,1e6),resolved=[];
  const boundaries=input.boundaries.map(b=>{
    const face=normalizeFaceReference(b.face),base={face,type:b.type};
    if(b.type==='fixed'){resolved.push(base);return base;}
    if(b.type==='displacement'||b.type==='force'){const v=vector(b.values,b.type==='force'?force:dimensions.length,b.type==='force'?1e12:1000,b.type==='displacement');resolved.push({...base,values:v});return {...base,values:[...b.values]};}
    if(b.type==='pressure'){resolved.push({...base,pressure:bounded(quantity(expression(b.expression),dimensions.pressure,values),-1e12,1e12,'Pressure')});return {...base,expression:b.expression};}
    throw Error('Unsupported structural surface condition.');
  });
  if(new Set(boundaries.map(b=>b.face.id)).size!==boundaries.length||new Set(boundaries.map(b=>JSON.stringify(b.face.anchor))).size!==boundaries.length)throw Error('Assign each CAD surface once.');
  return {source:{id:input.id,type:input.type,bodyId,geometryKey:input.geometryKey,support:[...input.support],boundaries,gravity:[...input.gravity]},boundaries:resolved,gravity};
}
export function structuralMaterial(model,gravity=[0,0,0]){
  const props=model.material.properties;
  const constant=(key,label,min,max,required=true)=>{const p=props[key];if(!p&&!required)return null;if(p?.type!=='constant')throw Error(`Structural analysis requires constant ${label} in the assigned material.`);return bounded(p.value,min,max,label);};
  const youngModulus=constant('youngModulus','Young’s modulus',1e3,1e13),poissonRatio=constant('poissonRatio','Poisson ratio',-.99,.49),yieldStrength=constant('yieldStrength','yield strength',1e-9,1e15,false);
  if(gravity.some(v=>v!==0)&&props.density.type!=='constant')throw Error('Gravity requires constant density; a reference density curve is insufficient.');
  return {youngModulus,poissonRatio,density:bounded(model.material.rho,1e-9,1e6,'Density'),yieldStrength};
}
export function structuralRequest(model,mesh){
  const p=model.source.physics.find(p=>p.type==='linear-elasticity');if(!p)throw Error('Create a static structural study first.');
  if(p.geometryKey!==cadFingerprint(model.source)||JSON.stringify(p.support)!==JSON.stringify(faceSupport(model.source)))throw Error('CAD geometry changed. Reselect structural surface conditions.');
  const physics=resolveStructuralPhysics(p,model.values,p.bodyId),material=structuralMaterial(model,physics.gravity);
  if(!physics.boundaries.some(b=>['fixed','displacement'].includes(b.type)))throw Error('Assign fixed or prescribed displacement surfaces to restrain the solid.');
  const boundaries=physics.boundaries.map(({face,...b})=>({tag:resolveFaceReference(face,mesh.boundary).tag,...b}));
  if(new Set(boundaries.map(b=>b.tag)).size!==boundaries.length)throw Error('Several conditions reference the same surface.');
  const request={kind:'structural-tetra',mesh,...material,gravity:physics.gravity,boundaries};prescribedDofs(request);return request;
}
export function prescribedDofs(request){
  const map=new Map();
  for(const bc of request.boundaries){if(!['fixed','displacement'].includes(bc.type))continue;const v=bc.type==='fixed'?[0,0,0]:bc.values;
    for(const n of request.mesh.boundary.find(g=>g.tag===bc.tag).triangles)for(let a=0;a<3;a++){if(v[a]===null)continue;const dof=n*3+a;if(map.has(dof)&&Math.abs(map.get(dof)-v[a])>1e-12)throw Error('Conflicting prescribed displacements meet at shared nodes.');map.set(dof,v[a]);}}
  return map;
}
// Independent small-strain reconstruction for validating returned fields.
export function cellStrain(points,displacements){
  const edges=points.slice(1).map(p=>sub(p,points[0])),six=dot(edges[0],cross(edges[1],edges[2]));
  const bases=[cross(edges[1],edges[2]),cross(edges[2],edges[0]),cross(edges[0],edges[1])].map(v=>v.map(x=>x/six));
  const grad=Array.from({length:3},(_,a)=>Array.from({length:3},(_,b)=>bases.reduce((s,g,j)=>s+(displacements[j+1][a]-displacements[0][a])*g[b],0)));
  return [grad[0][0],grad[1][1],grad[2][2],(grad[0][1]+grad[1][0])/2,(grad[1][2]+grad[2][1])/2,(grad[0][2]+grad[2][0])/2];
}
export function elasticStress(strain,E,nu){const mu=E/(2*(1+nu)),lam=E*nu/((1+nu)*(1-2*nu)),trace=strain[0]+strain[1]+strain[2];return strain.map((e,i)=>2*mu*e+(i<3?lam*trace:0));}
export const vonMises=s=>Math.sqrt(((s[0]-s[1])**2+(s[1]-s[2])**2+(s[2]-s[0])**2)/2+3*(s[3]**2+s[4]**2+s[5]**2));
export function structuralLoads(request,origin){
  const {mesh}=request,total=[0,0,0],moment=[0,0,0];
  const add=(f,p)=>{for(let a=0;a<3;a++)total[a]+=f[a];const m=cross(sub(p,origin),f);for(let a=0;a<3;a++)moment[a]+=m[a];};
  for(let i=0;i<mesh.tetrahedra.length;i+=4){const ps=mesh.tetrahedra.slice(i,i+4).map(n=>mesh.nodes.slice(n*3,n*3+3)),volume=tetraMeasure(ps).volume;add(request.gravity.map(g=>g*request.density*volume),[0,1,2].map(a=>ps.reduce((s,p)=>s+p[a],0)/4));}
  for(const b of request.boundaries){if(!['force','pressure'].includes(b.type))continue;const g=mesh.boundary.find(g=>g.tag===b.tag),faces=[];let area=0;
    for(let i=0;i<g.triangles.length;i+=3){const p=g.triangles.slice(i,i+3).map(n=>mesh.nodes.slice(n*3,n*3+3)),vector=cross(sub(p[1],p[0]),sub(p[2],p[0])).map(v=>v/2),a=Math.hypot(...vector);area+=a;faces.push({vector,area:a,center:[0,1,2].map(a=>p.reduce((s,n)=>s+n[a],0)/3)});}
    for(const f of faces)add(b.type==='force'?b.values.map(v=>v*f.area/area):f.vector.map(v=>-b.pressure*v),f.center);
  }
  return {force:total,moment};
}
// Consistent nodal loads for independent equilibrium checks, including reactions at restrained DOFs.
export function structuralNodalLoads(request){
  const {mesh}=request,loads=new Float64Array(mesh.nodes.length);
  for(let i=0;i<mesh.tetrahedra.length;i+=4){const ids=mesh.tetrahedra.slice(i,i+4),volume=tetraMeasure(ids.map(n=>mesh.nodes.slice(n*3,n*3+3))).volume;for(const n of ids)for(let a=0;a<3;a++)loads[n*3+a]+=request.gravity[a]*request.density*volume/4;}
  for(const b of request.boundaries){if(!['force','pressure'].includes(b.type))continue;const g=mesh.boundary.find(g=>g.tag===b.tag),faces=[];let area=0;
    for(let i=0;i<g.triangles.length;i+=3){const ids=g.triangles.slice(i,i+3),p=ids.map(n=>mesh.nodes.slice(n*3,n*3+3)),vector=cross(sub(p[1],p[0]),sub(p[2],p[0])).map(v=>v/2),a=Math.hypot(...vector);area+=a;faces.push({ids,vector,area:a});}
    for(const f of faces)for(const n of f.ids)for(let a=0;a<3;a++)loads[n*3+a]+=(b.type==='force'?b.values[a]*f.area/area:-b.pressure*f.vector[a])/3;
  }return loads;
}

export function validateStructuralRecord(input,validateSource,imported=false){
  const p=input?.provenance,r=input?.solution;
  if(!identity(input?.id)||!identity(p?.projectId)||!identity(p.meshId)||!Number.isSafeInteger(p.revision)||p.revision<0||!Number.isFinite(Date.parse(p.createdAt)))throw Error('Invalid structural result provenance.');
  const model=validateSource(p.source);if(p.fingerprint!==JSON.stringify(model.source))throw Error('Structural source fingerprint differs.');
  const {mesh,stats}=inspectVolumeMesh(input.mesh),request=structuralRequest(model,mesh),fixed=prescribedDofs(request);
  const settings=[STRUCTURAL_SETTINGS,STRUCTURAL_RUST_SETTINGS].find(s=>r?.solver&&Object.entries(s).every(([k,v])=>r.solver[k]===v));
  if(!settings)throw Error('Unsupported structural solver metadata.');
  for(const [key,count] of [['displacements',stats.nodes*3],['reactions',stats.nodes*3],['strains',stats.elements*6],['stresses',stats.elements*6],['principal',stats.elements*3],['vonMises',stats.elements]])if(!Array.isArray(r[key])||r[key].length!==count||r[key].some(v=>!Number.isFinite(v)))throw Error('Invalid structural field size or value.');
  if(!Number.isInteger(r.iterations)||r.iterations<0||r.iterations>10000||!Number.isFinite(r.residual)||r.residual<0||r.residual>1e-7)throw Error('Invalid structural convergence.');
  for(let i=0;i<r.displacements.length;i++){if(fixed.has(i)&&!equal(r.displacements[i],fixed.get(i),1e-12,1e-7))throw Error('Result violates displacement constraints.');if(!fixed.has(i)&&r.reactions[i]!==0)throw Error('Reaction is assigned to a free DOF.');}
  const origin=[0,0,0];for(let i=0;i<mesh.nodes.length;i++)origin[i%3]+=mesh.nodes[i]/stats.nodes;
  const nodalLoads=structuralNodalLoads(request),internal=new Float64Array(mesh.nodes.length);
  let energy=0,maxStrain=0,maxDisp=0;const forceR=[0,0,0],momentR=[0,0,0];
  for(let i=0;i<stats.nodes;i++){maxDisp=Math.max(maxDisp,Math.hypot(...r.displacements.slice(i*3,i*3+3)));const f=r.reactions.slice(i*3,i*3+3),m=cross(sub(mesh.nodes.slice(i*3,i*3+3),origin),f);for(let a=0;a<3;a++){forceR[a]+=f[a];momentR[a]+=m[a];}}
  for(let i=0;i<stats.elements;i++){
    const ids=mesh.tetrahedra.slice(i*4,i*4+4),points=ids.map(n=>mesh.nodes.slice(n*3,n*3+3)),strain=cellStrain(points,ids.map(n=>r.displacements.slice(n*3,n*3+3))),stress=elasticStress(strain,request.youngModulus,request.poissonRatio);
    if(strain.some((v,j)=>!equal(v,r.strains[i*6+j],1e-10))||stress.some((v,j)=>!equal(v,r.stresses[i*6+j],1e-3)))throw Error('Stress/strain is inconsistent with displacement or Hooke’s law.');
    if(!equal(vonMises(stress),r.vonMises[i],1e-3)||r.vonMises[i]<0)throw Error('Invalid von Mises stress.');
    const principal=r.principal.slice(i*3,i*3+3),norm=Math.max(1,...stress.map(Math.abs)),s=stress.map(v=>v/norm),e=principal.map(v=>v/norm);
    if(principal[0]<principal[1]||principal[1]<principal[2]||!equal(e.reduce((a,b)=>a+b,0),s[0]+s[1]+s[2],1e-6)||!equal(e.reduce((a,b)=>a+b*b,0),s[0]**2+s[1]**2+s[2]**2+2*(s[3]**2+s[4]**2+s[5]**2),1e-6)||!equal(e[0]*e[1]*e[2],s[0]*s[1]*s[2]+2*s[3]*s[4]*s[5]-s[0]*s[4]**2-s[1]*s[5]**2-s[2]*s[3]**2,1e-6))throw Error('Principal stresses do not match the stress tensor.');
    const mu=request.youngModulus/(2*(1+request.poissonRatio)),lam=request.youngModulus*request.poissonRatio/((1+request.poissonRatio)*(1-2*request.poissonRatio));
    for(const sigma of principal)maxStrain=Math.max(maxStrain,Math.abs((sigma-lam*(strain[0]+strain[1]+strain[2]))/(2*mu)));
    energy+=.5*strain.reduce((sum,v,j)=>sum+v*stress[j]*(j<3?1:2),0)*tetraMeasure(points).volume;
    const edges=points.slice(1).map(p=>sub(p,points[0])),six=dot(edges[0],cross(edges[1],edges[2])),gradients=[cross(edges[1],edges[2]),cross(edges[2],edges[0]),cross(edges[0],edges[1])].map(v=>v.map(x=>x/six));gradients.unshift([0,1,2].map(a=>-gradients.reduce((sum,g)=>sum+g[a],0)));
    ids.forEach((n,j)=>{const [x,y,z]=gradients[j],f=[stress[0]*x+stress[3]*y+stress[5]*z,stress[3]*x+stress[1]*y+stress[4]*z,stress[5]*x+stress[4]*y+stress[2]*z];for(let a=0;a<3;a++)internal[n*3+a]+=f[a]*six/6;});
  }
  let freeResidual2=0,loadScale2=0;
  for(let i=0;i<internal.length;i++){loadScale2+=internal[i]**2+nodalLoads[i]**2;if(fixed.has(i)){if(!equal(internal[i]-nodalLoads[i],r.reactions[i],1e-6,2e-5))throw Error('Structural reactions do not match internal forces and applied nodal loads.');}else freeResidual2+=(internal[i]-nodalLoads[i])**2;}
  if(Math.sqrt(freeResidual2)>1e-8+2e-5*Math.sqrt(loadScale2))throw Error('Structural field does not satisfy free-node equilibrium.');
  const applied=structuralLoads(request,origin),span=Math.hypot(...stats.bounds[1].map((v,i)=>v-stats.bounds[0][i]));
  if(!equal(energy,r.strainEnergy,1e-12)||r.strainEnergy<0||!equal(maxStrain,r.maxStrain,1e-10)||!equal(maxDisp/span,r.maxDisplacementRatio,1e-12))throw Error('Structural energy or displacement summary differs.');
  const expected={origin,appliedForce:applied.force,reactionForce:forceR,appliedMoment:applied.moment,reactionMoment:momentR};
  for(const [k,values]of Object.entries(expected))if(!Array.isArray(r.balance?.[k])||r.balance[k].length!==3||values.some((v,j)=>!equal(v,r.balance[k][j],k.includes('Moment')?1e-8:1e-6)))throw Error('Structural force/moment accounting differs.');
  const scale=Math.max(1e-9,...applied.force.map(Math.abs),r.reactions.reduce((s,v)=>s+Math.abs(v),0));
  if(forceR.some((v,i)=>Math.abs(v+applied.force[i])>1e-6*scale)||momentR.some((v,i)=>Math.abs(v+applied.moment[i])>1e-6*scale*span))throw Error('Structural equilibrium failed.');
  const solution={solver:{...settings}};for(const k of ['displacements','reactions','strains','stresses','principal','vonMises'])solution[k]=r[k].map(v=>v||0);
  Object.assign(solution,{iterations:r.iterations,residual:r.residual,strainEnergy:r.strainEnergy,maxStrain:r.maxStrain,maxDisplacementRatio:r.maxDisplacementRatio,balance:expected});
  return {id:input.id,provenance:{projectId:p.projectId,revision:p.revision,createdAt:p.createdAt,meshId:p.meshId,fingerprint:p.fingerprint,source:model.source},mesh,solution,verified:!imported&&input.verified===true};
}
export function structuralCSV(record){const {mesh:m,solution:r}=record,lines=['node,x_m,y_m,z_m,ux_m,uy_m,uz_m,reaction_x_N,reaction_y_N,reaction_z_N'];for(let i=0;i<m.nodes.length/3;i++)lines.push([i,...m.nodes.slice(i*3,i*3+3),...r.displacements.slice(i*3,i*3+3),...r.reactions.slice(i*3,i*3+3)].join(','));return lines.join('\n')+'\n';}
export function structuralVTK(record){
  const {mesh:m,solution:r}=record,n=m.nodes.length/3,e=m.tetrahedra.length/4,lines=['# vtk DataFile Version 3.0','HammerCraft static elasticity; SI; tensor shear strains','ASCII','DATASET UNSTRUCTURED_GRID',`POINTS ${n} double`];
  const vectors=(name,data)=>{lines.push(`VECTORS ${name} double`);for(let i=0;i<data.length;i+=3)lines.push(data.slice(i,i+3).join(' '));};
  for(let i=0;i<n;i++)lines.push(m.nodes.slice(i*3,i*3+3).join(' '));lines.push(`CELLS ${e} ${e*5}`);for(let i=0;i<e;i++)lines.push('4 '+m.tetrahedra.slice(i*4,i*4+4).join(' '));lines.push(`CELL_TYPES ${e}`);for(let i=0;i<e;i++)lines.push('10');lines.push(`POINT_DATA ${n}`);vectors('displacement_m',r.displacements);vectors('reaction_N',r.reactions);lines.push(`CELL_DATA ${e}`,'SCALARS von_Mises_Pa double 1','LOOKUP_TABLE default');for(const v of r.vonMises)lines.push(String(v));
  for(const [label,key]of [['stress_Pa','stresses'],['strain','strains']]){lines.push(`TENSORS ${label} double`);for(let i=0;i<e;i++){const a=r[key].slice(i*6,i*6+6);lines.push(`${a[0]} ${a[3]} ${a[5]}`,`${a[3]} ${a[1]} ${a[4]}`,`${a[5]} ${a[4]} ${a[2]}`);}}
  return lines.join('\n')+'\n';
}
