import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,access} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {execFile,spawn} from 'node:child_process';import {promisify} from 'node:util';import {once} from 'node:events';
import {createProject,validateProject,validateSource,ProjectHistory,fingerprint,isCurrent} from '../docs/engineering/project.mjs';
import {cadFingerprint} from '../docs/engineering/cad-model.mjs';
import {faceSupport,faceReference} from '../docs/engineering/face-references.mjs';
import {STRUCTURAL_SOLVER,structuralRequest,validateStructuralRecord,cellStrain,elasticStress,vonMises,structuralCSV,structuralVTK} from '../docs/engineering/structural-fem-data.mjs';
import {structuralField,structuralDisplay} from '../docs/engineering/structural-fem-view.mjs';
import {localAction,assertStudy} from '../docs/engineering/physics-registry.mjs';
import {ComputeWorker} from '../docs/engineering/compute-client.mjs';
import {JobManager} from '../docs/engineering/jobs.mjs';
const exec=promisify(execFile),dir=await mkdtemp(path.join(os.tmpdir(),'hc-structural-'));let python=process.env.ENGINEERING_PYTHON||'python3';try{await access('tools/engineering-compute/.venv/bin/python');python=path.resolve('tools/engineering-compute/.venv/bin/python');}catch{}
const file=path.join(dir,'fixture.json');await exec(python,['-c',`import sys,json;sys.path.insert(0,'tools/engineering-compute');from test_structural import StructuralTests;from structural_fem import solve_structural;StructuralTests.setUpClass();q=StructuralTests().request();open(${JSON.stringify(file)},'w').write(json.dumps({'request':q,'solution':solve_structural(q)}))`]);const fixture=JSON.parse(await readFile(file,'utf8'));test.after(()=>rm(dir,{recursive:true,force:true}));
function project(){
 const p=createProject('structural-project');p.source.meshes.push({id:'mesh-tetra',bodyId:'body-block',type:'gmsh-tetra',minSize:'1 mm',maxSize:'4 mm',curvature:20});
 p.source.materials[0].properties={youngModulus:'70 GPa',poissonRatio:'0.3',yieldStrength:'250 MPa'};
 const key=cadFingerprint(p.source);p.source.physics.push({id:'physics-structural',type:'linear-elasticity',bodyId:'body-block',geometryKey:key,support:faceSupport(p.source),gravity:['0 m/s^2','0 m/s^2','0 m/s^2'],boundaries:fixture.request.boundaries.map((b,i)=>({face:faceReference(fixture.request.mesh.boundary.find(g=>g.tag===b.tag),'face-'+i),type:b.type,values:b.values.map(v=>v===null?null:v+(b.type==='force'?' N':' m'))}))});
 p.source.studies.push({id:'study-structural',name:'Static structure',type:'static',physicsId:'physics-structural',meshId:'mesh-tetra',solverId:STRUCTURAL_SOLVER});return validateProject(p);
}
function record(p=project()){return {id:'structural-result',provenance:{projectId:p.id,revision:p.revision,createdAt:'2026-10-12T13:00:00Z',meshId:'mesh-record',source:structuredClone(p.source),fingerprint:fingerprint(p.source)},mesh:structuredClone(fixture.request.mesh),solution:structuredClone(fixture.solution),verified:true};}

