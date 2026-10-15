import test from 'node:test';
import assert from 'node:assert/strict';
import {access,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {createProject,validateProject,validateSource,ProjectHistory,fingerprint,isCurrent} from '../docs/engineering/project.mjs';
import {inspectVolumeMesh,tetraMeasure,resolveVolumeMesh,defaultVolumeMesh,volumeMeshDisplay,volumeMeshMSH,validateVolumeMeshRecord} from '../docs/engineering/volume-mesh.mjs';
import {parameters} from '../docs/engineering/units.mjs';
import {ComputeWorker,computeHealth} from '../docs/engineering/compute-client.mjs';
import {JobManager} from '../docs/engineering/jobs.mjs';
const execute=promisify(execFile),directory=await mkdtemp(path.join(tmpdir(),'hc-volume-tests-'));
const localPython=path.resolve('tools/engineering-compute/.venv/bin/python');
const python=process.env.ENGINEERING_PYTHON||await access(localPython).then(()=>localPython,()=> 'python3');
const fixtureFile=path.join(directory,'fixture.json');
await execute(python,['tools/engineering-compute/test_compute.py','--fixture-file',fixtureFile]);
const fixture=JSON.parse(await readFile(fixtureFile,'utf8'));
test.after(()=>rm(directory,{recursive:true,force:true}));
const near=(a,b,t=1e-12)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);
const example=()=>{const p=createProject('volume-project');p.source.meshes.push({...defaultVolumeMesh('body-block'),id:'mesh-tetra',minSize:'1 mm',maxSize:'4 mm',curvature:20});return validateProject(p);};
const record=(p=example(),id='volume-record')=>({id,provenance:{projectId:p.id,revision:p.revision,source:structuredClone(p.source),fingerprint:fingerprint(p.source),createdAt:'2026-10-12T12:00:00Z'},mesh:structuredClone(fixture.mesh),verified:true});
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const remoteId='f941764d-8b45-45f0-83f6-ffb1cbb602c5';

test('tetrahedral mesh settings preserve legacy serialization and validate unit-aware sizing',()=>{
 const p=createProject('legacy');assert.equal(JSON.stringify(validateSource(p.source).source),JSON.stringify(p.source));
 const def=defaultVolumeMesh('body-block');const values=parameters([{name:'target',expression:'4 mm'}]);
 const resolved=resolveVolumeMesh({...def,maxSize:'target',minSize:'target/4'},values,'body-block');near(resolved.settings.maxSize,.004);
 for(const change of [{minSize:'0 mm'},{maxSize:'1 s'},{maxSize:'0.1 mm'},{curvature:1.5},{curvature:65},{bodyId:'other'},{id:'bad id'}])assert.throws(()=>resolveVolumeMesh({...def,...change},values,'body-block'));
 assert.equal(validateSource(example().source).source.meshes.length,2);
 const bad=example();bad.source.meshes.push({...def,id:'third'});assert.throws(()=>validateSource(bad.source));
});

test('tetra volume and mean-ratio quality agree with independent regular tetrahedron geometry',()=>{
 const regular=[[0,0,0],[1,0,0],[.5,Math.sqrt(3)/2,0],[.5,Math.sqrt(3)/6,Math.sqrt(2/3)]];
 const m=tetraMeasure(regular);near(m.volume,Math.sqrt(2)/12);near(m.quality,1);
 assert.ok(tetraMeasure([regular[1],regular[0],regular[2],regular[3]]).volume<0);
});

test('actual Gmsh tetrahedra fill the exact SI box and have a complete outward boundary',()=>{
 const {stats,mesh}=inspectVolumeMesh(fixture.mesh);near(stats.volume,.000012);near(mesh.cadVolume,.000012);
 assert.equal(mesh.boundary.length,6);assert.deepEqual(stats.bounds,[[0,0,0],[.06,.02,.01]]);assert.ok(stats.elements>500);assert.ok(stats.minQuality>.2);assert.equal(stats.poorElements,0);
 let surfaceVolume=0;
 for(const g of mesh.boundary)for(let i=0;i<g.triangles.length;i+=3){const [a,b,c]=g.triangles.slice(i,i+3).map(n=>mesh.nodes.slice(n*3,n*3+3));surfaceVolume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;}
 near(surfaceVolume,stats.volume);
});

