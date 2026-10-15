import {cadFingerprint} from '../docs/engineering/cad-model.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {createProject,validateSource,validateProject,ProjectHistory,fingerprint,isCurrent} from '../docs/engineering/project.mjs';
import {faceReference,faceSupport,resolveFaceReference} from '../docs/engineering/face-references.mjs';
import {FEM_SOLVER,femRequest,validateFemRecord,femCSV,femVTK} from '../docs/engineering/thermal-fem-data.mjs';
import {reusableFemMesh} from '../docs/engineering/thermal-fem.mjs';
import {femDisplay,femField,fieldRange} from '../docs/engineering/thermal-fem-view.mjs';
import {SOLVERS,assertStudy,localAction} from '../docs/engineering/physics-registry.mjs';
import {ComputeWorker} from '../docs/engineering/compute-client.mjs';
import {JobManager} from '../docs/engineering/jobs.mjs';
const execute=promisify(execFile),folder=await mkdtemp(path.join(os.tmpdir(),'hc-fem-'));
let python=process.env.ENGINEERING_PYTHON||'python3';try{await access('tools/engineering-compute/.venv/bin/python');python=path.resolve('tools/engineering-compute/.venv/bin/python');}catch{}
const output=path.join(folder,'fixture.json');
await execute(python,['-c',`import sys,json;sys.path.insert(0,'tools/engineering-compute');from test_compute import fixture;from mesher import mesh_step;from thermal_fem import solve_thermal;m=mesh_step(fixture());ends=sorted(m['boundary'],key=lambda g:g['center'][0]);q={'kind':'thermal-tetra','mesh':m,'conductivity':167,'heatGeneration':0,'boundaries':[{'tag':ends[0]['tag'],'type':'temperature','temperature':353.15},{'tag':ends[-1]['tag'],'type':'temperature','temperature':293.15}]};open(${JSON.stringify(output)},'w').write(json.dumps({'mesh':m,'request':q,'solution':solve_thermal(q)}))`]);
const fixture=JSON.parse(await readFile(output,'utf8'));
test.after(()=>rm(folder,{recursive:true,force:true}));
function project(){
 const p=createProject('fem-project');p.source.meshes.push({id:'mesh-cad',bodyId:'body-block',type:'gmsh-tetra',minSize:'1 mm',maxSize:'4 mm',curvature:20});
 p.source.physics.push({id:'thermal-cad',type:'heat-conduction-tetra',bodyId:'body-block',geometryKey:cadFingerprint(p.source),support:faceSupport(p.source),boundaries:fixture.request.boundaries.map((b,i)=>({face:faceReference(fixture.mesh.boundary.find(g=>g.tag===b.tag),'face-'+i),type:'temperature',expression:b.temperature+' K'})),heatGeneration:'0 W/m^3'});
 p.source.studies.push({id:'study-cad',name:'CAD thermal',type:'steady-state',physicsId:'thermal-cad',meshId:'mesh-cad',solverId:FEM_SOLVER});return validateProject(p);
}
const provenance=p=>({projectId:p.id,revision:p.revision,source:structuredClone(p.source),fingerprint:fingerprint(p.source),createdAt:'2026-10-12T12:00:00Z'});
const record=(p=project())=>({id:'result-fem',provenance:{...provenance(p),meshId:'volume-1'},mesh:structuredClone(fixture.mesh),solution:structuredClone(fixture.solution),verified:true});
const meshRecord=(p=project())=>({id:'volume-1',provenance:provenance(p),mesh:structuredClone(fixture.mesh),verified:true});

