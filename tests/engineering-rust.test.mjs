import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {spawn,execFile} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
import {promisify} from 'node:util';
import {runtime} from '../docs/engineering/rust-runtime.mjs';
import * as legacy from './fixtures/engineering-rust/legacy-units.mjs';
import {evaluate,parameters} from '../docs/engineering/units.mjs';
import {createProject,validateProject,validateSource,ProjectHistory,fingerprint,isCurrent} from '../docs/engineering/project.mjs';
import {cadFingerprint} from '../docs/engineering/cad-model.mjs';
import {faceSupport,faceReference} from '../docs/engineering/face-references.mjs';
import {electricRequest,validateElectricRecord,electricResistance,electricCSV,electricVTK} from '../docs/engineering/electric-fem-data.mjs';
import {electricDisplay} from '../docs/engineering/electric-fem-view.mjs';
const fixture=JSON.parse(await readFile(new URL('./fixtures/engineering-rust/scalar-fem.json',import.meta.url),'utf8'));
const {mesh}=fixture,ends=[...mesh.boundary].sort((a,b)=>a.center[0]-b.center[0]),low=ends[0].tag,high=ends.at(-1).tag;
const close=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<=tol*Math.max(1,Math.abs(a),Math.abs(b)),`${a} ≉ ${b}`);
const solve=q=>JSON.parse(runtime.solve_electrical_tetra(JSON.stringify(q)));
const request=()=>({kind:'electric-tetra',mesh,conductivity:100,boundaries:[{tag:low,type:'voltage',voltage:0},{tag:high,type:'voltage',voltage:2}]});
function project(){const p=createProject('rust-project');p.source.materials[0].properties={electricalConductivity:'100 S/m'};p.source.meshes.push({id:'cad-mesh',bodyId:'body-block',type:'gmsh-tetra',minSize:'1 mm',maxSize:'4 mm',curvature:20});p.source.physics.push({id:'electric',type:'dc-conduction',bodyId:'body-block',geometryKey:cadFingerprint(p.source),support:faceSupport(p.source),boundaries:request().boundaries.map((b,i)=>({face:faceReference(mesh.boundary.find(g=>g.tag===b.tag),'terminal-'+i),type:'voltage',expression:b.voltage+' V'}))});p.source.studies.push({id:'electric-study',name:'DC conduction',type:'steady-state',physicsId:'electric',meshId:'cad-mesh',solverId:'hc-electric-fem-1'});return validateProject(p);}
const record=(p=project())=>({id:'electric-result',provenance:{projectId:p.id,revision:p.revision,source:p.source,fingerprint:fingerprint(p.source),createdAt:'2026-10-12T12:00:00Z',meshId:'mesh-result'},mesh,solution:solve(electricRequest(validateSource(p.source),mesh)),verified:true});

