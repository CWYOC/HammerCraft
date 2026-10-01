import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import init, * as engine from '../docs/wasm/acoustic_engine.js';
await init({ module_or_path: fs.readFileSync(new URL('../docs/wasm/acoustic_engine_bg.wasm', import.meta.url)) });
const read = path => fs.readFileSync(new URL(path,import.meta.url));
const fixtures = JSON.parse(read('./fixtures/workshop-native-tubes.json'));
const catalog = JSON.parse(read('../docs/assets/workshop/drivers.json'));
const source = read('../docs/assets/workshop/solid-shell.stl');
const project = () => ({format:'hc-headphone-workshop',version:1,name:'Test',shell_scale:[1,1,1],mirrored:false,drivers:[]});
const driver = (preset,id='driver-1') => ({id,preset,position_mm:[0,0,0],rotation_deg:[0,0,0],end_mm:[0,-10,0],bend_mm:[0,-6,0],lead_mm:2,inner_diameter_mm:1.6,outer_diameter_mm:2.4});
const build = (p,shell) => JSON.parse(engine.workshop_build_json(JSON.stringify(p),JSON.stringify(shell)));
function topology(mesh) {
    const edges = new Map();let volume=0;
    for(const [a,b,c] of mesh.triangles){const [p,q,r]=[a,b,c].map(i=>mesh.vertices[i]);assert.ok([...p,...q,...r].every(Number.isFinite));
        volume+=(p[0]*(q[1]*r[2]-q[2]*r[1])+p[1]*(q[2]*r[0]-q[0]*r[2])+p[2]*(q[0]*r[1]-q[1]*r[0]))/6;
        for(const [x,y] of [[a,b],[b,c],[c,a]]){const key=[Math.min(x,y),Math.max(x,y)].join(':');const e=edges.get(key)||[0,0];e[0]++;e[1]+=x<y?1:-1;edges.set(key,e);}}
    for(const e of edges.values())assert.deepEqual(e,[2,0]);assert.ok(volume>0);return volume;
}
for(const [index,fixture] of fixtures.entries())test(`Rust swept tube matches native C++ fixture ${index+1}`,()=>{
    const mesh=JSON.parse(engine.workshop_tube_json(JSON.stringify(fixture)));
    assert.deepEqual(mesh.triangles,fixture.mesh.triangles);
    assert.equal(mesh.vertices.length,fixture.mesh.vertices.length);
    let maxError=0;for(let i=0;i<mesh.vertices.length;i++)for(let axis=0;axis<3;axis++)maxError=Math.max(maxError,Math.abs(mesh.vertices[i][axis]-fixture.mesh.vertices[i][axis]));
    assert.ok(maxError<1e-10,`max position difference ${maxError} mm`);topology(mesh);
});
test('native starter imports, centres, resizes and mirrors without altering winding or volume',()=>{
    const shell=JSON.parse(engine.workshop_import_stl(source,1));assert.equal(shell.triangles.length,24474);
    for(let a=0;a<3;a++){const values=shell.vertices.map(v=>v[a]);assert.ok(Math.abs(Math.min(...values)+Math.max(...values))<1e-9);}
    const p=project(),original=build(p,shell);p.shell_scale=[1.2,.8,1.1];p.mirrored=true;const scaled=build(p,shell);
    assert.ok(Math.abs(scaled.shell.signed_volume_mm3/original.shell.signed_volume_mm3-1.2*.8*1.1)<1e-8);
    assert.deepEqual(scaled.parts[0].mesh.triangles[0],[shell.triangles[0][0],shell.triangles[0][2],shell.triangles[0][1]]);
    const unit=JSON.parse(engine.workshop_import_stl(source,.001));const small=build(project(),unit);assert.ok(Math.abs(small.shell.size_mm[0]*1000-original.shell.size_mm[0])<1e-8);
});
for(const preset of catalog)test(`${preset.name}: placement, route attachment, mirror and binary STL round trip`,()=>{
    const shell=JSON.parse(engine.workshop_import_stl(source,1)),p=project();p.drivers=[driver(preset.id)];const result=build(p,shell);
    assert.equal(result.parts.length,3);const tube=result.parts.find(p=>p.kind==='path');const body=result.parts.find(p=>p.kind==='driver');
    topology(tube.mesh);topology(body.mesh);
    for(let a=0;a<3;a++)assert.ok(Math.abs(result.paths[0].control_points[0][a]-preset.outlet_mm[a])<1e-10);
    assert.ok(result.paths[0].length_mm>0 && result.paths[0].bore_volume_mm3>0);
    const bodyVolume=topology(body.mesh);const tubeVolume=topology(tube.mesh);
    p.drivers[0].position_mm=[1,2,3];p.drivers[0].rotation_deg=[0,0,90];p.mirrored=true;const moved=build(p,shell);
    const expected=[-(1-preset.outlet_mm[1]),2+preset.outlet_mm[0],3+preset.outlet_mm[2]];
    for(let i=0;i<3;i++)assert.ok(Math.abs(moved.paths[0].control_points[0][i]-expected[i])<1e-10);
    assert.ok(Math.abs(topology(moved.parts[1].mesh)-bodyVolume)<1e-8);
    const bytes=engine.workshop_export_stl(JSON.stringify(tube.mesh));const restored=JSON.parse(engine.workshop_import_stl(bytes,1));
    assert.equal(bytes.length,84+tube.mesh.triangles.length*50);assert.equal(restored.triangles.length,tube.mesh.triangles.length);assert.ok(Math.abs(topology(restored)-tubeVolume)<1e-3);
    const restoredProject=JSON.parse(JSON.stringify({project:p,shell}));assert.deepEqual(build(restoredProject.project,restoredProject.shell),moved);
});
test('twelve-driver capacity, duplicate IDs, bad project versions, bad meshes and invalid paths fail explicitly',()=>{
    const shell=JSON.parse(engine.workshop_import_stl(source,1)),p=project();p.drivers=Array.from({length:12},(_,i)=>driver(i,`d${i}`));assert.equal(build(p,shell).paths.length,12);
    p.drivers.push(driver(13,'d12'));assert.throws(()=>build(p,shell),/12 drivers/);p.drivers.pop();p.drivers[1].id='d0';assert.throws(()=>build(p,shell),/unique/);
    p.drivers=[];p.version=99;assert.throws(()=>build(p,shell),/version/);p.version=1;p.shell_scale=[0,1,1];assert.throws(()=>build(p,shell),/scales/);p.shell_scale=[1,1,1];
    for(const patch of [{preset:100},{lead_mm:0},{inner_diameter_mm:3,outer_diameter_mm:2},{position_mm:[null,0,0]}]){p.drivers=[{...driver(13),...patch}];assert.throws(()=>build(p,shell));}
    p.drivers=[];assert.throws(()=>build(p,{vertices:[[0,0,0]],triangles:[[0,1,2]]}),/indices/);
    const path={...fixtures[0],control_points:Array(4).fill([0,0,0])};assert.throws(()=>engine.workshop_tube_json(JSON.stringify(path)),/zero length/);
    path.control_points=fixtures[0].control_points;path.path_segments=1000000;assert.throws(()=>engine.workshop_tube_json(JSON.stringify(path)),/tessellation/);
});
test('STL parser rejects truncated data, NaN coordinates, invalid units and invalid ASCII facets',()=>{
    assert.throws(()=>engine.workshop_import_stl(source.subarray(0,source.length-1),1),/STL/);
    const corrupt=Buffer.from(source);corrupt.writeFloatLE(NaN,96);assert.throws(()=>engine.workshop_import_stl(corrupt,1),/non-finite/);
    assert.throws(()=>engine.workshop_import_stl(source,0),/units/);
    const text='solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t';
    const parsed=JSON.parse(engine.workshop_import_stl(Buffer.from(text),1));assert.equal(parsed.triangles.length,1);
    assert.throws(()=>engine.workshop_import_stl(Buffer.from(text.replace('vertex 0 1 0\n','')),1),/structure/);
    assert.throws(()=>engine.workshop_import_stl(Buffer.from(text.replace('endsolid t','')),1),/Incomplete/);
});