test('mesh inspection rejects corrupted, inverted, duplicate, incomplete and unsupported data',()=>{
 for(const change of [m=>m.nodes[0]=NaN,m=>m.tetrahedra[0]=-1,m=>[m.tetrahedra[0],m.tetrahedra[1]]=[m.tetrahedra[1],m.tetrahedra[0]],m=>m.tetrahedra.push(...m.tetrahedra.slice(0,4)),m=>m.boundary[0].triangles.splice(0,3),m=>m.boundary.push(structuredClone(m.boundary[0])),m=>m.nodes.push(1,1,1),m=>m.cadVolume*=2,m=>m.mesher.order=2,m=>m.stepSha256='bad']){
  const mesh=structuredClone(fixture.mesh);change(mesh);assert.throws(()=>inspectVolumeMesh(mesh));
 }
});

test('cutaway shows actual subset tetrahedra, with unchanged full geometry bounds',()=>{
 const whole=volumeMeshDisplay(fixture.mesh),half=volumeMeshDisplay(fixture.mesh,0,.5),empty=volumeMeshDisplay(fixture.mesh,0,0);
 assert.equal(whole.visibleCells,fixture.mesh.tetrahedra.length/4);assert.equal(empty.visibleCells,0);
 assert.ok(half.visibleCells>whole.visibleCells*.3&&half.visibleCells<whole.visibleCells*.7);assert.deepEqual(half.bounds,whole.bounds);
 assert.ok(half.mesh.normals.every(Number.isFinite));assert.ok(half.mesh.vertices.every(Number.isFinite));assert.equal(half.mesh.vertices.length,half.mesh.normals.length);
 assert.throws(()=>volumeMeshDisplay(fixture.mesh,4));
});

test('project history preserves meshes as stale source snapshots and imports mark them unverified',()=>{
 const history=new ProjectHistory(example());history.addVolumeMesh(record(history.project));
 const saved=history.project.volumeMeshes[0];assert.ok(isCurrent(history.project,saved));
 const next=structuredClone(history.project.source);next.parameters[0].expression='80 mm';history.update(next);
 assert.ok(!isCurrent(history.project,saved));assert.equal(saved.provenance.source.parameters[0].expression,'60 mm');
 history.undo();assert.ok(isCurrent(history.project,saved));history.redo();
 const imported=validateProject(JSON.parse(JSON.stringify(history.project)),{imported:true});assert.equal(imported.volumeMeshes[0].verified,false);
 assert.deepEqual(imported.volumeMeshes[0].mesh,saved.mesh);
 for(let i=0;i<4;i++)history.addVolumeMesh(record(example(),`retained-${i}`));assert.equal(history.project.volumeMeshes.length,3);
 const corrupt=record();corrupt.provenance.source.parameters[0].expression='70 mm';assert.throws(()=>validateVolumeMeshRecord(corrupt,validateSource),/fingerprint/);
});

test('MSH export round-trips real tetrahedra and boundary groups through Gmsh',async()=>{
 const file=path.join(directory,'mesh.msh');await writeFile(file,volumeMeshMSH(fixture.mesh));
 const {stdout}=await execute(python,['-c',`import gmsh,json;gmsh.initialize([],readConfigFiles=False);gmsh.option.setNumber('General.Terminal',0);gmsh.open(${JSON.stringify(file)});n=gmsh.model.mesh.getNodes()[0];t=gmsh.model.mesh.getElementsByType(4)[0];s=gmsh.model.mesh.getElementsByType(2)[0];print(json.dumps([len(n),len(t),len(s)]));gmsh.finalize()`]);
 assert.deepEqual(JSON.parse(stdout),[fixture.mesh.nodes.length/3,fixture.mesh.tetrahedra.length/4,fixture.mesh.boundary.reduce((sum,g)=>sum+g.triangles.length/3,0)]);
});

