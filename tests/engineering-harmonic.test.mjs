import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,access} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {execFile,spawn} from 'node:child_process';import {promisify} from 'node:util';import {once} from 'node:events';
import {createProject,validateProject,validateSource,ProjectHistory,fingerprint,isCurrent} from '../docs/engineering/project.mjs';
import {cadFingerprint} from '../docs/engineering/cad-model.mjs';
import {faceSupport,faceReference} from '../docs/engineering/face-references.mjs';
import {HARMONIC_SOLVER,harmonicRequest,validateHarmonicRecord,harmonicCSV,harmonicVTK,harmonicSweep,harmonicFields,responseMetrics,peakVector} from '../docs/engineering/harmonic-fem-data.mjs';
import {createHarmonicDisplay,HarmonicAnimation} from '../docs/engineering/harmonic-fem-view.mjs';
import {localAction,assertStudy} from '../docs/engineering/physics-registry.mjs';
const exec=promisify(execFile),dir=await mkdtemp(path.join(os.tmpdir(),'hc-harmonic-'));let python=process.env.ENGINEERING_PYTHON||'python3';try{await access('tools/engineering-compute/.venv/bin/python');python=path.resolve('tools/engineering-compute/.venv/bin/python');}catch{}
const file=path.join(dir,'fixture.json');await exec(python,['-c',`import sys,json;sys.path.insert(0,'tools/engineering-compute');from test_harmonic import HarmonicTests;from harmonic_fem import solve_harmonic;HarmonicTests.setUpClass();q=HarmonicTests().request();q['frequencies']=[1,2000.5,4000];p=dict(q,frequencies=[1000,2500,4000],boundaries=[dict(q['boundaries'][-1],type='pressure',pressure=5000,phase=0.7)]);f={'request':q,'solution':solve_harmonic(q),'pressure':solve_harmonic(p)};open(${JSON.stringify(file)},'w').write(json.dumps(f))`],{env:{...process.env,OPENBLAS_NUM_THREADS:'1'}});const fixture=JSON.parse(await readFile(file,'utf8'));test.after(()=>rm(dir,{recursive:true,force:true}));
function project(pressure=false){
 const p=createProject('harmonic-project');p.source.meshes.push({id:'mesh-tetra',bodyId:'body-block',type:'gmsh-tetra',minSize:'1 mm',maxSize:'8 mm',curvature:20});p.source.materials[0].properties={youngModulus:'70 GPa',poissonRatio:'0.3'};
 const boundaries=fixture.request.boundaries.map((b,i)=>({face:faceReference(fixture.request.mesh.boundary.find(g=>g.tag===b.tag),'harmonic-face-'+i),type:b.type,...(b.type==='force'?{values:['0 N','0 N','1 N'],phase:'0 deg'}:{})}));
 p.source.physics.push({id:'physics-harmonic',type:'harmonic-elasticity',bodyId:'body-block',geometryKey:cadFingerprint(p.source),support:faceSupport(p.source),boundaries:pressure?[{face:boundaries[1].face,type:'pressure',expression:'5000 Pa',phase:'0.7 rad'}]:boundaries,alpha:'2/s',beta:'0.000002 s',responseFace:boundaries[1].face,responseAxis:2});p.source.studies.push({id:'study-harmonic',name:'Harmonic response',type:'frequency-response',physicsId:'physics-harmonic',meshId:'mesh-tetra',solverId:HARMONIC_SOLVER,sweep:{start:pressure?'1000 Hz':'1 Hz',end:'4000 Hz',count:3,spacing:'linear'}});return validateProject(p);
}
function record(p=project(),pressure=false){return {id:'harmonic-result',provenance:{projectId:p.id,revision:p.revision,createdAt:'2026-10-12T14:00:00Z',meshId:'mesh-record',source:structuredClone(p.source),fingerprint:fingerprint(p.source)},mesh:structuredClone(fixture.request.mesh),solution:structuredClone(pressure?fixture.pressure:fixture.solution),verified:true};}
test('harmonic study registers direct complex execution with units and frequency grid',()=>{
 const p=project();assert.equal(assertStudy(p.source.studies[1],p.source.physics[1],p.source.meshes[1]).action,'harmonic-tetra');assert.ok(localAction('harmonic-tetra'));assert.deepEqual(harmonicRequest(validateSource(p.source),fixture.request.mesh),fixture.request);
 assert.deepEqual(harmonicSweep({start:'10 Hz',end:'1000 Hz',count:3,spacing:'log'},{}).frequencies,[10,100,1000]);assert.deepEqual(harmonicSweep({start:'10 Hz',end:'1 Hz',count:1,spacing:'linear'},{}).frequencies,[10]);
});
test('harmonic setup rejects invalid grids, nonzero base excitation, curves and stale surfaces',()=>{
 for(const change of [p=>p.source.studies[1].sweep.count=25,p=>p.source.studies[1].sweep.end='0 Hz',p=>p.source.studies[1].sweep.spacing='adaptive',p=>p.source.physics[1].alpha='-1 Hz',p=>p.source.physics[1].beta='1 Hz',p=>p.source.physics[1].responseFace=null,p=>p.source.physics[1].boundaries[1].phase='1 m',p=>p.source.physics[1].geometryKey='changed',p=>p.source.physics[1].boundaries[0]={...p.source.physics[1].boundaries[0],type:'displacement',values:['1 mm',null,null]},p=>delete p.source.materials[0].properties.youngModulus]){const p=project();change(p);assert.throws(()=>harmonicRequest(validateSource(p.source),fixture.request.mesh));}
});
test('complex force and free-body pressure fields pass independent element equations and power balance',()=>{
 for(const pressure of [false,true]){const p=project(pressure),r=validateHarmonicRecord(record(p,pressure),validateSource);assert.equal(r.solution.responses.length,3);assert.ok(r.solution.responses[1].dissipatedPower>0);assert.equal(validateHarmonicRecord(r,validateSource).solution.responses.length,3);}
});
test('tampered phasors, loads, response averages, energy, metadata and frequencies fail validation',()=>{
 for(const change of [r=>r.provenance.fingerprint='fake',r=>r.solution.solver.phasor='exp(-i omega t)',r=>r.solution.responses[0].frequency=2,r=>r.solution.responses[1].imag[90]+=.2,r=>r.solution.responses[0].real[0]=1,r=>r.solution.responses[0].meanImag[2]+=.01,r=>r.solution.responses[1].dissipatedPower*=2,r=>r.solution.responses[1].reactionReal[2]+=1,r=>r.solution.responses[1].kineticEnergy*=2,r=>r.solution.totalMass*=2,r=>r.solution.freeDofs=1,r=>r.solution.responses.pop()]){const r=record();change(r);assert.throws(()=>validateHarmonicRecord(r,validateSource));}
});
test('saved sweeps retain immutable provenance, stale state, undo and bounded import history',()=>{
 const h=new ProjectHistory(project());h.addHarmonicResult(record(h.project));const saved=h.project.harmonicResults[0];assert.ok(isCurrent(h.project,saved));const source=structuredClone(h.project.source);source.studies[1].sweep.count=4;h.update(source);assert.ok(!isCurrent(h.project,saved));h.undo();assert.ok(isCurrent(h.project,saved));assert.equal(validateProject(JSON.parse(JSON.stringify(h.project)),{imported:true}).harmonicResults[0].verified,false);for(let i=0;i<3;i++)h.addHarmonicResult({...record(h.project),id:'harmonic-'+i});assert.equal(h.project.harmonicResults.length,2);
});
test('impedance is collocated force over mean velocity, invariant to global load phase',()=>{
 const q=fixture.request,r=fixture.solution.responses[1],m=responseMetrics(r,q),v2=m.velocity**2;assert.ok(m.impedance);assert.ok(Math.abs(.5*m.impedance.real*v2-r.inputPower)<1e-10);assert.equal(responseMetrics(r,{...q,responseAxis:0}).impedance,null);assert.equal(responseMetrics(r,{...q,responseTag:999}).impedance,null);assert.equal(responseMetrics(r,{...q,boundaries:[...q.boundaries,{...q.boundaries[1],tag:999}]}).impedance,null);
 const rotated={...r,meanReal:r.meanImag.map(v=>-v),meanImag:r.meanReal};const shifted=responseMetrics(rotated,{...q,boundaries:q.boundaries.map(b=>b.type==='force'?{...b,phase:Math.PI/2}:b)});assert.ok(Math.abs(shifted.impedance.real-m.impedance.real)<1e-8);assert.ok(Math.abs(shifted.impedance.imag-m.impedance.imag)<1e-8);
});
test('cycle peak fields use the elliptical trajectory and tensor invariant, not complex vector norm',()=>{
 assert.equal(peakVector([1,0,0],[0,1,0]),1);assert.equal(peakVector([1,0,0],[1,0,0]),Math.SQRT2);
 const mesh={nodes:[0,0,0,1,0,0,0,1,0,0,0,1],tetrahedra:[0,1,2,3]},r={real:[0,0,0,1,0,0,0,0,0,0,0,0],imag:[0,0,0,0,0,0,0,1,0,0,0,0]},f=harmonicFields(mesh,r,{youngModulus:1,poissonRatio:0});assert.ok(Math.abs(f.vonMises[0]-Math.sqrt(1.5))<1e-12);
});
test('complex animation preserves quadrature, source and full-cycle camera bounds',()=>{
 const r=record(),before=JSON.stringify(r),d=createHarmonicDisplay(r,1,fixture.request,{axis:2,fraction:.5},10),bounds=structuredClone(d.artifact.bounds),positive=[...d.artifact.mesh.vertices];d.setPhase(Math.PI);const negative=[...d.artifact.mesh.vertices];d.setPhase(Math.PI/2);
 for(let i=0;i<positive.length;i++){const n=d.artifact.nodeIndices[Math.floor(i/3)],a=i%3,base=(positive[i]+negative[i])/2;assert.ok(Math.abs(d.artifact.mesh.vertices[i]-(base-10000*r.solution.responses[1].imag[n*3+a]))<1e-10);}
 assert.deepEqual(d.artifact.bounds,bounds);assert.equal(JSON.stringify(r),before);assert.ok(d.artifact.visibleCells<r.mesh.tetrahedra.length/4);assert.throws(()=>createHarmonicDisplay(r,1,fixture.request,undefined,1e7));
 const scheduled=new Map(),angles=[];let id=0;const anim=new HarmonicAnimation(a=>angles.push(a),{request:fn=>{scheduled.set(++id,fn);return id;},cancel:i=>scheduled.delete(i)}),tick=t=>{const [key,fn]=scheduled.entries().next().value;scheduled.delete(key);fn(t);};anim.start();tick(0);tick(250);assert.equal(angles[1],Math.PI/2);anim.stop();assert.equal(scheduled.size,0);
});
test('CSV and VTK retain complex SI fields and exclude unavailable impedance',()=>{
 const r=record();assert.equal(harmonicCSV(r,fixture.request).trim().split('\n').length,4);const vtk=harmonicVTK(r,1,fixture.request);assert.match(vtk,/VECTORS displacement_real_m double/);assert.match(vtk,/VECTORS displacement_imag_m double/);assert.match(vtk,/TENSORS stressImag_Pa double/);assert.match(vtk,/POINTS 106 double/);assert.throws(()=>harmonicVTK(r,24,fixture.request));
 assert.ok(harmonicCSV(r,{...fixture.request,responseAxis:0}).split('\n')[1].includes(',,,,,'));
});
test('HTTP service advertises, executes and validates a direct harmonic sweep',async()=>{
 const child=spawn(python,['tools/engineering-compute/server.py','--port','0'],{stdio:['ignore','pipe','pipe']});try{const [chunk]=await once(child.stdout,'data'),url=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/)[0],headers={'X-HC-Compute':'1','Content-Type':'application/json'};assert.ok((await fetch(url+'/health').then(r=>r.json())).capabilities.includes('harmonic-tetra'));const job=await fetch(url+'/jobs',{method:'POST',headers,body:JSON.stringify(fixture.request)}).then(r=>r.json());let e;const start=Date.now();do{e=await fetch(url+'/jobs/'+job.id,{headers}).then(r=>r.json());if(['Completed','Failed'].includes(e.state))break;await new Promise(r=>setTimeout(r,25));}while(Date.now()-start<20000);assert.equal(e.state,'Completed',e.error);validateHarmonicRecord({...record(),solution:e.solution},validateSource);}finally{child.kill('SIGINT');await once(child,'exit');}
});