test('Rust units preserve all original aliases, precedence, dependencies and rejection behavior',()=>{
 const source=readFile(new URL('./fixtures/engineering-rust/legacy-units.mjs',import.meta.url),'utf8');return source.then(text=>{const units=[...text.matchAll(/unit\("([^"]+)"/g)].flatMap(m=>m[1].split(' '));for(const expression of [...units.map(u=>'3 '+u),'1.2 mm + 2 cm','2^3^2','-2^2','2^-3','(3 kg)/(2 m^3)','25 °C','180 deg','1/(3 MS/m)','(2 m)^0.5',...Array.from({length:80},(_,i)=>`${i+1} mm + (${i} / 3) cm`)]){const a=evaluate(expression),b=legacy.evaluate(expression);close(a.value,b.value,1e-12);assert.deepEqual(a.dim,b.dim);}
 for(const expression of ['','1 m + 1 s','1/0','2^13','sqrt(2)','-274 C','window.x','1;alert(1)','1e999 m']){assert.throws(()=>evaluate(expression),expression);assert.throws(()=>legacy.evaluate(expression),expression);}
 const list=[{id:'a',name:'L',expression:'6 cm'},{id:'b',name:'area',expression:'L * 2 mm'},{id:'c',name:'S',expression:'2 mm'}];for(const [name,q]of legacy.parameters(list)){const r=parameters(list).get(name);close(q.value,r.value,1e-12);assert.deepEqual(q.dim,r.dim);}assert.throws(()=>parameters([{name:'a',expression:'b'},{name:'b',expression:'a'}]),/Circular/);
 });
});
test('Rust WASM thermal FEM matches independent SciPy solutions for four boundary/source cases',()=>{
 for(const c of fixture.cases){const r=JSON.parse(runtime.solve_thermal_tetra(JSON.stringify({...c.request,mesh})));assert.equal(r.solver.library,'HammerCraft Rust');r.temperatures.forEach((v,i)=>close(v,c.reference.temperatures[i],1e-10));close(r.volumeMeanTemperature,c.reference.volumeMeanTemperature,1e-10);assert.ok(Math.abs(r.balance.error)<1e-7,c.name);}
});
test('Rust electrical FEM reproduces the analytical uniform bar and power balance',()=>{
 const q=request(),s=solve(q),resistance=.06/(100*.02*.01),current=2/resistance;
 s.potentials.forEach((v,i)=>close(v,2*mesh.nodes[i*3]/.06,1e-8));close(s.terminals[0].inwardCurrent,-current);close(s.terminals[1].inwardCurrent,current);close(s.joulePower,4/resistance);close(s.inputPower,s.joulePower);assert.ok(Math.abs(s.currentBalance)<1e-8);s.electricField.forEach((v,i)=>close(v,i%3===0?-2/.06:0,1e-7));
});
test('current terminals, conductivity scaling, gauge shifts and zero excitation remain consistent',()=>{
 const q=request(),base=solve(q);q.boundaries[1]={tag:high,type:'current',current:1};const driven=solve(q);close(driven.terminals[1].meanVoltage,3);close(driven.terminals[0].inwardCurrent,-1);close(driven.joulePower,3);
 const offset=request();offset.boundaries.forEach(b=>b.voltage+=10);const shifted=solve(offset);shifted.potentials.forEach((v,i)=>close(v,base.potentials[i]+10));close(shifted.joulePower,base.joulePower);
 const scaled=request();scaled.conductivity*=2;close(solve(scaled).joulePower,2*base.joulePower);scaled.boundaries[1].voltage=0;const zero=solve(scaled);assert.ok(zero.potentials.every(v=>v===0));close(zero.joulePower,0);
});
test('electrical solver rejects missing references, touching terminals and malformed topology',()=>{
 const bads=[q=>q.boundaries=[{tag:high,type:'current',current:1}],q=>q.conductivity=0,q=>q.boundaries.push(q.boundaries[0]),q=>q.boundaries[1].tag=mesh.boundary.find(g=>g.center[1]<1e-10).tag,q=>q.mesh.tetrahedra.splice(0,4),q=>q.mesh.boundary[0].triangles.pop(),q=>q.mesh.nodes[0]=NaN];for(const mutate of bads){const q=structuredClone(request());mutate(q);assert.throws(()=>solve(q));}
});
test('electrical source and saved results retain history, provenance and import status',()=>{
 const h=new ProjectHistory(project());h.addElectricResult(record(h.project));const r=h.project.electricResults[0];close(electricResistance(r),3);assert.ok(isCurrent(h.project,r));const source=structuredClone(h.project.source);source.physics[1].boundaries[1].expression='3 V';h.update(source);assert.ok(!isCurrent(h.project,r));h.undo();assert.ok(isCurrent(h.project,r));const restored=validateProject(JSON.parse(JSON.stringify(h.project)),{imported:true});assert.equal(restored.electricResults[0].verified,false);
 for(let i=0;i<4;i++)h.addElectricResult({...record(h.project),id:'electric-'+i});assert.equal(h.project.electricResults.length,3);
});
test('electrical validation independently rejects altered fields, balances and terminal reports',()=>{
 for(const mutate of [r=>r.solution.potentials[0]+=1,r=>r.solution.electricField[0]+=10,r=>r.solution.currentDensity[0]+=10,r=>r.solution.jouleDensity[0]+=10,r=>r.solution.joulePower+=1,r=>r.solution.terminals[0].inwardCurrent+=1,r=>r.solution.solver.version='fake',r=>r.provenance.fingerprint='bad']){const r=structuredClone(record());mutate(r);assert.throws(()=>validateElectricRecord(r,validateSource));}
 const p=project();delete p.source.materials[0].properties;assert.throws(()=>electricRequest(validateSource(p.source),mesh),/conductivity/);const invalid=project();invalid.source.physics[1].boundaries[0].expression='1 m';assert.throws(()=>validateProject(invalid),/Expected/);
});
test('electrical cutaways and SI exports preserve nodes, cells and vector fields',()=>{
 const r=record(),before=JSON.stringify(r);for(const field of ['potential','field','current','joule']){const d=electricDisplay(r,{axis:0,fraction:.5},field);assert.ok(d.artifact.visibleCells>0&&d.artifact.visibleCells<mesh.tetrahedra.length/4);assert.equal(d.artifact.mesh.colors.length,d.artifact.mesh.vertices.length);assert.ok(d.artifact.mesh.colors.every(v=>Number.isFinite(v)&&v>=0&&v<=1));}assert.equal(JSON.stringify(r),before);assert.equal(electricCSV(r).trim().split('\n').length,mesh.nodes.length/3+1);const vtk=electricVTK(r);assert.match(vtk,/SCALARS potential_V/);assert.match(vtk,/VECTORS current_density_A_per_m2/);assert.match(vtk,/SCALARS joule_density_W_per_m3/);
});

const binary=path.resolve('engineering-rust/target/release/engineering-server');
async function service(args=[]){const child=spawn(binary,['--port','0',...args],{stdio:['ignore','pipe','pipe']});const exited=once(child,'exit');let stderr='';child.stderr.on('data',b=>stderr+=b);const ready=await Promise.race([once(child.stdout,'data').then(([b])=>String(b)),exited.then(()=>{throw Error('Rust server exited: '+stderr);})]);return {url:ready.match(/http:\/\/127\.0\.0\.1:\d+/)[0],stop:async()=>{child.kill('SIGINT');await exited;}};}
const headers={'X-HC-Compute':'1','Content-Type':'application/json'};
async function result(url,id){for(let i=0;i<800;i++){const r=await fetch(url+'/jobs/'+id,{headers}).then(r=>r.json());if(['Completed','Failed','Cancelled'].includes(r.state))return r;await new Promise(r=>setTimeout(r,10));}throw Error('Job timed out in test');}
test('native Rust HTTP jobs agree with WASM and enforce host, origin, headers and body limits',async()=>{
 const s=await service();try{const health=await fetch(s.url+'/health').then(r=>r.json());assert.equal(health.runtime.language,'Rust');assert.ok(health.capabilities.includes('electric-tetra'));
 assert.equal((await fetch(s.url+'/health',{headers:{Origin:'https://untrusted.invalid'}})).status,403);
 const hostStatus=await new Promise((resolve,reject)=>{http.get(s.url+'/health',{headers:{Host:'untrusted.invalid'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);});assert.equal(hostStatus,403);
 assert.equal((await fetch(s.url+'/jobs',{method:'POST',body:'{}'})).status,403);assert.equal((await fetch(s.url+'/jobs',{method:'POST',headers:{'X-HC-Compute':'1'},body:'{}'})).status,415);assert.equal((await fetch(s.url+'/jobs',{method:'POST',headers,body:'x'.repeat(10*1024*1024+1)})).status,413);
 const preflight=await fetch(s.url+'/jobs',{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:8765'}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'http://127.0.0.1:8765');
 for(const q of [request(),{...fixture.cases[0].request,mesh}]){const queued=await fetch(s.url+'/jobs',{method:'POST',headers,body:JSON.stringify(q)}).then(r=>r.json()),r=await result(s.url,queued.id);assert.equal(r.state,'Completed',r.error);const wasm=q.kind==='electric-tetra'?solve(q):JSON.parse(runtime.solve_thermal_tetra(JSON.stringify(q)));const key=q.kind==='electric-tetra'?'potentials':'temperatures';r.solution[key].forEach((v,i)=>close(v,wasm[key][i],1e-10));assert.equal((await fetch(s.url+'/jobs/'+queued.id,{method:'DELETE',headers})).status,200);assert.equal((await result(s.url,queued.id)).state,'Cancelled');}
 }finally{await s.stop();}
});

test('native thermal, electrical and static structural capabilities remain available without Python adapters',async()=>{const s=await service(['--python','/nonexistent-hc-python']);try{const h=await fetch(s.url+'/health').then(r=>r.json());assert.deepEqual(h.capabilities,['thermal-tetra','electric-tetra','structural-tetra']);assert.deepEqual(h.adapters,[]);const queued=await fetch(s.url+'/jobs',{method:'POST',headers,body:JSON.stringify(request())}).then(r=>r.json());assert.equal((await result(s.url,queued.id)).state,'Completed');}finally{await s.stop();}});
test('new small-signal unit aliases retain prior parameter names',()=>{close(evaluate('1 mV').value,.001);close(evaluate('3 µA').value,3e-6);const p=parameters([{id:'x',name:'mV',expression:'2 mm'},{id:'y',name:'offset',expression:'3 mV'}]);close(p.get('offset').value,.006);assert.deepEqual(p.get('offset').dim,[1,0,0,0,0]);});

test('Rust supervisor dispatches native structure and real Gmsh, modal and harmonic adapters',async()=>{
 let python=process.env.ENGINEERING_PYTHON||'python3';try{await access('tools/engineering-compute/.venv/bin/python');python=path.resolve('tools/engineering-compute/.venv/bin/python');}catch{}
 const {stdout}=await promisify(execFile)(python,['-c',"import sys,json;sys.path.insert(0,'tools/engineering-compute');from test_compute import fixture;print('HC_FIXTURE='+json.dumps(fixture()))"]);
 const s=await service(['--python',python]);try{
   const queue=async q=>{const created=await fetch(s.url+'/jobs',{method:'POST',headers,body:JSON.stringify(q)}).then(r=>r.json());assert.ok(created.id,JSON.stringify(created));const r=await result(s.url,created.id);assert.equal(r.state,'Completed',r.error);await fetch(s.url+'/jobs/'+created.id,{method:'DELETE',headers});return r;};
   const meshed=await queue(JSON.parse(stdout.split('HC_FIXTURE=').at(-1)));assert.ok(meshed.mesh.tetrahedra.length>0);assert.equal(meshed.mesh.mesher.version,'4.15.2');
   const common={mesh,youngModulus:70e9,poissonRatio:.3,density:2700,boundaries:[{tag:low,type:'fixed'},{tag:high,type:'force',values:[0,0,1]}]};
   const staticResult=await queue({...common,kind:'structural-tetra',yieldStrength:250e6,gravity:[0,0,0]});assert.ok(staticResult.solution.strainEnergy>0);
   const modal=await queue({...common,kind:'modal-tetra',modeCount:2,boundaries:common.boundaries.slice(0,1)});assert.equal(modal.solution.modes.length,2);assert.ok(modal.solution.modes[0].frequency>0);
   const harmonic=await queue({...common,kind:'harmonic-tetra',alpha:2,beta:2e-6,frequencies:[1000],boundaries:[common.boundaries[0],{...common.boundaries[1],phase:0}],responseTag:high,responseAxis:2});assert.ok(harmonic.solution.responses[0].dissipatedPower>0);
 }finally{await s.stop();}
});
