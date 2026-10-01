import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import init,* as engine from '../docs/wasm/acoustic_engine.js';
await init({module_or_path:fs.readFileSync(new URL('../docs/wasm/acoustic_engine_bg.wasm',import.meta.url))});
const catalog=JSON.parse(fs.readFileSync(new URL('../docs/assets/workshop/drivers.json',import.meta.url)));
const cube=(r=25)=>({vertices:[[-r,-r,-r],[r,-r,-r],[r,r,-r],[-r,r,-r],[-r,-r,r],[r,-r,r],[r,r,r],[-r,r,r]],triangles:[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]]});
const driver=(preset=13,id='d')=>{const s=catalog[preset],point=t=>s.outlet_mm.map((x,i)=>x+t*s.outlet_axis[i]);return{id,preset,position_mm:[0,0,0],rotation_deg:[0,0,0],lead_mm:2,bend_mm:point(4),end_mm:point(8),inner_diameter_mm:1.6,outer_diameter_mm:2.4};};
const project=(ds=[driver()])=>({format:'hc-headphone-workshop',version:1,name:'Auto arrangement',shell_scale:[1,1,1],mirrored:false,drivers:ds});
const body=(size,position)=>({size_mm:size,position_mm:position,rotation_deg:[0,0,0]});
const assembly=()=>({connector:body([4,3,2],[10,-7,0]),crossover:body([6,4,1.2],[7,0,0]),clearance_mm:.2,cable_diameter_mm:.6,cables:[]});
const build=(p,s=cube())=>JSON.parse(engine.workshop_build_json(JSON.stringify(p),JSON.stringify(s)));
const arrange=(p,s=cube(),cables=false)=>JSON.parse(engine.workshop_arrange_json(JSON.stringify(p),JSON.stringify(s),cables));
for(const preset of catalog)test(`${preset.name}: auto arrange preserves identity and dimensions and passes containment`,()=>{
 const p=project([driver(preset.id)]);p.drivers[0].position_mm=[26,0,0];
 const before=structuredClone(p),a=arrange(p),b=build(a);
 assert.deepEqual(p,before);assert.deepEqual(b.export_blockers,[]);
 for(const field of ['id','preset','inner_diameter_mm','outer_diameter_mm','end_mm'])assert.deepEqual(a.drivers[0][field],p.drivers[0][field]);
 assert.notDeepEqual(a.drivers[0].position_mm,p.drivers[0].position_mm);
});
test('native shell arranges driver, connector, board and contained harnesses; deterministic and mirrored',()=>{
 const s=JSON.parse(engine.workshop_import_stl(fs.readFileSync(new URL('../docs/assets/workshop/solid-shell.stl',import.meta.url)),1));
 const p=project();Object.assign(p.drivers[0],{position_mm:[3,-2,0],end_mm:[-3,11,-2.4],bend_mm:[-3,3,-2],lead_mm:3});
 p.assembly=assembly();p.assembly.connector.position_mm=[-3,-4,1];p.assembly.crossover.position_mm=[2,-5,-2];
 const a=arrange(p,s),b=build(a,s);assert.deepEqual(b.export_blockers,[]);assert.equal(a.assembly.cables.length,2);
 assert.deepEqual(arrange(p,s),a);a.mirrored=true;const m=build(a,s);assert.deepEqual(m.export_blockers,[]);
 for(let i=0;i<b.parts.length;i++)assert.deepEqual(m.parts[i].mesh.vertices[0],b.parts[i].mesh.vertices[0].map((v,j)=>j===0?-v:v));
});
test('routing preserves placed parts and stale cable anchors block export after a move',()=>{
 const p=project();p.assembly=assembly();const a=arrange(p),r=arrange(a,cube(),true);
 assert.deepEqual(r.drivers,a.drivers);assert.deepEqual(r.assembly.connector,a.assembly.connector);
 r.assembly.connector.position_mm[0]+=.8;const bad=build(r);assert.ok(bad.export_blockers.length);assert.ok(bad.placement_checks.some(c=>c.code==='cable-anchors'&&c.status==='error'));
});
test('oversize or malformed arrangement fails without mutating the input',()=>{
 const p=project();p.assembly=assembly();p.assembly.crossover.size_mm=[30,30,30];const before=structuredClone(p);
 assert.throws(()=>arrange(p,cube(8)));assert.deepEqual(p,before);
 for(const bad of [NaN,-1,50]){p.assembly.clearance_mm=bad;assert.throws(()=>arrange(p));}
});
function drilled(){const p=project();Object.assign(p.drivers[0],{end_mm:[-9.8,-.69,0],bend_mm:[-7,-.69,0],inner_diameter_mm:2,outer_diameter_mm:5});p.construction={wall_mm:1.5,resolution_mm:.5,faceplate_axis:2,faceplate_depth_mm:2,faceplate_gap_mm:0,cut_sound_paths:true,connector:null,drilled_channels:true};return p;}
// Independent ray parity on the final exported surface, not the field evaluator.
function inside(mesh,q){let count=0;const dir=[1,.123,.057];const sub=(a,b)=>a.map((v,i)=>v-b[i]);const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];for(const tri of mesh.triangles){const [a,b,c]=tri.map(i=>mesh.vertices[i]),e1=sub(b,a),e2=sub(c,a),h=cross(dir,e2),det=dot(e1,h);if(Math.abs(det)<1e-9)continue;const inv=1/det,s=sub(q,a),u=inv*dot(s,h);if(u<0||u>1)continue;const r=cross(s,e1),v=inv*dot(dir,r);if(v<0||u+v>1)continue;if(inv*dot(e2,r)>1e-8)count++;}return count%2===1;}
test('drilled mode subtracts an air bore from integral shell material with no separate tube part',()=>{
 const p=drilled(),b=build(p,cube(10));assert.deepEqual(b.export_blockers,[]);assert.equal(b.parts.some(p=>p.kind==='path'),false);assert.equal(b.parts.filter(p=>p.kind==='channel').length,1);
 assert.equal(b.construction.body.boundary_edges,0);assert.equal(b.construction.body.nonmanifold_edges,0);
 const shell=b.parts[0].mesh;assert.equal(inside(shell,[-6,-.69,0]),false,'bore contains air');assert.equal(inside(shell,[-6,.9,0]),true,'surround is retained in the shell');
 p.construction.drilled_channels=false;const hollow=build(p,cube(10));assert.equal(inside(hollow.parts[0].mesh,[-6,.9,0]),false,'ordinary hollow shell has no duct material');
 assert.ok(b.construction.body.signed_volume_mm3>hollow.construction.body.signed_volume_mm3);
 for(const v of shell.vertices)assert.ok(v.every(x=>Math.abs(x)<=10.00001));
});
test('unresolved drilled walls and dead-end channels cannot become valid exports',()=>{
 const p=drilled();p.drivers[0].outer_diameter_mm=2.4;assert.throws(()=>build(p,cube(10)),/channel walls/);
 p.drivers[0].outer_diameter_mm=5;p.drivers[0].end_mm=[-6,-.69,0];p.drivers[0].bend_mm=[-5,-.69,0];assert.throws(()=>build(p,cube(10)),/outlet/);
});
test('worker rejects guide exports and failed arrangements retain accepted save state',async()=>{
 const messages=[],context=vm.createContext({engine,init:async()=>{},URL,Uint8Array,JSON,self:{postMessage:m=>messages.push(m)}});
 const source=fs.readFileSync(new URL('../docs/workshop-worker.js',import.meta.url),'utf8').replace(/^import .*\n/,'').replace(/new URL\('[^']+', import.meta.url\)/,"'fixture.wasm'");vm.runInContext(source,context);
 const call=async(action,args={})=>{await context.self.onmessage({data:{id:1,action,...args}});return messages.pop();};
 const p=drilled();assert.equal((await call('open',{file:{format:'hc-workshop-file',version:1,project:p,shell:cube(10)}})).ok,true);
 assert.equal((await call('export',{part:'path:d'})).ok,false);assert.equal((await call('export',{part:'shell'})).ok,true);
 const bad=project();bad.assembly=assembly();bad.assembly.crossover.size_mm=[30,30,30];assert.equal((await call('arrange',{project:bad})).ok,false);
 assert.deepEqual((await call('save')).file.project,p);
});

test('two-driver layout packs separate sound paths and three harness reservations',()=>{
 const ds=[driver(13,'left'),driver(13,'right')];ds.forEach((d,i)=>{const y=i===0?-4:4;d.position_mm[1]=y;d.end_mm[1]=y;d.bend_mm[1]=y;});
 const p=project(ds);p.assembly=assembly();p.assembly.crossover.size_mm=[10,4,1.2];
 const a=arrange(p,cube(15));assert.deepEqual(a.drivers.map(d=>d.id),['left','right']);assert.equal(a.assembly.cables.length,3);assert.deepEqual(build(a,cube(15)).export_blockers,[]);
});
test('native drilled outlets extend to stock, auto arrange resolves the bend, and save/reopen retains all settings',()=>{
 const shell=JSON.parse(engine.workshop_import_stl(fs.readFileSync(new URL('../docs/assets/workshop/solid-shell.stl',import.meta.url)),1));
 const p=project();Object.assign(p.drivers[0],{position_mm:[3,-2,0],end_mm:[-3,11,-2.4],bend_mm:[-3,3,-2],lead_mm:3,outer_diameter_mm:3.4});
 p.construction={wall_mm:1.5,resolution_mm:.3,faceplate_axis:2,faceplate_depth_mm:2.5,faceplate_gap_mm:0,cut_sound_paths:true,drilled_channels:true,connector:null};
 const extended=JSON.parse(engine.workshop_outlets_json(JSON.stringify(p),JSON.stringify(shell)));
 assert.ok(extended.drivers[0].end_mm[1]>11);const a=arrange(extended,shell),b=build(a,shell);assert.deepEqual(b.export_blockers,[]);
 assert.deepEqual(build(JSON.parse(JSON.stringify(a)),shell),b);
});
