import {cadFingerprint} from './cad-model.mjs';
import {faceSupport,resolveFaceReference} from './face-references.mjs';
import {resolveStructuralPhysics,prescribedDofs,elasticStress} from './structural-fem-data.mjs';
import {inspectVolumeMesh} from './volume-mesh.mjs';
export const MODAL_SOLVER='hc-modal-fem-1';
export const MODAL_SETTINGS={id:MODAL_SOLVER,library:'scikit-fem',version:'12.0.2',eigensolver:'SciPy eigsh',scipy:'1.18.1',element:'VectorTetP1',mass:'consistent',relativeTolerance:1e-9,maxIterations:10000,normalization:'peak-node-magnitude'};
export function modalCount(value){if(!Number.isInteger(value)||value<1||value>12)throw Error('Request 1–12 modes, including rigid-body modes.');return value;}
export function resolveModalPhysics(input,values,bodyId){
  if(input?.type!=='elastic-vibration')throw Error('Invalid vibration physics.');
  const result=resolveStructuralPhysics({...input,type:'linear-elasticity',gravity:['0 m/s^2','0 m/s^2','0 m/s^2']},values,bodyId);
  if(result.boundaries.some(b=>!['fixed','displacement'].includes(b.type)||b.type==='displacement'&&b.values.some(v=>v!==null&&v!==0)))throw Error('Natural modes support fixed or zero-component displacement restraints only.');
  delete result.source.gravity;result.source.type='elastic-vibration';return result;
}
export function modalMaterial(model,analysis='Eigenfrequency'){
  const constant=(key,label,min,max)=>{const p=model.material.properties[key];if(p?.type!=='constant')throw Error(`${analysis} analysis requires constant ${label}.`);if(!Number.isFinite(p.value)||p.value<min||p.value>max)throw Error(`${label} is outside the supported modal range.`);return p.value;};
  return {youngModulus:constant('youngModulus','Young’s modulus',1e3,1e13),poissonRatio:constant('poissonRatio','Poisson ratio',-.99,.49),density:constant('density','density',1e-9,1e6)};
}
export function modalRequest(model,mesh){
  const p=model.source.physics.find(p=>p.type==='elastic-vibration'),study=model.source.studies.find(s=>s.solverId===MODAL_SOLVER);
  if(!p||!study)throw Error('Create an eigenfrequency study first.');
  if(p.geometryKey!==cadFingerprint(model.source)||JSON.stringify(p.support)!==JSON.stringify(faceSupport(model.source)))throw Error('CAD geometry changed. Reselect modal restraint surfaces.');
  if(mesh.nodes.length/3>10000||mesh.tetrahedra.length/4>40000)throw Error('Eigenfrequency studies support at most 10,000 nodes and 40,000 tetrahedra.');
  const physics=resolveModalPhysics(p,model.values,p.bodyId),boundaries=physics.boundaries.map(({face,...b})=>({tag:resolveFaceReference(face,mesh.boundary).tag,...b}));
  if(new Set(boundaries.map(b=>b.tag)).size!==boundaries.length)throw Error('Several modal restraints reference the same surface.');
  const q={kind:'modal-tetra',mesh,...modalMaterial(model),modeCount:modalCount(study.modeCount),boundaries};
  if(q.modeCount>=mesh.nodes.length-prescribedDofs(q).size)throw Error('Request fewer modes than the free displacement DOFs.');return q;
}
const sub=(a,b)=>a.map((v,i)=>v-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const equal=(a,b,abs=1e-10,rel=1e-6)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=abs+rel*Math.max(Math.abs(a),Math.abs(b));
export function rigidModeCount(mesh,fixed){
  const n=mesh.nodes.length/3,origin=[0,0,0],bounds=[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]];
  mesh.nodes.forEach((v,i)=>{origin[i%3]+=v/n;bounds[0][i%3]=Math.min(bounds[0][i%3],v);bounds[1][i%3]=Math.max(bounds[1][i%3],v);});
  const span=Math.hypot(...sub(bounds[1],bounds[0])),basis=[];
  for(const dof of fixed.keys()){
    const a=dof%3,node=Math.floor(dof/3),p=sub(mesh.nodes.slice(node*3,node*3+3),origin).map(v=>v/span),row=[0,0,0,...[[0,-p[2],p[1]],[p[2],0,-p[0]],[-p[1],p[0],0]].map(r=>r[a])];row[a]=1;
    for(let pass=0;pass<2;pass++)for(const b of basis){const c=dot(row,b);for(let j=0;j<6;j++)row[j]-=c*b[j];}
    const norm=Math.hypot(...row);if(norm>1e-10)basis.push(row.map(v=>v/norm));if(basis.length===6)break;
  }return 6-basis.length;
}
// Independent element integration; no imported matrices or reported modal summaries are trusted.
export function modalElements(mesh){
  const cells=[];for(let i=0;i<mesh.tetrahedra.length;i+=4){const ids=mesh.tetrahedra.slice(i,i+4),p=ids.map(n=>mesh.nodes.slice(n*3,n*3+3)),e=p.slice(1).map(q=>sub(q,p[0])),six=dot(e[0],cross(e[1],e[2])),g=[cross(e[1],e[2]),cross(e[2],e[0]),cross(e[0],e[1])].map(v=>v.map(n=>n/six));g.unshift([0,1,2].map(a=>-g.reduce((s,v)=>s+v[a],0)));cells.push({ids,g,volume:six/6});}return cells;
}
export function integrateMode(shape,cells,material){
  const stiffness=new Float64Array(shape.length),mass=new Float64Array(shape.length);let energy2=0;
  for(const {ids,g,volume}of cells){
    const u=ids.map(n=>shape.slice(n*3,n*3+3)),gradient=Array.from({length:3},(_,a)=>[0,1,2].map(b=>u.reduce((s,v,j)=>s+v[a]*g[j][b],0))),e=[gradient[0][0],gradient[1][1],gradient[2][2],(gradient[0][1]+gradient[1][0])/2,(gradient[1][2]+gradient[2][1])/2,(gradient[0][2]+gradient[2][0])/2],s=elasticStress(e,material.youngModulus,material.poissonRatio),sum=[0,1,2].map(a=>u.reduce((v,p)=>v+p[a],0));
    energy2+=volume*e.reduce((t,v,j)=>t+v*s[j]*(j<3?1:2),0);
    ids.forEach((n,j)=>{const [x,y,z]=g[j],force=[s[0]*x+s[3]*y+s[5]*z,s[3]*x+s[1]*y+s[4]*z,s[5]*x+s[4]*y+s[2]*z];for(let a=0;a<3;a++){stiffness[n*3+a]+=volume*force[a];mass[n*3+a]+=material.density*volume/20*(sum[a]+u[j][a]);}});
  }return {stiffness,mass,energy2};
}
export function validateModalRecord(input,validateSource,imported=false){
  const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(v),p=input?.provenance,s=input?.solution;
  if(!validId(input?.id)||!validId(p?.projectId)||!validId(p?.meshId)||!Number.isSafeInteger(p.revision)||p.revision<0||!Number.isFinite(Date.parse(p.createdAt)))throw Error('Invalid modal provenance.');
  const model=validateSource(p.source);if(p.fingerprint!==JSON.stringify(model.source))throw Error('Modal source fingerprint differs.');
  const {mesh,stats}=inspectVolumeMesh(input.mesh),q=modalRequest(model,mesh),fixed=prescribedDofs(q),rigid=rigidModeCount(mesh,fixed),span=Math.hypot(...sub(stats.bounds[1],stats.bounds[0])),characteristic=q.youngModulus/q.density/span**2;
  if(!s||Object.entries(MODAL_SETTINGS).some(([k,v])=>s.solver?.[k]!==v)||!Array.isArray(s.modes)||s.modes.length!==q.modeCount)throw Error('Unsupported modal solver or mode count.');
  if(s.rigidModes!==rigid||s.freeDofs!==mesh.nodes.length-fixed.size||!equal(s.totalMass,stats.volume*q.density)||!equal(s.shift,-1e-6*characteristic)||!Number.isFinite(s.orthogonality)||s.orthogonality<0||s.orthogonality>1e-6)throw Error('Modal system summary differs.');
  const cells=modalElements(mesh),massVectors=[],modes=[];let previous=-Infinity,orthogonality=0;
  for(let index=0;index<s.modes.length;index++){
    const m=s.modes[index];if(!Array.isArray(m.shape)||m.shape.length!==mesh.nodes.length||m.shape.some(v=>!Number.isFinite(v))||!Number.isFinite(m.eigenvalue)||m.eigenvalue<0||m.eigenvalue<previous||m.rigid!==(index<rigid)||m.rigid&&m.eigenvalue!==0||!m.rigid&&m.eigenvalue<=0)throw Error('Invalid modal field, ordering or rigid mode.');previous=m.eigenvalue;
    if(!equal(m.frequency,Math.sqrt(m.eigenvalue)/(2*Math.PI),1e-8)||!Number.isFinite(m.residual)||m.residual<0||m.residual>1e-8)throw Error('Invalid modal frequency or convergence.');
    let peak=0,largest=0;for(let i=0;i<m.shape.length;i+=3)peak=Math.max(peak,Math.hypot(...m.shape.slice(i,i+3)));m.shape.forEach((v,i)=>{if(Math.abs(v)>Math.abs(m.shape[largest]))largest=i;});
    if(!equal(peak,1,1e-8)||m.shape[largest]<0||[...fixed.keys()].some(i=>m.shape[i]!==0))throw Error('Invalid modal normalization or restraint displacement.');
    const integrated=integrateMode(m.shape,cells,q),mass=dot(m.shape,integrated.mass),participation=[0,0,0];let residual2=0,k2=0,b2=0;
    for(let i=0;i<m.shape.length;i++){participation[i%3]+=integrated.mass[i]/mass;if(!fixed.has(i)){const a=integrated.stiffness[i],b=m.eigenvalue*integrated.mass[i];residual2+=(a-b)**2;k2+=a*a;b2+=b*b;}}
    const denominator=m.rigid?characteristic*mass*Math.sqrt(m.shape.length):Math.sqrt(k2)+Math.sqrt(b2);
    if(Math.sqrt(residual2)>2e-5*Math.max(denominator,1e-20))throw Error('Mode shape does not satisfy the finite-element eigenvalue equation.');
    if(!equal(m.modalMass,mass,1e-12)||mass<=0||!equal(m.modalStiffness,integrated.energy2,1e-7)||m.modalStiffness<0||(!m.rigid&&!equal(m.eigenvalue,m.modalStiffness/mass,1e-6))||(m.rigid&&integrated.energy2/mass>1e-7*characteristic))throw Error('Modal mass, stiffness or Rayleigh quotient differs.');
    const effectiveMass=participation.map(v=>v*v*mass);
    for(const [key,expected]of Object.entries({participation,effectiveMass}))if(!Array.isArray(m[key])||m[key].length!==3||expected.some((v,i)=>!equal(v,m[key][i],1e-10)))throw Error('Modal participation differs.');
    for(let j=0;j<modes.length;j++){const error=Math.abs(dot(m.shape,massVectors[j])/Math.sqrt(mass*modes[j].modalMass));orthogonality=Math.max(orthogonality,error);if(error>1e-6)throw Error('Modes are not mass orthogonal.');}
    massVectors.push(integrated.mass);modes.push({eigenvalue:m.eigenvalue,frequency:m.frequency,rigid:m.rigid,shape:m.shape.map(v=>v||0),modalMass:mass,modalStiffness:integrated.energy2,participation,effectiveMass,residual:m.residual});
  }
  return {id:input.id,provenance:{projectId:p.projectId,revision:p.revision,createdAt:p.createdAt,meshId:p.meshId,fingerprint:p.fingerprint,source:model.source},mesh,solution:{solver:{...MODAL_SETTINGS},modes,totalMass:s.totalMass,rigidModes:rigid,freeDofs:s.freeDofs,shift:s.shift,orthogonality},verified:!imported&&input.verified===true};
}
export function modalCSV(record){const s=record.solution;return ['mode,frequency_Hz,rigid_body,modal_mass_kg,modal_stiffness_N_per_m,effective_mass_x_kg,effective_mass_y_kg,effective_mass_z_kg',...s.modes.map((m,i)=>[i+1,m.frequency,m.rigid,m.modalMass,m.modalStiffness,...m.effectiveMass].join(','))].join('\n')+'\n';}
export function modalVTK(record,index){
  const {mesh,solution}=record,m=solution.modes[index];if(!m)throw Error('Select a saved mode.');
  const n=mesh.nodes.length/3,e=mesh.tetrahedra.length/4,lines=['# vtk DataFile Version 3.0',`HammerCraft mode ${index+1}; ${m.frequency} Hz; peak-normalized dimensionless shape`,'ASCII','DATASET UNSTRUCTURED_GRID',`POINTS ${n} double`];
  for(let i=0;i<n;i++)lines.push(mesh.nodes.slice(i*3,i*3+3).join(' '));lines.push(`CELLS ${e} ${e*5}`);for(let i=0;i<e;i++)lines.push('4 '+mesh.tetrahedra.slice(i*4,i*4+4).join(' '));lines.push(`CELL_TYPES ${e}`);for(let i=0;i<e;i++)lines.push('10');lines.push(`POINT_DATA ${n}`,'VECTORS normalized_mode_shape double');for(let i=0;i<n;i++)lines.push(m.shape.slice(i*3,i*3+3).join(' '));return lines.join('\n')+'\n';
}
