import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import init,* as engine from '../docs/wasm/acoustic_engine.js';
await init({module_or_path:fs.readFileSync(new URL('../docs/wasm/acoustic_engine_bg.wasm',import.meta.url))});
const catalog=JSON.parse(fs.readFileSync(new URL('../docs/assets/workshop/drivers.json',import.meta.url)));
const cube=(r=25)=>({vertices:[[-r,-r,-r],[r,-r,-r],[r,r,-r],[-r,r,-r],[-r,-r,r],[r,-r,r],[r,r,r],[-r,r,r]],triangles:[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]]});
const driver=(preset=13)=>{const s=catalog[preset],point=t=>s.outlet_mm.map((x,i)=>x+t*s.outlet_axis[i]);return{id:'d',preset,position_mm:[0,0,0],rotation_deg:[0,0,0],lead_mm:2,bend_mm:point(4),end_mm:point(8),inner_diameter_mm:1.6,outer_diameter_mm:2.4};};
const project=(d=driver())=>({format:'hc-headphone-workshop',version:1,name:'Containment',shell_scale:[1,1,1],mirrored:false,drivers:[d]});
const build=(p,s=cube())=>JSON.parse(engine.workshop_build_json(JSON.stringify(p),JSON.stringify(s)));
const check=(b,code)=>b.placement_checks.find(c=>c.code===code);

for(const s of catalog)test(`${s.name}: complete package and tube containment, with outside placement blocked`,()=>{
 const p=project(driver(s.id)),clear=build(p);
 assert.equal(check(clear,'package-shell').status,'pass');assert.equal(check(clear,'tube-shell').status,'pass');assert.deepEqual(clear.export_blockers,[]);
 p.drivers[0].position_mm=[30,0,0];const before=structuredClone(p),bad=build(p);
 assert.equal(check(bad,'package-shell').status,'error');assert.ok(bad.export_blockers.length);assert.ok(bad.paths[0].placement_errors.length);assert.deepEqual(p,before);
});

test('tube outside wall is checked even with its entire centreline inside',()=>{
 const d=driver();d.position_mm=[0,8.3,0];d.bend_mm=[-5,8.3,0];d.end_mm=[-7,8.3,0];d.outer_diameter_mm=4;
 const b=build(project(d),cube(10));assert.equal(check(b,'package-shell').status,'pass');assert.equal(check(b,'tube-shell').status,'error');
});

test('curved tube excursion is detected between two contained endpoints',()=>{
 const d=driver();d.bend_mm=[0,40,0];d.end_mm=[3,0,0];
 assert.equal(check(build(project(d),cube(10)),'tube-shell').status,'error');
});

// Closed concave stock: a narrow notch through the upper half. Package corners
// and centre are inside, but its top faces bridge the notch. This triangulation
// uses rectangles on each side and beneath the notch, sharing boundary vertices.
function notchedStock(){
 const xy=[[-10,-10],[10,-10],[10,10],[.3,10],[.3,.5],[-.3,.5],[-.3,10],[-10,10]];
 const cap=[[0,1,4],[1,2,4],[2,3,4],[0,4,5],[0,5,7],[5,6,7]];
 const vertices=[...xy.map(([x,y])=>[x,y,-10]),...xy.map(([x,y])=>[x,y,10])];
 const triangles=[...cap.map(([a,b,c])=>[a,c,b]),...cap.map(t=>t.map(i=>i+8))];
 for(let i=0;i<8;i++){const j=(i+1)%8;triangles.push([i,j,j+8],[i,j+8,i+8]);}
 return{vertices,triangles};
}
test('full faces cannot bridge a shell concavity even when every package vertex is inside',()=>{
 const b=build(project(),notchedStock());
 const packageMesh=b.parts.find(p=>p.kind==='driver').mesh;
 assert.ok(packageMesh.vertices.every(([x,y])=>Math.abs(x)>.3||y<.5));
 assert.equal(check(b,'package-stock-bounds').status,'pass');
 assert.equal(check(b,'package-shell').status,'error');assert.match(check(b,'package-shell').message,/face crosses/);
});