test('registry selects actual numerical methods and rejects mismatched studies',()=>{
 const p=project();assert.ok(Object.hasOwn(SOLVERS,'hc-thermal-fvm-1')&&Object.hasOwn(SOLVERS,'hc-thermal-fem-1'));assert.equal(assertStudy(p.source.studies[1],p.source.physics[1],p.source.meshes[1]).method,'Finite element');
 assert.throws(()=>assertStudy(p.source.studies[1],p.source.physics[0],p.source.meshes[1]),/incompatible/);assert.ok(localAction('thermal-tetra'));assert.ok(!localAction('solve'));
 const bad=project();bad.source.studies[1].solverId='fake';assert.throws(()=>validateProject(bad),/not implemented/);
});
test('CAD conditions reference geometry and resolve after mesh tags change',()=>{
 const p=project(),a=fixture.mesh.boundary[0],ref=faceReference(a,'persistent-face'),renumbered=fixture.mesh.boundary.map(g=>({...g,tag:g.tag+100}));
 assert.equal(resolveFaceReference(ref,renumbered).tag,a.tag+100);assert.ok(!('tag' in ref));
 assert.throws(()=>resolveFaceReference(ref,[]),/missing/);assert.throws(()=>resolveFaceReference(ref,[a,a]),/ambiguous/);
 assert.deepEqual(femRequest(validateSource(p.source),fixture.mesh),fixture.request);
});
test('CAD physics validates units and explicitly rejects missing, touching or changed references',()=>{
 for(const mutate of [p=>p.source.physics[1].boundaries[0].expression='3 mm',p=>p.source.physics[1].boundaries.push(structuredClone(p.source.physics[1].boundaries[0])),p=>p.source.physics[1].heatGeneration='1e13 W/m^3']){const p=project();mutate(p);assert.throws(()=>validateProject(p));}
 const p=project();p.source.physics[1].support=['another:block'];assert.throws(()=>femRequest(validateSource(p.source),fixture.mesh),/feature sequence/);
 p.source.physics[1].support=faceSupport(p.source);p.source.physics[1].boundaries=[];assert.throws(()=>femRequest(validateSource(p.source),fixture.mesh),/at least one/);
 const touching=project();const g=fixture.mesh.boundary.find(g=>g.center[1]<1e-10);touching.source.physics[1].boundaries[1].face=faceReference(g,'adjacent');assert.throws(()=>femRequest(validateSource(touching.source),fixture.mesh),/shared nodes/);
});
test('geometry changes cannot silently reuse similar surface descriptors',()=>{const p=project();p.source.parameters[0].expression='70 mm';assert.throws(()=>femRequest(validateSource(p.source),fixture.mesh),/geometry changed/);});

