import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,symlink,rm,readdir,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {validateSTEPFileSize,validateSTEPAsset,MAX_STEP_BYTES} from '../docs/engineering/step-input.mjs';
import {uploadSTEP,NativeCadClient,validateNativeArtifact} from '../docs/engineering/native-cad.mjs';
import {createProject,validateProject,ProjectHistory} from '../docs/engineering/project.mjs';
import {stepSource} from '../docs/engineering/cad-import.mjs';
import {buildSolid,describeSolid,exportSolid} from '../docs/engineering/cad-kernel.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'hc-step-upload-')),folder=path.join(root,'tools/engineering-compute');await mkdir(folder,{recursive:true});await symlink(path.resolve('tools/engineering-compute/runner.py'),path.join(folder,'runner.py'));
let python=process.env.ENGINEERING_PYTHON||'python3';try{await access('tools/engineering-compute/.venv/bin/python');python=path.resolve('tools/engineering-compute/.venv/bin/python');}catch{}
const server=spawn(path.resolve('engineering-rust/target/release/engineering-server'),['--port','0','--root',root,'--python',python],{stdio:['ignore','pipe','pipe']});let stderr='';server.stderr.on('data',d=>stderr+=d);const url=await new Promise((resolve,reject)=>{let text='';server.stdout.on('data',d=>{text+=d;const m=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(m)resolve(m[0]);});server.on('exit',()=>reject(Error(stderr)));});
const headers={'X-HC-Compute':'1'},jsonHeaders={...headers,'Content-Type':'application/json'},fetcher=(u,o)=>fetch(u.replace('http://127.0.0.1:8766',url),o),step=await readFile(new URL('fixtures/engineering-step/torus.step',import.meta.url));
test.after(async()=>{server.kill('SIGINT');await once(server,'exit');await rm(root,{recursive:true,force:true});});
async function job(q){const response=await fetch(url+'/jobs',{method:'POST',headers:jsonHeaders,body:JSON.stringify(q)}),data=await response.json();assert.equal(response.status,202,JSON.stringify(data));for(let i=0;i<400;i++){const r=await fetch(url+'/jobs/'+data.id,{headers}).then(r=>r.json());if(['Completed','Failed','Cancelled'].includes(r.state)){await fetch(url+'/jobs/'+data.id,{method:'DELETE',headers});return r;}await new Promise(r=>setTimeout(r,30));}throw Error('Job timed out');}