test('compute transport shares job lifecycle and immutable inputs with browser jobs',async()=>{
 const calls=[],events=[];let polls=0;
 const fetcher=async(url,options)=>{calls.push([url,options]);if(options.method==='DELETE')return response({state:'Cancelled'});if(options.method==='POST')return response({id:remoteId,state:'Queued'},202);return response({id:remoteId,state:++polls===1?'Meshing':'Completed',mesh:fixture.mesh});};
 let resolve;const done=new Promise(r=>resolve=r),jobs=new JobManager(e=>{events.push(e);if(e.state==='Completed')resolve();},()=>new ComputeWorker(fetcher,1));
 const p=example(),options={request:structuredClone(fixture.request)};jobs.start('volume-mesh',p,options);options.request.settings.maxSize=1;p.source.parameters[0].expression='100 mm';await done;
 assert.equal(jobs.active,null);assert.deepEqual(events.map(e=>e.state),['Queued','Meshing','Completed']);
 assert.equal(JSON.parse(calls.find(([,o])=>o.method==='POST')[1].body).settings.maxSize,.004);assert.ok(calls.some(([,o])=>o.method==='DELETE'));
});

test('cancel before queue acknowledgement terminates the late-created process and emits no late result',async()=>{
 let acknowledge;const posted=new Promise(r=>acknowledge=r),calls=[],events=[];
 const fetcher=async(url,options)=>{calls.push(options.method||'GET');return options.method==='POST'?posted:response({state:'Cancelled'});};
 const worker=new ComputeWorker(fetcher,1);worker.onmessage=e=>events.push(e.data);
 const pending=worker.postMessage({id:remoteId,action:'volume-mesh',options:{request:fixture.request}});worker.terminate();acknowledge(response({id:remoteId},202));await pending;
 assert.deepEqual(calls,['POST','DELETE']);assert.deepEqual(events,[]);
});

test('compute health and API failures stay explicit without fabricated mesh results',async()=>{
 await assert.rejects(computeHealth(async()=>{throw Error('offline');}),/offline/);
 await assert.rejects(computeHealth(async()=>response({service:'other'})),/supported/);
 const worker=new ComputeWorker(async()=>response({error:'too fine'},400));const events=[];worker.onmessage=e=>events.push(e.data);await worker.postMessage({id:remoteId,action:'volume-mesh',options:{request:fixture.request}});
 assert.equal(events[0].state,'Failed');assert.match(events[0].error,/too fine/);assert.ok(!events[0].mesh);
});

test('real loopback service enforces API boundaries and returns a usable mesh',async()=>{
 const child=spawn(python,['tools/engineering-compute/server.py','--port','0'],{stdio:['ignore','pipe','pipe']});
 try{
  const [chunk]=await once(child.stdout,'data');const origin=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert.ok(origin);
  const health=await fetch(origin+'/health').then(r=>r.json());assert.equal(health.mesher,'4.15.2');
  assert.equal((await fetch(origin+'/health',{headers:{Origin:'https://untrusted.example'}})).status,403);
  assert.equal((await fetch(origin+'/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fixture.request)})).status,403);
  const queued=await fetch(origin+'/jobs',{method:'POST',headers:{'Content-Type':'application/json','X-HC-Compute':'1'},body:JSON.stringify(fixture.request)}).then(r=>r.json());assert.ok(queued.id);
  let result;const started=Date.now();do{result=await fetch(origin+'/jobs/'+queued.id,{headers:{'X-HC-Compute':'1'}}).then(r=>r.json());if(result.state==='Completed'||result.state==='Failed')break;await new Promise(r=>setTimeout(r,30));}while(Date.now()-started<20000);
  assert.equal(result.state,'Completed',result.error);near(inspectVolumeMesh(result.mesh).stats.volume,.000012);
  const cancelled=await fetch(origin+'/jobs/'+queued.id,{method:'DELETE',headers:{'X-HC-Compute':'1'}}).then(r=>r.json());assert.equal(cancelled.state,'Cancelled');
 }finally{child.kill('SIGINT');await once(child,'exit');}
});
