import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import init, * as engine from '../docs/wasm/acoustic_engine.js';
await init({module_or_path:fs.readFileSync(new URL('../docs/wasm/acoustic_engine_bg.wasm',import.meta.url))});
const cat=JSON.parse(fs.readFileSync(new URL('../docs/assets/workshop/drivers.json',import.meta.url)));
const hardware=JSON.parse(fs.readFileSync(new URL('../docs/assets/workshop/hardware.json',import.meta.url)));
const interfaces=hardware.driver_interfaces;
const cube={vertices:[[-20,-20,-20],[20,-20,-20],[20,20,-20],[-20,20,-20],[-20,-20,20],[20,-20,20],[20,20,20],[-20,20,20]],triangles:[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]]};
function rotate(p,r){p=[...p];for(let i=0;i<3;i++){const a=(i+1)%3,b=(i+2)%3,c=Math.cos(r[i]*Math.PI/180),s=Math.sin(r[i]*Math.PI/180),x=p[a],y=p[b];p[a]=c*x-s*y;p[b]=s*x+c*y;}return p;}
function project(s,rot=[0,0,0]){const pos=[1,2,3],point=t=>rotate(s.outlet_mm.map((v,i)=>v+s.outlet_axis[i]*t),rot).map((v,i)=>v+pos[i]);return {format:'hc-headphone-workshop',version:1,name:'All-driver physical review',shell_scale:[1,1,1],mirrored:false,drivers:[{id:'d',preset:s.id,position_mm:pos,rotation_deg:rot,lead_mm:2,bend_mm:point(4),end_mm:point(7),inner_diameter_mm:1.6,outer_diameter_mm:2.4}]};}
const build=p=>JSON.parse(engine.workshop_build_json(JSON.stringify(p),JSON.stringify(cube)));
test('every geometric preset has one physical-data review; exact pad coordinates are not fabricated',()=>{
 assert.deepEqual(interfaces.map(i=>i.preset_id).sort((a,b)=>a-b),cat.map(s=>s.id));
 for(const i of interfaces){for(const key of ['body_basis','outlet_basis','wiring','mount','missing','status','confidence','source_url'])assert.ok(i[key]?.length,`${i.preset_id}: ${key}`);assert.equal(Math.hypot(...i.terminal_axis),1);for(const t of i.terminals)assert.equal(t.position_mm,undefined,'Labels are documented; pad coordinates await controlled transfer');}
 for(const id of [0,1,5,12,16,17])assert.equal(cat[id].supplier_dimensioned,false);
 for(const id of [3,6,10,11,13])assert.equal(cat[id].supplier_interface_dimensioned,false,'Partial or surrogate interfaces cannot claim complete supplier dimensions');
});
for(const s of cat)test(`${s.name}: physical evidence survives build/reopen, rigid pose and reflection`,()=>{
 const i=interfaces.find(i=>i.preset_id===s.id),p=project(s),base=build(p),b=base.parts.find(p=>p.id==='d');
 assert.deepEqual(base.export_blockers,[]);
 for(const code of ['driver-connections','driver-mount'])assert.equal(base.placement_checks.find(c=>c.code===code).status,'unverified');
 assert.match(base.placement_checks.find(c=>c.code==='driver-connections').message,/Missing:/);
 assert.deepEqual(build(JSON.parse(JSON.stringify(p))),base);
 const rot=[17,29,41],tilted=build(project(s,rot)).parts.find(p=>p.id==='d');
 for(const field of ['mesh','display_mesh','contact_mesh']){
  if(!b[field])continue;
  b[field].vertices.forEach((v,n)=>{const local=v.map((x,a)=>x-p.drivers[0].position_mm[a]);for(let a=0;a<3;a++)assert.ok(Math.abs(local[a])<=s.size_mm[a]/2+1e-8,`${field} exceeds reserved envelope`);const expected=rotate(local,rot).map((x,a)=>x+p.drivers[0].position_mm[a]);expected.forEach((x,a)=>assert.ok(Math.abs(x-tilted[field].vertices[n][a])<1e-8));});
 }
 p.mirrored=true;const m=build(p).parts.find(p=>p.id==='d');for(const field of ['mesh','display_mesh','contact_mesh'])if(b[field]){assert.deepEqual(m[field].vertices,b[field].vertices.map(([x,y,z])=>[-x,y,z]));assert.deepEqual(m[field].triangles,b[field].triangles.map(([a,b,c])=>[a,c,b]));}
 assert.equal(!!b.contact_mesh,i.contact_pieces.length>0);
});
test('model-specific vent requirements and MEMS electrical roles match the source drawings',()=>{
 assert.equal(cat[4].rear_vent_required,true,'Knowles TWFK-30017-000 is vented');assert.equal(cat[7].rear_vent_required,false,'Knowles CI-22955-000 is unvented');
 assert.equal(interfaces[10].front_aperture_count,15);assert.equal(interfaces[10].rear_vent_count,2);
 assert.equal(interfaces[11].front_aperture_count,11);assert.equal(interfaces[11].rear_vent_count,6);
 assert.ok(Math.abs(cat[11].outlet_diameter_mm-Math.sqrt(11)*.55)<1e-6);
 assert.equal(interfaces[10].contact_pieces.filter(p=>p.position_mm[2]>0).length,15);
 assert.equal(interfaces[11].contact_pieces.filter(p=>p.position_mm[2]>0).length,11);
 assert.equal(interfaces[10].terminals[0].label,'T / pin 2');assert.equal(interfaces[11].terminals[0].label,'T / pin 3');
 assert.match(interfaces[3].wiring,/decreases outlet pressure/);
 for(const id of [6,10,11]){const checks=build(project(cat[id])).placement_checks;assert.equal(checks.find(c=>c.code==='drive-electronics').status,'unverified');assert.deepEqual(interfaces[id].terminal_axis,[0,0,-1]);}
});
test('all driver harnesses end at their documented or explicitly provisional group approach',()=>{
 for(const s of cat){const p=project(s);p.assembly={connector:{size_mm:[3,2,4],position_mm:[-8,-8,0],rotation_deg:[0,0,0]},crossover:null,clearance_mm:.2,cable_diameter_mm:.6,cables:[]};
  const a=JSON.parse(engine.workshop_arrange_json(JSON.stringify(p),JSON.stringify(cube),false));const d=a.drivers[0],i=interfaces.find(i=>i.preset_id===s.id),stand=.55;
  const expected=rotate(i.terminal_group_mm.map((v,j)=>v+i.terminal_axis[j]*stand),d.rotation_deg).map((v,j)=>v+d.position_mm[j]);const actual=a.assembly.cables.find(c=>c.to==='d'||c.to_id==='d')||a.assembly.cables.at(-1);
  actual.points_mm.at(-1).forEach((v,j)=>assert.ok(Math.abs(v-expected[j])<1e-8,`${s.name}: anchor axis ${j}`));assert.deepEqual(build(a).export_blockers,[]);
 }
});
