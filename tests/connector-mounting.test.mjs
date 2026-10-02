import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import init,* as engine from '../docs/wasm/acoustic_engine.js';
await init({module_or_path:fs.readFileSync(new URL('../docs/wasm/acoustic_engine_bg.wasm',import.meta.url))});
const hardware=JSON.parse(fs.readFileSync(new URL('../docs/assets/workshop/hardware.json',import.meta.url)));
const cube=(r=10)=>({vertices:[[-r,-r,-r],[r,-r,-r],[r,r,-r],[-r,r,-r],[-r,-r,r],[r,-r,r],[r,r,r],[-r,r,r]],triangles:[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]]});
const project=(model=hardware.connectors[0])=>({format:'hc-headphone-workshop',version:1,name:'Physical hardware',shell_scale:[1,1,1],mirrored:false,drivers:[],assembly:{connector:{size_mm:model.size_mm,model:model.id,position_mm:[0,0,3],rotation_deg:[0,0,0]},crossover:null,clearance_mm:.2,cable_diameter_mm:.6,cables:[]}});
const build=(p,s=cube())=>JSON.parse(engine.workshop_build_json(JSON.stringify(p),JSON.stringify(s)));
const seat=(p,s=cube(),detect=true,allowance=.1)=>JSON.parse(engine.workshop_seat_connector_json(JSON.stringify(p),JSON.stringify(s),detect,allowance));
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]);
const construction=()=>({wall_mm:1.5,resolution_mm:.5,faceplate_axis:0,faceplate_depth_mm:2,faceplate_gap_mm:0,cut_sound_paths:true,connector:null});
function assertSurface(p,b){
 const part=b.parts.find(p=>p.id==='assembly:connector'),n=p.connector_mount.normal,origin=p.connector_mount.origin_mm;
 let face=0;
 for(const v of part.mesh.vertices){const distance=dot(n,sub(v,origin));assert.ok(distance<1e-7);if(Math.abs(distance)<1e-7)face++;}
 assert.equal(face,4);assert.deepEqual(b.export_blockers,[]);
}
for(const model of hardware.connectors)test(`${model.name}: complete body stays inside and mating face sits on the shell`,()=>{
 const p=project(model),before=structuredClone(p),a=seat(p),b=build(a);assertSurface(a,b);assert.deepEqual(p,before);
 assert.deepEqual(a.assembly.connector.size_mm,model.size_mm);assert.deepEqual(a.connector_mount.normal,[0,0,1]);
 assert.ok(Math.abs(a.assembly.connector.position_mm[2]+model.size_mm[2]/2.-10)<1e-9);
 const unlocked=structuredClone(a);delete unlocked.connector_mount;assert.ok(build(unlocked).export_blockers.length,'ordinary shell contact remains invalid');
});
test('seat synchronizes the real socket opening through a hollow shell; stale cuts cannot be exported',()=>{
 const p=project();p.construction=construction();const a=seat(p),b=build(a);assertSurface(a,b);
 assert.deepEqual(a.construction.connector.size_mm,[5.1000000000000005,3.2,8.6]);
 assert.equal(b.construction.body.boundary_edges,0);assert.equal(b.construction.body.nonmanifold_edges,0);
 const bad=structuredClone(a);bad.construction.connector.center_mm[0]++;assert.throws(()=>build(bad),/opening is stale/);
 const updated=seat(bad,cube(),false);assert.deepEqual(updated.construction.connector,a.construction.connector);
});
test('tilted faces and display meshes mirror exactly; detail remains within its collision envelope',()=>{
 const theta=.4,rot=([x,y,z])=>[x*Math.cos(theta)+z*Math.sin(theta),y,-x*Math.sin(theta)+z*Math.cos(theta)];
 const s=cube();s.vertices=s.vertices.map(rot);const p=project();p.assembly.connector.position_mm=rot([0,0,3]);p.assembly.connector.rotation_deg=[0,theta*180/Math.PI,0];
 const a=seat(p,s),b=build(a,s);assertSurface(a,b);a.mirrored=true;const mirrored=build(a,s);
 const original=b.parts.find(p=>p.kind==='connector'),reflection=mirrored.parts.find(p=>p.kind==='connector');
 assert.deepEqual(reflection.display_mesh.vertices,original.display_mesh.vertices.map(([x,y,z])=>[-x,y,z]));
 assert.deepEqual(reflection.contact_mesh.vertices,original.contact_mesh.vertices.map(([x,y,z])=>[-x,y,z]));
 const base=build(seat(project())).parts.find(p=>p.kind==='connector');
 const bounds=[0,1,2].map(i=>[Math.min(...base.mesh.vertices.map(v=>v[i])),Math.max(...base.mesh.vertices.map(v=>v[i]))]);
 assert.ok(base.display_mesh.vertices.length>500);for(const v of base.display_mesh.vertices)for(let i=0;i<3;i++)assert.ok(v[i]>=bounds[i][0]-1e-9 && v[i]<=bounds[i][1]+1e-9);
});
test('invalid model sizes, stale planes, undersized faces and changed shells fail explicitly',()=>{
 const p=project();p.assembly.connector.size_mm=[4,3,2];assert.throws(()=>seat(p),/Catalog connector dimensions/);
 const a=seat(project());a.shell_scale=[1,1,1.1];assert.throws(()=>build(a),/flat shell surface/);
 const backwards=seat(project());backwards.connector_mount.normal=[0,0,-1];assert.throws(()=>build(backwards),/pose/);
 assert.throws(()=>seat(project(),cube(2)),/Could not seat/);
 assert.throws(()=>seat(project(),cube(),true,-1),/allowance/);
 const huge=seat(project());huge.assembly.connector.position_mm[0]=15;assert.throws(()=>seat(huge,cube(),false),/flat shell surface/);
});
test('auto arrange preserves the mounted connector and routes the RAF harness to its documented side',()=>{
 const p=project();p.drivers=[{id:'raf',preset:13,position_mm:[0,0,0],rotation_deg:[0,0,0],lead_mm:2,bend_mm:[-6,0,0],end_mm:[-8,0,0],inner_diameter_mm:1.6,outer_diameter_mm:2.4}];
 const a=seat(p,cube(14));const arranged=JSON.parse(engine.workshop_arrange_json(JSON.stringify(a),JSON.stringify(cube(14)),false));
 assert.deepEqual(arranged.assembly.connector,a.assembly.connector);assert.deepEqual(arranged.connector_mount,a.connector_mount);assert.deepEqual(build(arranged,cube(14)).export_blockers,[]);
 assert.equal(arranged.assembly.cables.length,1);
 const d=arranged.drivers[0];assert.deepEqual(d.rotation_deg,[0,0,0]);const end=arranged.assembly.cables[0].points_mm.at(-1);
 assert.ok(Math.abs(end[0]-d.position_mm[0])<1e-9);assert.ok(Math.abs(end[1]-d.position_mm[1]-2.03)<1e-9,'1.48 mm terminal side + 0.55 mm harness standoff');
});
test('Sonion outline uses full space including port and terminal strip, with a distinct rendered case and spout',()=>{
 const p=project();delete p.assembly;p.drivers=[{id:'sonion',preset:18,position_mm:[0,0,0],rotation_deg:[0,0,0],lead_mm:1,bend_mm:[-7,0,-.33],end_mm:[-9,0,-.33],inner_diameter_mm:1.6,outer_diameter_mm:2.4}];
 const b=build(p,cube(14)),d=b.parts.find(p=>p.kind==='driver');assert.deepEqual(b.export_blockers,[]);assert.ok(d.display_mesh);
 for(const v of d.display_mesh.vertices)for(let i=0;i<3;i++)assert.ok(Math.abs(v[i])<=[4.27,2.145,1.48][i]+1e-9);
 p.mirrored=true;assert.deepEqual(build(p,cube(14)).parts.find(p=>p.kind==='driver').display_mesh.vertices,d.display_mesh.vertices.map(([x,y,z])=>[-x,y,z]));
});
test('worker mounting, locked edits, save/reopen and failed edits are transactional',async()=>{
 const messages=[],context=vm.createContext({engine,init:async()=>{},URL,Uint8Array,JSON,self:{postMessage:m=>messages.push(m)}});
 const source=fs.readFileSync(new URL('../docs/workshop-worker.js',import.meta.url),'utf8').replace(/^import .*\n/,'').replace(/new URL\('[^']+', import.meta.url\)/,"'fixture.wasm'");vm.runInContext(source,context);
 const call=async(action,args={})=>{await context.self.onmessage({data:{id:1,action,...args}});return messages.pop();};
 const p=project();assert.equal((await call('open',{file:{format:'hc-workshop-file',version:1,project:p,shell:cube()}})).ok,true);
 const mounted=await call('mount',{project:p,allowance:.15});assert.equal(mounted.ok,true,mounted.error);
 const edited=structuredClone(mounted.project);edited.assembly.connector.position_mm[0]=1;edited.assembly.connector.position_mm[2]=0;
 const applied=await call('build',{project:edited});assert.equal(applied.ok,true,applied.error);assertSurface(applied.project,applied.built);
 const saved=(await call('save')).file;const bad=structuredClone(saved.project);bad.assembly.connector.position_mm[0]=20;assert.equal((await call('build',{project:bad})).ok,false);
 assert.deepEqual((await call('save')).file,saved);assert.equal((await call('open',{file:saved})).ok,true);
});

test('dense native shell finds its broad flat face and supports both connector seating and nozzle alignment',()=>{
 const shell=JSON.parse(engine.workshop_import_stl(fs.readFileSync(new URL('../docs/assets/workshop/solid-shell.stl',import.meta.url)),1));
 const p=project();p.assembly.connector.position_mm=[-3,-4,1];p.drivers=[{id:'sonion',preset:18,position_mm:[3,-2,0],rotation_deg:[0,0,0],lead_mm:3,bend_mm:[-3,3,-2],end_mm:[-3,11,-2.4],inner_diameter_mm:1.6,outer_diameter_mm:2.4}];
 const a=seat(p,shell);assertSurface(a,build(a,shell));assert.ok(a.connector_mount.normal[1]<-.9,'Broad native mounting face selected');
 const n=JSON.parse(engine.workshop_align_nozzle_json(JSON.stringify(a),JSON.stringify(shell),'sonion'));
 const routed=JSON.parse(engine.workshop_arrange_json(JSON.stringify(n),JSON.stringify(shell),true));
 assert.deepEqual(build(routed,shell).export_blockers,[]);assert.deepEqual(routed.connector_mount,a.connector_mount);assert.equal(routed.assembly.cables.length,1);
});

test('a socket whose rear remains buried in a thick cap cannot claim cavity access',()=>{
 const a=seat(project());a.construction={...construction(),faceplate_axis:2,faceplate_depth_mm:9};
 assert.throws(()=>seat(a,cube(),false),/does not reach the shell cavity/);
});