test('1.5 GB size boundary is exact and invalid asset references reject without allocating huge strings',()=>{
 assert.equal(MAX_STEP_BYTES,1_500_000_000);assert.equal(validateSTEPFileSize(MAX_STEP_BYTES),MAX_STEP_BYTES);for(const n of [0,-1,MAX_STEP_BYTES+1,NaN,1.5])assert.throws(()=>validateSTEPFileSize(n));assert.throws(()=>validateSTEPAsset({sha256:'../bad',bytes:3}));
});
test('streamed STEP upload persists original bytes and survives another project session',async()=>{
 const asset=await uploadSTEP(new Blob([step]),undefined,fetcher);assert.equal(asset.sha256,createHash('sha256').update(step).digest('hex'));assert.equal(asset.bytes,step.length);assert.deepEqual(Buffer.from(await fetch(url+'/step-assets/'+asset.sha256,{headers}).then(r=>r.arrayBuffer())),step);
 const source=stepSource(createProject().source,asset,'torus.step'),h=new ProjectHistory(createProject());h.update(source);h.checkpoint('Stored curved model');const restored=validateProject(JSON.parse(JSON.stringify(h.project)),{imported:true});assert.deepEqual(restored.source.features[0].stepAsset,asset);assert.ok(!('stepText' in restored.source.features[0]));assert.deepEqual(restored.versions[0].source.features[0].stepAsset,asset);assert.ok(JSON.stringify(restored).length<20000);
 const client=new NativeCadClient(function(u,o){assert.equal(this,undefined,'Browser fetch must not receive the CAD client as its receiver');return fetcher(u,o);}),{artifact}=await client.request('build',{source});assert.ok(artifact.triangleCount>100);assert.ok(Math.abs(artifact.volume/(2*Math.PI**2*.015*.005**2)-1)<1e-10);assert.equal(validateNativeArtifact(artifact),artifact);
 const exported=await client.request('export',{format:'step',fingerprint:artifact.fingerprint});assert.deepEqual(Buffer.from(await exported.blob.arrayBuffer()),step);const stl=await client.request('export',{format:'stl',fingerprint:artifact.fingerprint});assert.equal(stl.blob.size,84+50*artifact.triangleCount);const view=new DataView(await stl.blob.arrayBuffer());let stlVolume=0;for(let i=0;i<artifact.triangleCount;i++){const p=[0,1,2].map(v=>[0,1,2].map(a=>view.getFloat32(84+50*i+12+12*v+4*a,true)));stlVolume+=(p[0][0]*(p[1][1]*p[2][2]-p[1][2]*p[2][1])+p[0][1]*(p[1][2]*p[2][0]-p[1][0]*p[2][2])+p[0][2]*(p[1][0]*p[2][1]-p[1][1]*p[2][0]))/6;}assert.ok(Math.abs(stlVolume/1e9/artifact.volume-1)<.03);
 const volume=await job({kind:'gmsh-tetra',stepAsset:asset,settings:{minSize:.002,maxSize:.004,curvature:20},expectedVolume:artifact.volume});assert.equal(volume.state,'Completed',volume.error);assert.equal(volume.mesh.stepSha256,asset.sha256);client.reset();
});
test('upload access controls, malformed files and client filesystem paths are rejected',async()=>{
 assert.equal((await fetch(url+'/step-assets',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:step})).status,403);
 assert.equal((await fetch(url+'/step-assets',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream',Origin:'https://untrusted.example'},body:step})).status,403);
 for(const body of ['broken','ISO-10303-21;\u0000END-ISO-10303-21;'])assert.equal((await fetch(url+'/step-assets',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body})).status,400);
 assert.equal((await fetch(url+'/jobs',{method:'POST',headers:jsonHeaders,body:JSON.stringify({kind:'gmsh-tetra',stepPath:'/etc/passwd'})})).status,400);
 assert.equal((await fetch(url+'/jobs',{method:'POST',headers:jsonHeaders,body:JSON.stringify({kind:'cad-step',stepAsset:{sha256:'0'.repeat(64),bytes:100}})})).status,404);
 assert.ok((await readdir(path.join(folder,'.step-assets'))).every(n=>/^[a-f0-9]{64}\.step$/.test(n)));
});
test('interrupted uploads remove temporary data and release the upload slot',async()=>{
 const r=http.request(url+'/step-assets',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'}},r=>r.resume());r.on('error',()=>{});r.write('ISO-10303-21;\n');
 let seen=false;for(let i=0;i<100;i++){if((await readdir(path.join(folder,'.step-assets'))).some(n=>n.startsWith('upload-'))){seen=true;break;}await new Promise(r=>setTimeout(r,10));}assert.ok(seen);r.destroy();
 for(let i=0;i<100;i++){if(!(await readdir(path.join(folder,'.step-assets'))).some(n=>n.startsWith('upload-')))break;await new Promise(r=>setTimeout(r,10));}
 assert.ok((await readdir(path.join(folder,'.step-assets'))).every(n=>!n.startsWith('upload-')));assert.equal((await uploadSTEP(new Blob([step]),undefined,fetcher)).bytes,step.length);
});
test('real browser kernel accepts closed spherical, conical, toroidal and NURBS STEP surfaces',async()=>{
 for(const name of ['sphere','cone','torus','nurbs-sphere','nurbs-cylinder']){const text=await readFile(new URL('fixtures/engineering-step/'+name+'.step',import.meta.url),'utf8'),source=stepSource(createProject().source,text,name+'.step');const shape=await buildSolid(source);try{const a=describeSolid(shape,source);assert.ok(a.volume>0&&a.triangleCount>100);assert.ok(a.mesh.vertices.every(Number.isFinite));const again=await buildSolid(stepSource(source,await exportSolid(shape,'step').text(),name+'.step'));try{assert.ok(Math.abs(describeSolid(again,source).volume/a.volume-1)<1e-7);}finally{again.delete();}}finally{shape.delete();}}
});

test('native multi-part CAD preserves transforms, patterns, exported units and rejects nested filesystem paths',async()=>{
 const asset=await uploadSTEP(new Blob([step]),undefined,fetcher);
 const operations=[{id:'part',type:'step-part',operation:'add',stepAsset:asset,translation:[60,0,0],rotation:[0,90,0]},{id:'pattern',type:'linear-pattern',count:2,spacing:[0,80,0]}];
 const built=await job({kind:'cad-step',stepAsset:asset,operations});assert.equal(built.state,'Completed',built.error);const a=built.artifact;assert.equal(a.solidCount,4);assert.ok(Math.abs(a.volume/(4*2*Math.PI**2*.015*.005**2)-1)<1e-9);assert.notEqual(a.stepAsset.sha256,asset.sha256);
 const exported=await fetch(url+'/step-assets/'+a.stepAsset.sha256,{headers}).then(r=>r.text());const s=stepSource(createProject().source,exported,'native-assembly.step'),shape=await buildSolid(s);try{const b=describeSolid(shape,s);assert.equal(b.solidCount,4);assert.ok(Math.abs(b.volume/a.volume-1)<1e-6);assert.ok(b.bounds[1][0]>.06&&b.bounds[1][0]<.09);}finally{shape.delete();}
 const reloaded=await job({kind:'cad-step',stepAsset:a.stepAsset});assert.equal(reloaded.state,'Completed',reloaded.error);assert.equal(reloaded.artifact.solidCount,4);
 assert.equal((await fetch(url+'/jobs',{method:'POST',headers:jsonHeaders,body:JSON.stringify({kind:'cad-step',stepAsset:asset,operations:[{...operations[0],stepPath:'/etc/passwd'}]})})).status,400);
 const empty=await job({kind:'cad-step',stepAsset:asset,operations:[{...operations[0],operation:'intersect',translation:[200,0,0]}]});assert.equal(empty.state,'Failed');assert.match(empty.error,/closed solid/);
});

test('native STEP Boolean tools produce current export assets and single-solid FEM meshes',async()=>{
 const source=createProject().source;source.features[0].dimensions=['10 mm','10 mm','10 mm'];const box=await buildSolid(source);let text;try{text=await exportSolid(box,'step').text();}finally{box.delete();}const asset=await uploadSTEP(new Blob([text]),undefined,fetcher);
 for(const [operation,volume] of [['union',1500],['subtract',500],['intersect',500]]){
  const result=await job({kind:'cad-step',stepAsset:asset,operations:[{type:'step-part',operation,stepAsset:asset,translation:[5,0,0],rotation:[0,0,0]}]});assert.equal(result.state,'Completed',result.error);assert.equal(result.artifact.solidCount,1);assert.ok(Math.abs(result.artifact.volume*1e9-volume)<1e-6);
  if(operation==='subtract'){const mesh=await job({kind:'gmsh-tetra',stepAsset:result.artifact.stepAsset,settings:{minSize:.001,maxSize:.003,curvature:10},expectedVolume:result.artifact.volume});assert.equal(mesh.state,'Completed',mesh.error);assert.equal(mesh.mesh.stepSha256,result.artifact.stepAsset.sha256);}
 }
});