test('static structural study uses the shared source and registered local execution',()=>{
 const p=project();assert.equal(assertStudy(p.source.studies[1],p.source.physics[1],p.source.meshes[1]).action,'structural-tetra');assert.ok(localAction('structural-tetra'));assert.deepEqual(structuralRequest(validateSource(p.source),fixture.request.mesh),fixture.request);
});
test('constant elastic materials, units, supported references and constraints are enforced',()=>{
 for(const change of [p=>delete p.source.materials[0].properties.youngModulus,p=>p.source.materials[0].properties.poissonRatio='.499',p=>p.source.physics[1].gravity[0]='1 N',p=>p.source.physics[1].geometryKey='changed',p=>p.source.physics[1].boundaries=[]]){const p=project();change(p);assert.throws(()=>structuralRequest(validateSource(p.source),fixture.request.mesh));}
 const p=project();p.source.materials[0].properties.youngModulus={type:'table',axis:'temperature',outside:'clamp',points:[{x:'300 K',y:'70 GPa'},{x:'400 K',y:'60 GPa'}]};assert.throws(()=>structuralRequest(validateSource(p.source),fixture.request.mesh),/constant/);
 const g=project();g.source.materials[0].density={type:'table',axis:'temperature',outside:'clamp',points:[{x:'300 K',y:'2700 kg/m^3'},{x:'400 K',y:'2600 kg/m^3'}]};g.source.materials[0].reference={temperature:'300 K'};g.source.physics[1].gravity[2]='-9.81 m/s^2';assert.throws(()=>structuralRequest(validateSource(g.source),fixture.request.mesh),/constant density/);
});
test('independent tensor reconstruction handles affine shear and von Mises convention',()=>{
 const points=[[0,0,0],[2,0,0],[0,3,0],[0,0,4]],u=points.map(([x,y,z])=>[.001*x+.004*y,.002*y,.003*z]);const strain=cellStrain(points,u);assert.deepEqual(strain,[.001,.002,.003,.002,0,0]);
 const stress=elasticStress(strain,1e9,0);assert.deepEqual(stress,[1e6,2e6,3e6,2e6,0,0]);assert.ok(Math.abs(vonMises([0,0,0,2e6,0,0])-Math.sqrt(3)*2e6)<1e-8);
});
test('computed structural fields, balance and energy survive validation, history and import',()=>{
 const h=new ProjectHistory(project());h.addStructuralResult(record(h.project));const saved=h.project.structuralResults[0];assert.ok(isCurrent(h.project,saved));
 const next=structuredClone(h.project.source);next.physics[1].boundaries.at(-1).values[0]='200 N';h.update(next);assert.ok(!isCurrent(h.project,saved));h.undo();assert.ok(isCurrent(h.project,saved));
 const imported=validateProject(JSON.parse(JSON.stringify(h.project)),{imported:true});assert.equal(imported.structuralResults[0].verified,false);assert.deepEqual(imported.structuralResults[0].solution,saved.solution);
 for(let i=0;i<4;i++)h.addStructuralResult({...record(h.project),id:'kept-'+i});assert.equal(h.project.structuralResults.length,3);
});
test('corrupt displacements, constitutive fields, principals, energy and reactions are rejected',()=>{
 for(const change of [r=>r.provenance.fingerprint='bad',r=>r.solution.solver.element='fake',r=>r.solution.displacements.pop(),r=>r.solution.displacements[0]=1,r=>r.solution.stresses[0]+=1e6,r=>r.solution.strains[0]+=.1,r=>r.solution.vonMises[0]+=1e6,r=>r.solution.principal[0]+=1e6,r=>r.solution.strainEnergy+=1,r=>r.solution.reactions.fill(0),r=>r.solution.balance.appliedForce[0]+=10,r=>r.solution.maxStrain+=1]){const r=record();change(r);assert.throws(()=>validateStructuralRecord(r,validateSource));}
});
test('mesh cutaways and deformed stress fields use actual nodes and leave saved fields unchanged',()=>{
 const r=validateStructuralRecord(record(),validateSource),before=JSON.stringify(r),cut={axis:0,fraction:.5};
 for(const field of ['vonMises','displacement','principalMax','principalMin','strain']){const v=structuralField(r,field),a=structuralDisplay(r,cut,field,null,100);assert.ok(v.values.length>0);assert.ok(a.visibleCells>0&&a.visibleCells<r.mesh.tetrahedra.length/4);assert.equal(a.mesh.colors.length,a.mesh.vertices.length);assert.ok(a.mesh.vertices.every(Number.isFinite));}
 const a=structuralDisplay(r,cut,'vonMises',null,0),b=structuralDisplay(r,cut,'vonMises',null,100);assert.notDeepEqual(a.mesh.vertices,b.mesh.vertices);assert.equal(JSON.stringify(r),before);assert.throws(()=>structuralDisplay(r,cut,'vonMises',null,-1));
});
test('structural CSV/VTK exports keep SI displacement, reactions and tensor fields',()=>{
 const r=record(),csv=structuralCSV(r),vtk=structuralVTK(r);assert.equal(csv.trim().split('\n').length,r.mesh.nodes.length/3+1);assert.match(csv,/reaction_x_N/);assert.match(vtk,/TENSORS stress_Pa double/);assert.match(vtk,/TENSORS strain double/);assert.match(vtk,/VECTORS displacement_m double/);
});
test('structural jobs share immutable input, progress and cancellation lifecycle',async()=>{
 const id='12345678-1234-1234-1234-123456789012',events=[],requests=[];let polls=0,done;const finished=new Promise(r=>done=r);
 const fetcher=async(url,o)=>{requests.push(o);return {ok:true,json:async()=>o.method==='POST'?{id}:o.method==='DELETE'?{id,state:'Cancelled'}:{id,state:++polls===1?'Solving':'Completed',solution:fixture.solution}};};
 const jobs=new JobManager(e=>{events.push(e);if(e.state==='Completed')done();},()=>new ComputeWorker(fetcher,1)),p=project(),q=structuredClone(fixture.request);jobs.start('structural-tetra',p,{request:q});q.youngModulus=1;p.source.materials[0].properties.youngModulus='1 Pa';await finished;
 assert.deepEqual(events.map(e=>e.state),['Queued','Solving','Completed']);assert.equal(JSON.parse(requests.find(o=>o.method==='POST').body).youngModulus,70e9);assert.equal(jobs.active,null);
});
test('real local HTTP dispatch solves structural inputs and returns validated fields',async()=>{
 const child=spawn(python,['tools/engineering-compute/server.py','--port','0'],{stdio:['ignore','pipe','pipe']});try{
  const [chunk]=await once(child.stdout,'data'),url=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/)[0],headers={'X-HC-Compute':'1','Content-Type':'application/json'};
  assert.ok((await fetch(url+'/health').then(r=>r.json())).capabilities.includes('structural-tetra'));
  const job=await fetch(url+'/jobs',{method:'POST',headers,body:JSON.stringify(fixture.request)}).then(r=>r.json());let e;const start=Date.now();do{e=await fetch(url+'/jobs/'+job.id,{headers}).then(r=>r.json());if(['Completed','Failed'].includes(e.state))break;await new Promise(r=>setTimeout(r,25));}while(Date.now()-start<20000);
  assert.equal(e.state,'Completed',e.error);validateStructuralRecord({...record(),solution:e.solution},validateSource);
 }finally{child.kill('SIGINT');await once(child,'exit');}
});