test('wall-offset and faceplate containment include full package faces',()=>{
 const p=project();p.drivers[0].position_mm=[0,0,6];p.construction={wall_mm:1.5,resolution_mm:.5,faceplate_axis:2,faceplate_depth_mm:4,faceplate_gap_mm:0,cut_sound_paths:false,connector:null};
 const b=build(p,cube(10));assert.equal(check(b,'package-cavity').status,'error');assert.ok(b.export_blockers.length);
 p.drivers[0].position_mm=[0,0,0];const clear=build(p,cube(10));assert.equal(check(clear,'package-cavity').status,'pass');
});

test('scaled and mirrored shells preserve containment decisions',()=>{
 const p=project();p.drivers[0].end_mm=[-20,0,0];
 assert.equal(check(build(p,cube(10)),'tube-shell').status,'error');
 p.shell_scale=[3,2,2];const good=build(p,cube(10));assert.equal(check(good,'tube-shell').status,'pass');
 p.mirrored=true;assert.deepEqual(build(p,cube(10)).export_blockers,good.export_blockers);
});

test('open or disconnected shell cannot falsely establish containment',()=>{
 const open=cube();open.triangles.pop();
 const separate=cube();const small=cube(2),offset=separate.vertices.length;
 separate.vertices.push(...small.vertices.map(([x,y,z])=>[x+40,y,z]));separate.triangles.push(...small.triangles.map(t=>t.map(i=>i+offset)));
 for(const stock of [open,separate]){const b=build(project(),stock);assert.equal(check(b,'tube-shell').status,'unverified');assert.ok(b.export_blockers.length);assert.ok(b.paths[0].placement_errors.length);}
});

test('worker blocks all STL exports on protrusion, allows project save and resumes after repair',async()=>{
 const messages=[],context=vm.createContext({engine,init:async()=>{},URL,Uint8Array,JSON,self:{postMessage:m=>messages.push(m)}});
 const source=fs.readFileSync(new URL('../docs/workshop-worker.js',import.meta.url),'utf8').replace(/^import .*\n/,'').replace(/new URL\('[^']+', import.meta.url\)/,"'fixture.wasm'");
 vm.runInContext(source,context);let id=0;const call=async(action,args={})=>{await context.self.onmessage({data:{id:++id,action,...args}});return messages.pop();};
 const p=project();p.drivers[0].end_mm=[-40,0,0];
 assert.equal((await call('open',{file:{format:'hc-workshop-file',version:1,project:p,shell:cube()}})).ok,true);
 for(const part of ['shell','d','path:d']){const r=await call('export',{part});assert.equal(r.ok,false);assert.match(r.error,/STL export blocked/);}
 assert.equal((await call('save')).ok,true);
 assert.equal((await call('build',{project:project()})).ok,true);
 assert.equal((await call('export',{part:'path:d'})).ok,true);
});

test('containment uses the float32 surface that WebGL and binary STL actually store',()=>{
 const p=project();p.drivers[0].position_mm=[4997.4249,0,0];
 const b=build(p,cube(5000));const part=b.parts.find(p=>p.kind==='driver');
 assert.ok(Math.max(...part.mesh.vertices.map(v=>v[0]))<5000,'double precision position is nominally inside');
 assert.equal(Math.max(...part.mesh.vertices.map(v=>Math.fround(v[0]))),5000,'stored position touches shell');
 assert.equal(check(b,'package-shell').status,'error');
});

test('starter is contained with construction on or off; the former protruding example is blocked',()=>{
 const stock=JSON.parse(engine.workshop_import_stl(fs.readFileSync(new URL('../docs/assets/workshop/solid-shell.stl',import.meta.url)),1));
 const p=project({...driver(),position_mm:[3,-2,0],bend_mm:[-3,3,-2],end_mm:[-3,11,-2.4],lead_mm:3});
 assert.deepEqual(build(p,stock).export_blockers,[]);
 p.construction={wall_mm:1.5,resolution_mm:.5,faceplate_axis:2,faceplate_depth_mm:2.5,faceplate_gap_mm:0,cut_sound_paths:true,connector:null};
 assert.deepEqual(build(p,stock).export_blockers,[]);
 const old=JSON.parse(fs.readFileSync(new URL('../docs/reports/2026-10-01-shell-construction/example.hcworkshop.json',import.meta.url)));
 assert.equal(check(build(old.project,old.shell),'tube-shell').status,'error');
});