test('worker rejects invalid edits/imports transactionally, saves current geometry and exports the chosen part',async()=>{
    const vm=await import('node:vm');const messages=[];
    const context=vm.createContext({engine,init:async()=>{},URL,Uint8Array,JSON,self:{postMessage:result=>messages.push(result)}});
    const sourceCode=read('../docs/workshop-worker.js').toString().replace(/^import .*\n/,'').replace("new URL('./wasm/acoustic_engine_bg.wasm?v=0.22.0', import.meta.url)","'fixture.wasm'");
    vm.runInContext(sourceCode,context);let id=0;
    const call=async(action,args={})=>{await context.self.onmessage({data:{id:++id,action,...args}});return messages.pop();};
    const p=project();p.shell_scale=[4,4,4];p.drivers=[{...driver(13),bend_mm:[-7,5,0],end_mm:[-3,11,-2.4],lead_mm:3}];const first=await call('import',{bytes:source,unit:1,name:'fixture',project:p});assert.equal(first.ok,true);
    const invalid=structuredClone(p);invalid.drivers[0].inner_diameter_mm=9;assert.equal((await call('build',{project:invalid})).ok,false);
    assert.equal((await call('import',{bytes:new Uint8Array([1,2,3]),unit:1,project:p})).ok,false);
    assert.equal((await call('open',{file:{format:'native-fmp',version:1}})).ok,false);
    const saved=await call('save');assert.equal(saved.ok,true);assert.deepEqual(saved.file.project,p);assert.equal(saved.file.sourceName,'fixture');
    const exported=await call('export',{part:'path:driver-1'});assert.equal(exported.ok,true);assert.ok(exported.bytes.length>84);
    assert.equal((await call('export',{part:'missing'})).ok,false);
    const reopened=await call('open',{file:saved.file});assert.equal(reopened.ok,true);assert.deepEqual(reopened.built,first.built);
});
