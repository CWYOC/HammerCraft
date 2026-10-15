import {quantity,dimensions} from './units.mjs';
import {cadFingerprint} from './cad-model.mjs';
import {faceSupport,normalizeFaceReference,resolveFaceReference} from './face-references.mjs';
import {resolveStructuralPhysics,prescribedDofs,cellStrain,elasticStress} from './structural-fem-data.mjs';
import {modalMaterial,modalElements,integrateMode} from './modal-fem-data.mjs';
import {inspectVolumeMesh} from './volume-mesh.mjs';
export const HARMONIC_SOLVER='hc-harmonic-fem-1';
export const HARMONIC_SETTINGS={id:HARMONIC_SOLVER,library:'scikit-fem',version:'12.0.2',linearSolver:'SciPy SuperLU',scipy:'1.18.1',element:'VectorTetP1',mass:'consistent',damping:'Rayleigh',phasor:'exp(+i omega t)',amplitudes:'peak'};
const bounded=(v,lo,hi,label)=>{if(!Number.isFinite(v)||v<lo||v>hi)throw Error(`${label} must be ${lo}–${hi} in SI units.`);return v;};
const expression=(v,dim,values,lo,hi,label)=>{if(typeof v!=='string'||!v.trim()||v.length>512)throw Error(`Invalid ${label} expression.`);return bounded(quantity(v,dim,values),lo,hi,label);};
const equal=(a,b,abs=1e-10,rel=2e-6)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=abs+rel*Math.max(Math.abs(a),Math.abs(b));
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function harmonicSweep(input,values){
  const start=expression(input?.start,dimensions.frequency,values,1e-3,1e7,'Start frequency'),end=expression(input?.end,dimensions.frequency,values,1e-3,1e7,'End frequency'),count=input.count;
  if(!Number.isInteger(count)||count<1||count>24||!['linear','log'].includes(input.spacing))throw Error('Use 1–24 frequencies with linear or logarithmic spacing.');
  if(count>1&&end<=start)throw Error('End frequency must exceed start frequency.');
  return {source:{start:input.start,end:input.end,count,spacing:input.spacing},frequencies:Array.from({length:count},(_,i)=>i===0?start:i===count-1?end:input.spacing==='linear'?start+(end-start)*i/(count-1):start*(end/start)**(i/(count-1)))};
}
export function resolveHarmonicPhysics(input,values,bodyId){
  if(input?.type!=='harmonic-elasticity')throw Error('Invalid harmonic physics.');
  const result=resolveStructuralPhysics({...input,type:'linear-elasticity',gravity:['0 m/s^2','0 m/s^2','0 m/s^2']},values,bodyId);
  result.boundaries.forEach((b,i)=>{
    if(b.type==='displacement'&&b.values.some(v=>v!==null&&v!==0))throw Error('Harmonic restraints must prescribe zero displacement.');
    if(['force','pressure'].includes(b.type)){b.phase=expression(input.boundaries[i].phase,dimensions.scalar,values,-1e6,1e6,'Load phase');result.source.boundaries[i].phase=input.boundaries[i].phase;}
  });
  const alpha=expression(input.alpha,dimensions.frequency,values,0,1e8,'Rayleigh alpha'),beta=expression(input.beta,[0,0,1,0,0],values,0,1e3,'Rayleigh beta');
  if(!Number.isInteger(input.responseAxis)||input.responseAxis<0||input.responseAxis>2)throw Error('Choose a response axis.');
  delete result.source.gravity;Object.assign(result.source,{type:input.type,alpha:input.alpha,beta:input.beta,responseFace:input.responseFace===null?null:normalizeFaceReference(input.responseFace),responseAxis:input.responseAxis});
  return {...result,alpha,beta};
}
export function harmonicRequest(model,mesh){
  const p=model.source.physics.find(p=>p.type==='harmonic-elasticity'),study=model.source.studies.find(s=>s.solverId===HARMONIC_SOLVER);
  if(!p||!study)throw Error('Create a harmonic response study first.');
  if(p.geometryKey!==cadFingerprint(model.source)||JSON.stringify(p.support)!==JSON.stringify(faceSupport(model.source)))throw Error('CAD geometry changed. Reselect harmonic surfaces.');
  if(mesh.nodes.length/3>4000||mesh.tetrahedra.length/4>16000)throw Error('Direct harmonic studies support at most 4,000 nodes and 16,000 tetrahedra.');
  if(!p.responseFace)throw Error('Select and apply a response surface.');
  const physics=resolveHarmonicPhysics(p,model.values,p.bodyId),boundaries=physics.boundaries.map(({face,...b})=>({tag:resolveFaceReference(face,mesh.boundary).tag,...b}));
  if(!boundaries.some(b=>['force','pressure'].includes(b.type)))throw Error('Apply at least one harmonic force or pressure.');
  if(new Set(boundaries.map(b=>b.tag)).size!==boundaries.length)throw Error('Several conditions reference the same harmonic surface.');
  const q={kind:'harmonic-tetra',mesh,...modalMaterial(model,'Harmonic'),alpha:physics.alpha,beta:physics.beta,frequencies:harmonicSweep(study.sweep,model.values).frequencies,boundaries,responseTag:resolveFaceReference(p.responseFace,mesh.boundary).tag,responseAxis:p.responseAxis};
  const fixed=prescribedDofs(q);if(fixed.size===mesh.nodes.length)throw Error('No free displacement DOFs remain.');return q;
}
// Exact P1 surface integration: force traction, outward pressure and area-weighted response.
export function harmonicLoads(q){
  const real=new Float64Array(q.mesh.nodes.length),imag=new Float64Array(real.length),weights=new Float64Array(real.length/3);
  for(const g of q.mesh.boundary){
    const triangles=[];let area=0;
    for(let i=0;i<g.triangles.length;i+=3){const ids=g.triangles.slice(i,i+3),p=ids.map(n=>q.mesh.nodes.slice(n*3,n*3+3)),vector=cross(sub(p[1],p[0]),sub(p[2],p[0])).map(v=>v/2),a=Math.hypot(...vector);area+=a;triangles.push({ids,vector,area:a});}
    const b=q.boundaries.find(b=>b.tag===g.tag&&['force','pressure'].includes(b.type));
    for(const t of triangles){if(g.tag===q.responseTag)for(const n of t.ids)weights[n]+=t.area/area/3;if(!b)continue;
      const force=b.type==='force'?b.values.map(v=>v*t.area/area):t.vector.map(v=>-b.pressure*v);
      for(const n of t.ids)for(let a=0;a<3;a++){real[n*3+a]+=force[a]/3*Math.cos(b.phase);imag[n*3+a]+=force[a]/3*Math.sin(b.phase);}
    }
  }return {real,imag,weights};
}
export function peakVector(real,imag){const a=dot(real,real),b=dot(imag,imag),c=dot(real,imag);return Math.sqrt(Math.max(0,(a+b+Math.hypot(a-b,2*c))/2));}
const vmDot=(a,b)=>((a[0]-a[1])*(b[0]-b[1])+(a[1]-a[2])*(b[1]-b[2])+(a[2]-a[0])*(b[2]-b[0]))/2+3*(a[3]*b[3]+a[4]*b[4]+a[5]*b[5]);
export function harmonicFields(mesh,response,q){
  const peak=[],stressReal=[],stressImag=[],vonMises=[];let maxStrain=0;
  for(let i=0;i<mesh.nodes.length;i+=3)peak.push(peakVector(response.real.slice(i,i+3),response.imag.slice(i,i+3)));
  for(let i=0;i<mesh.tetrahedra.length;i+=4){const ids=mesh.tetrahedra.slice(i,i+4),p=ids.map(n=>mesh.nodes.slice(n*3,n*3+3)),e=['real','imag'].map(k=>cellStrain(p,ids.map(n=>response[k].slice(n*3,n*3+3)))),s=e.map(e=>elasticStress(e,q.youngModulus,q.poissonRatio));stressReal.push(...s[0]);stressImag.push(...s[1]);const a=vmDot(s[0],s[0]),b=vmDot(s[1],s[1]),c=vmDot(s[0],s[1]);vonMises.push(Math.sqrt(Math.max(0,(a+b+Math.hypot(a-b,2*c))/2)));maxStrain=Math.max(maxStrain,peakVector(...e.map(v=>v.map((n,j)=>n*(j<3?1:Math.SQRT2)))));}
  return {peak,stressReal,stressImag,vonMises,maxStrain};
}
export function responseMetrics(response,q){
  const w=2*Math.PI*response.frequency,a=q.responseAxis,ur=response.meanReal[a],ui=response.meanImag[a],vr=-w*ui,vi=w*ur,loads=q.boundaries.filter(b=>['force','pressure'].includes(b.type)&& (b.type==='force'?b.values.some(v=>v!==0):b.pressure!==0));
  let impedance=null;const b=loads[0],v2=vr*vr+vi*vi;
  if(loads.length===1&&b.type==='force'&&b.tag===q.responseTag&&b.values.every((v,i)=>i===a||v===0)&&b.values[a]!==0&&v2>0){const fr=b.values[a]*Math.cos(b.phase),fi=b.values[a]*Math.sin(b.phase);impedance={real:(fr*vr+fi*vi)/v2,imag:(fi*vr-fr*vi)/v2};impedance.magnitude=Math.hypot(impedance.real,impedance.imag);impedance.phase=Math.atan2(impedance.imag,impedance.real)*180/Math.PI;}
  return {displacement:Math.hypot(ur,ui),velocity:Math.hypot(vr,vi),acceleration:w*w*Math.hypot(ur,ui),phase:Math.hypot(ur,ui)===0?null:Math.atan2(ui,ur)*180/Math.PI,impedance,dampingRatio:q.alpha/(2*w)+q.beta*w/2};
}
export function validateHarmonicRecord(input,validateSource,imported=false){
  const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(v),p=input?.provenance,s=input?.solution;
  if(!validId(input?.id)||!validId(p?.projectId)||!validId(p?.meshId)||!Number.isSafeInteger(p.revision)||p.revision<0||!Number.isFinite(Date.parse(p.createdAt)))throw Error('Invalid harmonic provenance.');
  const model=validateSource(p.source);if(p.fingerprint!==JSON.stringify(model.source))throw Error('Harmonic source fingerprint differs.');
  const {mesh,stats}=inspectVolumeMesh(input.mesh),q=harmonicRequest(model,mesh),fixed=prescribedDofs(q),loads=harmonicLoads(q),cells=modalElements(mesh);
  if(!s||Object.entries(HARMONIC_SETTINGS).some(([k,v])=>s.solver?.[k]!==v)||!Array.isArray(s.responses)||s.responses.length!==q.frequencies.length||s.freeDofs!==mesh.nodes.length-fixed.size||!equal(s.totalMass,stats.volume*q.density))throw Error('Unsupported harmonic solver or system summary.');
  const responses=s.responses.map((r,index)=>{
    if(!equal(r.frequency,q.frequencies[index],1e-9,1e-10)||!Number.isFinite(r.residual)||r.residual<0||r.residual>1e-8)throw Error('Invalid harmonic frequency or convergence.');
    for(const key of ['real','imag'])if(!Array.isArray(r[key])||r[key].length!==mesh.nodes.length||r[key].some(v=>!Number.isFinite(v))||[...fixed.keys()].some(i=>r[key][i]!==0))throw Error('Invalid complex displacement or restraint.');
    const re=integrateMode(r.real,cells,q),im=integrateMode(r.imag,cells,q),w=2*Math.PI*r.frequency,totals={forceReal:[0,0,0],forceImag:[0,0,0],reactionReal:[0,0,0],reactionImag:[0,0,0],inertiaReal:[0,0,0],inertiaImag:[0,0,0],dampingReal:[0,0,0],dampingImag:[0,0,0],meanReal:[0,0,0],meanImag:[0,0,0]};let residual2=0,denominator=0;
    for(let i=0;i<r.real.length;i++){
      const a=i%3,ir=-w*w*re.mass[i],ii=-w*w*im.mass[i],dr=-w*(q.alpha*im.mass[i]+q.beta*im.stiffness[i]),di=w*(q.alpha*re.mass[i]+q.beta*re.stiffness[i]),er=re.stiffness[i]+ir+dr-loads.real[i],ei=im.stiffness[i]+ii+di-loads.imag[i];
      for(const [key,value]of Object.entries({forceReal:loads.real[i],forceImag:loads.imag[i],inertiaReal:ir,inertiaImag:ii,dampingReal:dr,dampingImag:di,meanReal:r.real[i]*loads.weights[Math.floor(i/3)],meanImag:r.imag[i]*loads.weights[Math.floor(i/3)]}))totals[key][a]+=value;
      if(fixed.has(i)){totals.reactionReal[a]+=er;totals.reactionImag[a]+=ei;}else{residual2+=er*er+ei*ei;denominator+=re.stiffness[i]**2+im.stiffness[i]**2+ir*ir+ii*ii+dr*dr+di*di+loads.real[i]**2+loads.imag[i]**2;}
    }
    if(Math.sqrt(residual2)>2e-5*Math.max(1e-20,Math.sqrt(denominator)))throw Error('Complex field does not satisfy the finite-element harmonic equation.');
    for(const [key,v]of Object.entries(totals))if(!Array.isArray(r[key])||r[key].length!==3||v.some((n,i)=>!equal(n,r[key][i],key.startsWith('mean')?1e-13:1e-7)))throw Error('Harmonic surface response or force balance differs.');
    const strainEnergy=(re.energy2+im.energy2)/4,kineticEnergy=w*w*(dot(r.real,re.mass)+dot(r.imag,im.mass))/4,inputPower=w*(dot(loads.imag,r.real)-dot(loads.real,r.imag))/2,dissipatedPower=2*(q.alpha*kineticEnergy+q.beta*w*w*strainEnergy);
    for(const [key,v]of Object.entries({strainEnergy,kineticEnergy,inputPower,dissipatedPower}))if(!equal(r[key],v,1e-10)||r[key]<-1e-10)throw Error('Harmonic energy or average power differs.');
    if(!equal(inputPower,dissipatedPower,1e-9))throw Error('Harmonic average power is unbalanced.');
    return {frequency:r.frequency,real:[...r.real],imag:[...r.imag],residual:r.residual,...totals,strainEnergy,kineticEnergy,inputPower,dissipatedPower:Math.max(0,dissipatedPower)};
  });
  return {id:input.id,provenance:{projectId:p.projectId,revision:p.revision,createdAt:p.createdAt,meshId:p.meshId,fingerprint:p.fingerprint,source:model.source},mesh,solution:{solver:{...HARMONIC_SETTINGS},responses,totalMass:s.totalMass,freeDofs:s.freeDofs},verified:!imported&&input.verified===true};
}
export function harmonicCSV(record,q){return ['frequency_Hz,mean_u_real_m,mean_u_imag_m,mean_u_amplitude_m,mean_u_phase_deg,mean_v_amplitude_m_per_s,mean_a_amplitude_m_per_s2,impedance_real_Ns_per_m,impedance_imag_Ns_per_m,impedance_magnitude_Ns_per_m,impedance_phase_deg,input_power_W,dissipated_power_W',...record.solution.responses.map(r=>{const m=responseMetrics(r,q),z=m.impedance;return [r.frequency,r.meanReal[q.responseAxis],r.meanImag[q.responseAxis],m.displacement,m.phase??'',m.velocity,m.acceleration,z?.real??'',z?.imag??'',z?.magnitude??'',z?.phase??'',r.inputPower,r.dissipatedPower].join(',');})].join('\n')+'\n';}
export function harmonicVTK(record,index,q){
  const {mesh}=record,r=record.solution.responses[index];if(!r)throw Error('Select a saved harmonic frequency.');const fields=harmonicFields(mesh,r,q),n=mesh.nodes.length/3,e=mesh.tetrahedra.length/4,lines=['# vtk DataFile Version 3.0',`HammerCraft harmonic ${r.frequency} Hz; peak phasors exp(+i omega t); elastic stress; SI units`,'ASCII','DATASET UNSTRUCTURED_GRID',`POINTS ${n} double`];
  for(let i=0;i<n;i++)lines.push(mesh.nodes.slice(i*3,i*3+3).join(' '));lines.push(`CELLS ${e} ${e*5}`);for(let i=0;i<e;i++)lines.push('4 '+mesh.tetrahedra.slice(i*4,i*4+4).join(' '));lines.push(`CELL_TYPES ${e}`);for(let i=0;i<e;i++)lines.push('10');lines.push(`POINT_DATA ${n}`);
  for(const key of ['real','imag']){lines.push(`VECTORS displacement_${key}_m double`);for(let i=0;i<n;i++)lines.push(r[key].slice(i*3,i*3+3).join(' '));}lines.push('SCALARS displacement_cycle_peak_m double 1','LOOKUP_TABLE default',...fields.peak.map(String),`CELL_DATA ${e}`,'SCALARS von_mises_cycle_peak_Pa double 1','LOOKUP_TABLE default',...fields.vonMises.map(String));
  for(const key of ['stressReal','stressImag']){lines.push(`TENSORS ${key}_Pa double`);for(let i=0;i<e;i++){const s=fields[key].slice(i*6,i*6+6);lines.push(`${s[0]} ${s[3]} ${s[5]}`,`${s[3]} ${s[1]} ${s[4]}`,`${s[5]} ${s[4]} ${s[2]}`);}}return lines.join('\n')+'\n';
}
