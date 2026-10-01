import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import init, * as engine from '../docs/wasm/acoustic_engine.js';
await init({module_or_path:fs.readFileSync(new URL('../docs/wasm/acoustic_engine_bg.wasm',import.meta.url))});
const native=JSON.parse(engine.workshop_import_stl(fs.readFileSync(new URL('../docs/assets/workshop/solid-shell.stl',import.meta.url)),1));
const cube={vertices:[[-10,-10,-10],[10,-10,-10],[10,10,-10],[-10,10,-10],[-10,-10,10],[10,-10,10],[10,10,10],[-10,10,10]],triangles:[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]]};
const project=()=>({format:'hc-headphone-workshop',version:1,name:'Faceplate regression',shell_scale:[1,1,1],mirrored:false,drivers:[],construction:{wall_mm:1.5,resolution_mm:.5,faceplate_axis:2,faceplate_mode:'auto',faceplate_depth_mm:2.5,faceplate_gap_mm:.1,cut_sound_paths:false,connector:null}});
const build=(p,s=native)=>JSON.parse(engine.workshop_build_json(JSON.stringify(p),JSON.stringify(s)));
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const normal=v=>v.map(x=>x/Math.hypot(...v));
// Independent measurement of the broad planar face in the source STL.
const expected=normal([-.18164095,-.95497833,-.23456972]);
function checkCut(b,gap=.1){
 const c=b.construction,n=c.faceplate_normal,plane=c.faceplate_plane_mm;
 for(const label of ['body','faceplate'])for(const field of ['boundary_edges','nonmanifold_edges','inconsistent_edges','degenerate_triangles'])assert.equal(c[label][field],0,`${label}: ${field}`);
 assert.ok(c.body.signed_volume_mm3>0 && c.faceplate.signed_volume_mm3>0);
 const body=b.parts.find(p=>p.id==='shell').mesh,cap=b.parts.find(p=>p.id==='faceplate').mesh;
 const maxBody=Math.max(...body.vertices.map(v=>dot(n,v))),minCap=Math.min(...cap.vertices.map(v=>dot(n,v)));
 assert.ok(Math.abs(maxBody-plane)<2e-5,`body seam ${maxBody} vs ${plane}`);
 assert.ok(Math.abs(minCap-plane-gap)<2e-5,`cap seam ${minCap} vs ${plane+gap}`);
 for(const part of [body,cap]) {
  const exported=JSON.parse(engine.workshop_import_stl(engine.workshop_export_stl(JSON.stringify(part)),1));
  assert.equal(exported.triangles.length,part.triangles.length,'STL retains every triangle');
 }
}
test('native faceplate follows broad tilted face, not positive Z or the small nozzle end',()=>{
 const p=project(),b=build(p);checkCut(b);
 assert.ok(dot(b.construction.faceplate_normal,expected)>.999999);
 assert.ok(b.construction.detected_face_area_mm2>220 && b.construction.detected_face_area_mm2<230);
 const legacy=structuredClone(p);delete legacy.construction.faceplate_mode;
 const old=build(legacy);assert.deepEqual(old.construction.faceplate_normal,[0,0,1]);
 assert.ok(b.construction.faceplate.size_mm[2]>20,'cap covers the full broad face, not a shallow positive-Z slice');
 assert.deepEqual(build(JSON.parse(JSON.stringify(p))),b);
});
test('detection is stable under arbitrary rotation, translation, triangle reordering and anisotropic scaling',()=>{
 const az=.74,ax=-.41;
 const rotate=([x,y,z])=>{const a=x*Math.cos(az)-y*Math.sin(az),b=x*Math.sin(az)+y*Math.cos(az);return[a,b*Math.cos(ax)-z*Math.sin(ax),b*Math.sin(ax)+z*Math.cos(ax)];};
 const scale=[1.15,.95,1.05],translation=[.8,-1.2,.5],p=project();p.shell_scale=scale;
 const stock={vertices:native.vertices.map(v=>rotate(v).map((x,i)=>x+translation[i])),triangles:native.triangles.toReversed()};
 const b=build(p,stock);checkCut(b);
 const n=normal(rotate(expected).map((v,i)=>v/scale[i]));assert.ok(dot(n,b.construction.faceplate_normal)>.99999);
 p.mirrored=true;const mirrored=build(p,stock);checkCut(mirrored);
 assert.deepEqual(mirrored.construction.faceplate_normal,b.construction.faceplate_normal.map((v,i)=>i===0?-v:v));
 for(let i=0;i<b.parts.length;i++)assert.deepEqual(mirrored.parts[i].mesh.vertices,b.parts[i].mesh.vertices.map(([x,y,z])=>[-x,y,z]));
});
test('all six manual sides use an inward depth and matching cap seam',()=>{
 for(let axis=0;axis<3;axis++)for(const negative of [false,true]){
  const p=project();Object.assign(p.construction,{faceplate_mode:'axis',faceplate_axis:axis,faceplate_negative:negative});
  const b=build(p,cube);checkCut(b);assert.equal(b.construction.faceplate_plane_mm,7.5);
  assert.equal(b.construction.faceplate_normal[axis],negative?-1:1);
 }
});
test('custom tilted plane rejects packages in the cap even when stock wall clearance passes',()=>{
 const p=project();Object.assign(p.construction,{faceplate_mode:'normal',faceplate_normal:[1,1,1],faceplate_depth_mm:4});
 p.assembly={connector:null,crossover:{size_mm:[.8,.8,.8],position_mm:[7.8,7.8,7.8],rotation_deg:[0,0,0]},clearance_mm:.2,cable_diameter_mm:.6,cables:[]};
 const b=build(p,cube);checkCut(b);assert.ok(b.placement_checks.some(c=>c.code==='assembly-shell'&&c.status==='error'));
 delete p.construction;assert.equal(build(p,cube).placement_checks.find(c=>c.code==='assembly-shell').status,'pass');
});
test('ambiguous faces, unknown mode and invalid custom normals fail explicitly',()=>{
 assert.throws(()=>build(project(),cube),/unique broad, flat faceplate/);
 for(const patch of [{faceplate_mode:'wrong'},{faceplate_mode:'normal',faceplate_normal:[0,0,0]},{faceplate_mode:'normal',faceplate_normal:[1e308,1e308,1e308]},{faceplate_mode:'normal'}]){
  const p=project();Object.assign(p.construction,patch);assert.throws(()=>build(p,cube));
 }
});
test('auto arrange and cable routing keep physical parts behind a tilted cap',()=>{
 const stock=cube;
 const p=project();Object.assign(p.construction,{faceplate_mode:'normal',faceplate_normal:[-1,-2,1],faceplate_depth_mm:6});
 p.drivers=[{id:'d',preset:13,position_mm:[0,0,0],rotation_deg:[0,0,0],lead_mm:2,bend_mm:[-6,-.69,0],end_mm:[-8,-.69,0],inner_diameter_mm:2,outer_diameter_mm:3}];
 p.assembly={connector:{size_mm:[3,2,1.5],position_mm:[-6,-6,5],rotation_deg:[0,0,0]},crossover:{size_mm:[5,3,1.2],position_mm:[-5,-5,5],rotation_deg:[0,0,0]},clearance_mm:.2,cable_diameter_mm:.6,cables:[]};
 const a=JSON.parse(engine.workshop_arrange_json(JSON.stringify(p),JSON.stringify(stock),false));
 const b=build(a,stock);assert.deepEqual(b.export_blockers,[]);assert.equal(a.assembly.cables.length,2);
 const n=b.construction.faceplate_normal,cut=b.construction.faceplate_plane_mm;
 for(const part of b.parts.filter(p=>['driver','connector','crossover','cable'].includes(p.kind)))for(const v of part.mesh.vertices)assert.ok(dot(n,v)<cut-1e-5,part.id);
 const rerouted=JSON.parse(engine.workshop_arrange_json(JSON.stringify(a),JSON.stringify(stock),true));assert.deepEqual(build(rerouted,stock).export_blockers,[]);
});
test('failed auto detection retains the accepted worker project and cap; successful mode survives save/reopen',async()=>{
 const messages=[],context=vm.createContext({engine,init:async()=>{},URL,Uint8Array,JSON,self:{postMessage:m=>messages.push(m)}});
 const source=fs.readFileSync(new URL('../docs/workshop-worker.js',import.meta.url),'utf8').replace(/^import .*\n/,'').replace(/new URL\('[^']+', import.meta.url\)/,"'fixture.wasm'");vm.runInContext(source,context);
 const call=async(action,args={})=>{await context.self.onmessage({data:{id:1,action,...args}});return messages.pop();};
 const p=project(),file={format:'hc-workshop-file',version:1,sourceName:'Native',project:p,shell:native};
 const first=await call('open',{file});assert.equal(first.ok,true);
 assert.equal((await call('open',{file:{...file,shell:cube}})).ok,false);
 const saved=await call('save');assert.deepEqual(JSON.parse(JSON.stringify(saved.file)),file);
 assert.deepEqual((await call('open',{file:saved.file})).built,first.built);
});

test('native drilled assembly can be rearranged beneath the corrected detected cap',()=>{
 const p=JSON.parse(fs.readFileSync(new URL('../docs/reports/2026-10-01-auto-arrange/example-parameters.json',import.meta.url))).project;
 p.construction.faceplate_mode='auto';
 const previous=build(p);assert.ok(previous.export_blockers.some(s=>s.includes('crossover')),'old arrangement intersects the corrected cap');
 const a=JSON.parse(engine.workshop_arrange_json(JSON.stringify(p),JSON.stringify(native),false));
 const b=build(a);assert.deepEqual(b.export_blockers,[]);assert.equal(a.assembly.cables.length,2);
 assert.equal(b.parts.filter(p=>p.kind==='channel').length,1);
 assert.equal(b.placement_checks.find(c=>c.code==='integral-channel-body').status,'pass');
 checkCut(b,0);
});