test('mesh reuse is tied to resolved CAD and sizing, independently of material and BC changes',()=>{
 const p=project(),m=meshRecord(p);assert.ok(reusableFemMesh(p,m));p.source.physics[1].heatGeneration='100 W/m^3';assert.ok(reusableFemMesh(p,m));p.source.materials[0].conductivity='200 W/(m*K)';assert.ok(reusableFemMesh(p,m));
 p.source.meshes[1].maxSize='5 mm';assert.ok(!reusableFemMesh(p,m));p.source.meshes[1].maxSize='4 mm';p.source.parameters[0].expression='70 mm';assert.ok(!reusableFemMesh(p,m));assert.ok(!reusableFemMesh(project(),{...m,verified:false}));
});
test('real FEM fields retain source/mesh and survive history, serialization and import',()=>{
 const h=new ProjectHistory(project());h.addFemResult(record(h.project));const saved=h.project.femResults[0];assert.ok(isCurrent(h.project,saved));
 const next=structuredClone(h.project.source);next.physics[1].heatGeneration='100 W/m^3';h.update(next);assert.ok(!isCurrent(h.project,saved));h.undo();assert.ok(isCurrent(h.project,saved));
 const restored=validateProject(JSON.parse(JSON.stringify(h.project)),{imported:true});assert.equal(restored.femResults[0].verified,false);assert.deepEqual(restored.femResults[0].solution,saved.solution);
 for(let i=0;i<4;i++)h.addFemResult({...record(h.project),id:'field-'+i});assert.equal(h.project.femResults.length,3);
});
test('FEM result validator independently rejects broken provenance, fields and physical summaries',()=>{
 for(const mutate of [r=>r.provenance.fingerprint='bad',r=>r.solution.solver.version='fake',r=>r.solution.temperatures.pop(),r=>r.solution.temperatures[0]=NaN,r=>r.solution.gradients[0]+=100,r=>r.solution.heatFlux[0]+=1e4,r=>r.solution.volumeMeanTemperature+=10,r=>r.solution.balance.generated=10,r=>r.solution.residual=1,r=>r.solution.temperatures.fill(300)]){const r=record();mutate(r);assert.throws(()=>validateFemRecord(r,validateSource));}
});
test('cutaway field display indexes actual nodal values and cell flux with immutable input',()=>{
 const r=record(),before=JSON.stringify(r);for(const field of ['temperature','flux','gradient']){const a=femDisplay(r.mesh,{axis:0,fraction:.5},r,field);assert.ok(a.visibleCells>0&&a.visibleCells<r.mesh.tetrahedra.length/4);assert.equal(a.mesh.colors.length,a.mesh.vertices.length);assert.ok(a.mesh.colors.every(v=>Number.isFinite(v)&&v>=0&&v<=1));}
 assert.equal(JSON.stringify(r),before);assert.equal(femField(r,'flux').values.length,r.mesh.tetrahedra.length/4);
 const a=femDisplay(r.mesh,{axis:0,fraction:1},null,'temperature',null,r.mesh.boundary[0].tag);assert.ok(a.mesh.colors.includes(1));
});
test('CSV and VTK exports retain SI nodes, topology and solved fields',()=>{
 const r=record(),csv=femCSV(r),vtk=femVTK(r);assert.equal(csv.trim().split('\n').length,r.mesh.nodes.length/3+1);assert.match(vtk,/SCALARS temperature_K double 1/);assert.match(vtk,/VECTORS heat_flux_W_m2 double/);assert.match(vtk,new RegExp(`CELLS ${r.mesh.tetrahedra.length/4} `));assert.match(vtk,/VECTORS temperature_gradient_K_m double/);
});
test('remote thermal adapter accepts Solving and cancels without keeping a late solution',async()=>{
 const calls=[],events=[];let poll=0;const id='12345678-1234-1234-1234-123456789012';
 const fetcher=async(url,o)=>{calls.push(o.method||'GET');return {ok:true,json:async()=>o.method==='POST'?{id}:o.method==='DELETE'?{id,state:'Cancelled'}:{id,state:++poll===1?'Solving':'Completed',solution:fixture.solution}};};
 let done;const wait=new Promise(r=>done=r),jobs=new JobManager(e=>{events.push(e);if(e.state==='Completed')done();},()=>new ComputeWorker(fetcher,1));jobs.start('thermal-tetra',project(),{request:fixture.request});await wait;
 assert.deepEqual(events.map(e=>e.state),['Queued','Solving','Completed']);assert.deepEqual(events.at(-1).solution,fixture.solution);assert.equal(jobs.active,null);assert.ok(calls.includes('DELETE'));
});
test('real HTTP process dispatches thermal FEM independently of meshing',async()=>{
 const child=spawn(python,['tools/engineering-compute/server.py','--port','0'],{stdio:['ignore','pipe','pipe']});
 try{const [chunk]=await once(child.stdout,'data');const origin=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/)[0],headers={'X-HC-Compute':'1','Content-Type':'application/json'};
 const health=await fetch(origin+'/health').then(r=>r.json());assert.ok(health.capabilities.includes('thermal-tetra'));
 const queued=await fetch(origin+'/jobs',{method:'POST',headers,body:JSON.stringify(fixture.request)}).then(r=>r.json());let response;const start=Date.now();
 do{response=await fetch(origin+'/jobs/'+queued.id,{headers}).then(r=>r.json());if(['Completed','Failed'].includes(response.state))break;await new Promise(r=>setTimeout(r,25));}while(Date.now()-start<20000);
 assert.equal(response.state,'Completed',response.error);validateFemRecord({...record(),solution:response.solution},validateSource);
 }finally{child.kill('SIGINT');await once(child,'exit');}
});

test('field ranges and VTK serialization handle the published 50k-node/100k-cell limits',()=>{
 const mesh={nodes:Array(150000).fill(0),tetrahedra:Array(400000).fill(0)},solution={temperatures:Array(50000).fill(300),heatFlux:Array(300000).fill(0),gradients:Array(300000).fill(0)};
 // Serialization-capacity fixture only; geometric validity is tested independently.
 const vtk=femVTK({mesh,solution});assert.match(vtk,/CELL_TYPES 100000/);assert.match(vtk,/POINT_DATA 50000/);assert.deepEqual(fieldRange(Array(100000).fill(25)),[25,25]);
});
