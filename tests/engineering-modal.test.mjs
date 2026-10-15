import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,access} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {execFile,spawn} from 'node:child_process';import {promisify} from 'node:util';import {once} from 'node:events';
import {createProject,validateProject,validateSource,ProjectHistory,fingerprint,isCurrent} from '../docs/engineering/project.mjs';
import {cadFingerprint} from '../docs/engineering/cad-model.mjs';
import {faceSupport,faceReference} from '../docs/engineering/face-references.mjs';
import {MODAL_SOLVER,modalRequest,validateModalRecord,modalCSV,modalVTK} from '../docs/engineering/modal-fem-data.mjs';
import {createModalDisplay,ModeAnimation} from '../docs/engineering/modal-fem-view.mjs';
import {localAction,assertStudy} from '../docs/engineering/physics-registry.mjs';
const exec=promisify(execFile),dir=await mkdtemp(path.join(os.tmpdir(),'hc-modal-'));let python=process.env.ENGINEERING_PYTHON||'python3';try{await access('tools/engineering-compute/.venv/bin/python');python=path.resolve('tools/engineering-compute/.venv/bin/python');}catch{}
const file=path.join(dir,'fixture.json');await exec(python,['-c',`import sys,json;sys.path.insert(0,'tools/engineering-compute');from test_modal import ModalTests;from modal_fem import solve_modal;ModalTests.setUpClass();q=ModalTests().request();f={'request':q,'solution':solve_modal(q),'free':solve_modal(dict(q,boundaries=[]))};open(${JSON.stringify(file)},'w').write(json.dumps(f))`]);const fixture=JSON.parse(await readFile(file,'utf8'));test.after(()=>rm(dir,{recursive:true,force:true}));
function project(free=false){
 const p=createProject('modal-project');p.source.meshes.push({id:'mesh-tetra',bodyId:'body-block',type:'gmsh-tetra',minSize:'1 mm',maxSize:'8 mm',curvature:20});p.source.materials[0].properties={youngModulus:'70 GPa',poissonRatio:'0.3'};
 p.source.physics.push({id:'physics-modal',type:'elastic-vibration',bodyId:'body-block',geometryKey:cadFingerprint(p.source),support:faceSupport(p.source),boundaries:free?[]:fixture.request.boundaries.map((b,i)=>({face:faceReference(fixture.request.mesh.boundary.find(g=>g.tag===b.tag),'modal-face-'+i),type:b.type}))});p.source.studies.push({id:'study-modal',name:'Natural frequencies',type:'eigenfrequency',physicsId:'physics-modal',meshId:'mesh-tetra',solverId:MODAL_SOLVER,modeCount:8});return validateProject(p);
}
function record(p=project(),free=false){return {id:'modal-result',provenance:{projectId:p.id,revision:p.revision,createdAt:'2026-10-12T13:00:00Z',meshId:'mesh-record',source:structuredClone(p.source),fingerprint:fingerprint(p.source)},mesh:structuredClone(fixture.request.mesh),solution:structuredClone(free?fixture.free:fixture.solution),verified:true};}

test('modal study registers real eigenfrequency execution and shared source settings',()=>{
 const p=project();assert.equal(assertStudy(p.source.studies[1],p.source.physics[1],p.source.meshes[1]).action,'modal-tetra');assert.ok(localAction('modal-tetra'));assert.deepEqual(modalRequest(validateSource(p.source),fixture.request.mesh),fixture.request);
});
test('modal studies reject unsupported materials, loads, nonzero constraints and stale surfaces',()=>{
 for(const change of [p=>delete p.source.materials[0].properties.youngModulus,p=>p.source.materials[0].properties.poissonRatio='.499',p=>p.source.studies[1].modeCount=13,p=>p.source.physics[1].geometryKey='changed',p=>p.source.physics[1].boundaries[0]={...p.source.physics[1].boundaries[0],type:'force',values:['1 N','0 N','0 N']},p=>p.source.physics[1].boundaries[0]={...p.source.physics[1].boundaries[0],type:'displacement',values:['1 mm',null,null]}]){const p=project();change(p);assert.throws(()=>modalRequest(validateSource(p.source),fixture.request.mesh));}
 const p=project();p.source.materials[0].density={type:'table',axis:'temperature',outside:'clamp',points:[{x:'300 K',y:'2700 kg/m^3'},{x:'400 K',y:'2600 kg/m^3'}]};p.source.materials[0].reference={temperature:'300 K'};assert.throws(()=>modalRequest(validateSource(p.source),fixture.request.mesh),/constant density/);
});
test('clamped and free-body modes pass independent element equations, mass and orthogonality',()=>{
 for(const free of [false,true]){const p=project(free),r=validateModalRecord(record(p,free),validateSource);assert.equal(r.solution.rigidModes,free?6:0);assert.equal(r.solution.modes.length,8);assert.ok(r.solution.modes.at(-1).frequency>0);assert.ok(r.solution.orthogonality<1e-10);assert.equal(validateModalRecord(r,validateSource).solution.modes.length,8);}
});
test('modal fields, canonical source and named history retain independent snapshots',()=>{
 const h=new ProjectHistory(project());h.addModalResult(record(h.project));const saved=h.project.modalResults[0];assert.ok(isCurrent(h.project,saved));const source=structuredClone(h.project.source);source.studies[1].modeCount=6;h.update(source);assert.ok(!isCurrent(h.project,saved));h.undo();assert.ok(isCurrent(h.project,saved));const imported=validateProject(JSON.parse(JSON.stringify(h.project)),{imported:true});assert.equal(imported.modalResults[0].verified,false);
 for(let i=0;i<4;i++)h.addModalResult({...record(h.project),id:'modal-'+i});assert.equal(h.project.modalResults.length,3);
});
test('tampered frequencies, shapes, constraints, energy, participation and metadata fail',()=>{
 for(const change of [r=>r.provenance.fingerprint='fake',r=>r.solution.solver.mass='lumped',r=>r.solution.modes[0].frequency+=1,r=>r.solution.modes[0].shape[0]=1,r=>r.solution.modes[0].shape[90]+=.2,r=>r.solution.modes[0].modalMass*=2,r=>r.solution.modes[0].modalStiffness*=2,r=>r.solution.modes[0].effectiveMass[0]+=1,r=>r.solution.modes[1]=structuredClone(r.solution.modes[0]),r=>r.solution.rigidModes=6,r=>r.solution.totalMass*=2,r=>r.solution.freeDofs=1]){const r=record();change(r);assert.throws(()=>validateModalRecord(r,validateSource));}
});
test('mode animation preserves source, phase bounds, color normalization and fixed camera bounds',()=>{
 const r=record(),before=JSON.stringify(r),display=createModalDisplay(r,0,{axis:2,fraction:.5},.1),bounds=structuredClone(display.artifact.bounds),positive=[...display.artifact.mesh.vertices];display.setPhase(-1);const negative=[...display.artifact.mesh.vertices];assert.notDeepEqual(positive,negative);display.setPhase(0);for(let i=0;i<positive.length;i++)assert.ok(Math.abs((positive[i]+negative[i])/2-display.artifact.mesh.vertices[i])<1e-10);assert.deepEqual(display.artifact.bounds,bounds);assert.equal(JSON.stringify(r),before);assert.ok(display.artifact.visibleCells<r.mesh.tetrahedra.length/4);assert.throws(()=>display.setPhase(2));assert.throws(()=>createModalDisplay(r,0,undefined,.3));
});
test('animation throttles frames and stops scheduled updates without changing physical frequency',()=>{
 const scheduled=new Map(),phases=[];let id=0;const animation=new ModeAnimation(phase=>phases.push(phase),{request:fn=>{scheduled.set(++id,fn);return id;},cancel:i=>scheduled.delete(i)}),tick=t=>{const [key,fn]=scheduled.entries().next().value;scheduled.delete(key);fn(t);};animation.start(1);tick(0);tick(20);tick(50);tick(500);assert.equal(phases.length,3);assert.equal(phases[0],1);assert.equal(phases.at(-1),-1);animation.stop();assert.equal(scheduled.size,0);assert.equal(animation.running,false);assert.throws(()=>animation.start(100));
});
test('modal exports contain frequencies and normalized nodal shapes on the original SI mesh',()=>{
 const r=record();assert.equal(modalCSV(r).trim().split('\n').length,9);assert.match(modalCSV(r),/frequency_Hz/);const vtk=modalVTK(r,0);assert.match(vtk,/VECTORS normalized_mode_shape double/);assert.match(vtk,/POINTS 106 double/);assert.throws(()=>modalVTK(r,12));
});
test('HTTP service advertises and executes modal studies with verified outputs',async()=>{
 const child=spawn(python,['tools/engineering-compute/server.py','--port','0'],{stdio:['ignore','pipe','pipe']});try{const [chunk]=await once(child.stdout,'data'),url=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/)[0],headers={'X-HC-Compute':'1','Content-Type':'application/json'};assert.ok((await fetch(url+'/health').then(r=>r.json())).capabilities.includes('modal-tetra'));const job=await fetch(url+'/jobs',{method:'POST',headers,body:JSON.stringify(fixture.request)}).then(r=>r.json());let e;const start=Date.now();do{e=await fetch(url+'/jobs/'+job.id,{headers}).then(r=>r.json());if(['Completed','Failed'].includes(e.state))break;await new Promise(r=>setTimeout(r,25));}while(Date.now()-start<20000);assert.equal(e.state,'Completed',e.error);validateModalRecord({...record(),solution:e.solution},validateSource);}finally{child.kill('SIGINT');await once(child,'exit');}
});
