import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import init, * as engine from '../docs/wasm/acoustic_engine.js';
await init({ module_or_path: fs.readFileSync(new URL('../docs/wasm/acoustic_engine_bg.wasm', import.meta.url)) });
const cube = {
    vertices:[[-10,-10,-10],[10,-10,-10],[10,10,-10],[-10,10,-10],[-10,-10,10],[10,-10,10],[10,10,10],[-10,10,10]],
    triangles:[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]],
};
const construction = () => ({wall_mm:1.5,resolution_mm:0.5,faceplate_axis:2,faceplate_depth_mm:2.5,faceplate_gap_mm:0,cut_sound_paths:false,connector:null});
const project = () => ({format:'hc-headphone-workshop',version:1,name:'Solid fixture',shell_scale:[1,1,1],mirrored:false,drivers:[],construction:construction()});
const build = (p, stock=cube) => JSON.parse(engine.workshop_build_json(JSON.stringify(p),JSON.stringify(stock)));
const driver = () => ({id:'a',preset:13,position_mm:[-2,0,0],rotation_deg:[0,0,0],lead_mm:2,bend_mm:[-8,0,0],end_mm:[-13,0,0],inner_diameter_mm:3,outer_diameter_mm:4});
function inspect(mesh) {
    const edges=new Map();let volume=0;
    for(const [a,b,c] of mesh.triangles){
        const [p,q,r]=[a,b,c].map(i=>mesh.vertices[i]);
        assert.ok([...p,...q,...r].every(Number.isFinite));
        assert.ok(new Set([a,b,c]).size===3,'no collapsed triangles');
        volume+=(p[0]*(q[1]*r[2]-q[2]*r[1])+p[1]*(q[2]*r[0]-q[0]*r[2])+p[2]*(q[0]*r[1]-q[1]*r[0]))/6;
        for(const [i,j] of [[a,b],[b,c],[c,a]]){const k=[Math.min(i,j),Math.max(i,j)].join(':');const e=edges.get(k)||[0,0];e[0]++;e[1]+=i<j?1:-1;edges.set(k,e);}
    }
    assert.ok([...edges.values()].every(([n,w])=>n===2&&w===0),'watertight consistently oriented mesh');
    assert.ok(volume>0);return volume;
}

test('hollow body and separate cap are closed solids with approximately analytic cube volumes',()=>{
    const p=project(),b=build(p);
    assert.deepEqual(b.parts.map(p=>p.id),['shell','faceplate']);
    const body=inspect(b.parts[0].mesh),cap=inspect(b.parts[1].mesh);
    assert.ok(Math.abs(body-2376)/2376<0.05,`body volume ${body}`);
    assert.ok(Math.abs(cap-1000)/1000<0.03,`cap volume ${cap}`);
    assert.ok(body+cap<8000*0.5,'real cavity removes interior material');
    assert.equal(b.construction.faceplate_plane_mm,7.5);
    assert.ok(b.construction.cavity_volume_estimate_mm3>4000);
    assert.equal(b.construction.body.boundary_edges,0);
    assert.equal(b.placement_checks.some(c=>c.code==='shell-construction'),true);
});

test('sound routes and rectangular/round connector cuts remove actual material',()=>{
    const p=project();p.drivers=[driver()];
    const original=build(p).construction.body.signed_volume_mm3;
    p.construction.cut_sound_paths=true;
    const bored=build(p);assert.ok(bored.construction.body.signed_volume_mm3<original-5);
    assert.equal(bored.placement_checks.find(c=>c.code==='sound-outlet').status,'unverified');
    for(const shape of ['box','cylinder']) {
        p.construction.connector={shape,center_mm:[10,0,0],rotation_deg:[0,90,0],size_mm:[3,3,6]};
        const cut=build(p);assert.ok(cut.construction.body.signed_volume_mm3<bored.construction.body.signed_volume_mm3-4);
        assert.equal(cut.placement_checks.find(c=>c.code==='connector-cut').status,'unverified');
        inspect(cut.parts[0].mesh);
    }
});

test('faceplate axis, depth and gap change actual cap/body geometry and persist through JSON',()=>{
    const p=project();p.construction.faceplate_axis=0;p.construction.faceplate_depth_mm=3;p.construction.faceplate_gap_mm=.2;
    const b=build(p),body=b.parts[0].mesh,cap=b.parts[1].mesh;
    assert.ok(Math.abs(Math.max(...body.vertices.map(v=>v[0]))-7)<1e-6);
    assert.ok(Math.abs(Math.min(...cap.vertices.map(v=>v[0]))-7.2)<1e-6);
    assert.deepEqual(build(JSON.parse(JSON.stringify(p))),b);
});

test('constructed parts mirror together, preserving closed topology and volume',()=>{
    const p=project(),normal=build(p);p.mirrored=true;const mirrored=build(p);
    for(let i=0;i<normal.parts.length;i++) {
        assert.deepEqual(mirrored.parts[i].mesh.vertices,normal.parts[i].mesh.vertices.map(([x,y,z])=>[-x,y,z]));
        assert.ok(Math.abs(inspect(normal.parts[i].mesh)-inspect(mirrored.parts[i].mesh))<1e-8);
    }
    assert.deepEqual(mirrored.shell.size_mm,normal.shell.size_mm);
});

test('generated body and cap survive binary STL export and reimport',()=>{
    const p=project();p.construction.connector={shape:'box',center_mm:[10,0,0],rotation_deg:[0,0,0],size_mm:[6,3,3]};
    for(const part of build(p).parts) {
        const original=inspect(part.mesh);
        const bytes=engine.workshop_export_stl(JSON.stringify(part.mesh));
        const restored=JSON.parse(engine.workshop_import_stl(bytes,1));
        assert.ok(Math.abs(inspect(restored)-original)/original<1e-5);
    }
});

test('open and inward stock, unresolved features, invalid cuts and oversized grids reject clearly',()=>{
    const open=structuredClone(cube);open.triangles.pop();
    const inward=structuredClone(cube);inward.triangles.forEach(t=>[t[1],t[2]]=[t[2],t[1]]);
    assert.throws(()=>build(project(),open),/closed/);
    assert.throws(()=>build(project(),inward),/outward/);
    for(const patch of [{wall_mm:.2},{resolution_mm:.1},{faceplate_axis:3},{faceplate_depth_mm:30},{faceplate_gap_mm:-1},{wall_mm:null}]) {
        const p=project();Object.assign(p.construction,patch);assert.throws(()=>build(p));
    }
    const p=project();p.drivers=[driver()];p.drivers[0].inner_diameter_mm=1;p.construction.cut_sound_paths=true;
    assert.throws(()=>build(p),/bore.*3×/);
    p.drivers=[];p.construction.connector={shape:'cylinder',center_mm:[10,0,0],rotation_deg:[0,0,0],size_mm:[3,4,6]};
    assert.throws(()=>build(p),/equal diameter/);
    p.construction.connector=null;p.shell_scale=[4,4,4];assert.throws(()=>build(p),/budget/);
});

test('cavity packing and non-intersecting openings are reported without silently moving the parts',()=>{
    const p=project();p.drivers=[driver()];
    assert.equal(build(p).placement_checks.find(c=>c.code==='package-cavity').status,'unverified');
    p.drivers[0].position_mm=[7,0,0];const before=structuredClone(p);const b=build(p);
    assert.equal(b.placement_checks.find(c=>c.code==='package-cavity').status,'error');
    assert.ok(b.paths[0].placement_errors.some(m=>m.includes('cavity clearance')));assert.deepEqual(p,before);
    p.drivers=[];p.construction.connector={shape:'box',center_mm:[30,0,0],rotation_deg:[0,0,0],size_mm:[3,3,6]};
    assert.equal(build(p).placement_checks.find(c=>c.code==='connector-cut').status,'warning');
});

test('real starter stock hollows successfully and refinement preserves the material volume',()=>{
    const stock=JSON.parse(engine.workshop_import_stl(fs.readFileSync(new URL('../docs/assets/workshop/solid-shell.stl',import.meta.url)),1));
    const p=project(),a=build(p,stock);p.construction.resolution_mm=.4;const b=build(p,stock);
    for(const result of [a,b]) {assert.equal(result.construction.body.boundary_edges,0);assert.equal(result.construction.faceplate.boundary_edges,0);}
    const volume=b=>b.construction.body.signed_volume_mm3+b.construction.faceplate.signed_volume_mm3;
    assert.ok(Math.abs(volume(a)-volume(b))/volume(b)<.03);
});

test('all 18 package presets receive cavity checks and retain their source placement',()=>{
    for(let preset=0;preset<18;preset++) {
        const p=project();p.drivers=[{...driver(),preset,position_mm:[0,0,0]}];
        const before=structuredClone(p),b=build(p);
        assert.equal(b.placement_checks.find(c=>c.code==='package-cavity').status,'unverified',`preset ${preset} fits cube cavity samples`);
        assert.deepEqual(p,before);
        p.drivers[0].position_mm=[10,0,0];
        const invalid=build(p);
        assert.equal(invalid.placement_checks.find(c=>c.code==='package-cavity').status,'error',`preset ${preset} detects wall penetration`);
        assert.ok(invalid.paths[0].placement_errors.some(m=>m.includes('cavity clearance')));
    }
});

test('worker retains the last constructed model after invalid settings and saves the source stock',async()=>{
    const messages=[];const context=vm.createContext({engine,init:async()=>{},URL,Uint8Array,JSON,self:{postMessage:m=>messages.push(m)}});
    const source=fs.readFileSync(new URL('../docs/workshop-worker.js',import.meta.url),'utf8').replace(/^import .*\n/,'').replace(/new URL\('[^']+', import.meta.url\)/,"'fixture.wasm'");
    vm.runInContext(source,context);let id=0;
    const call=async(action,args={})=>{await context.self.onmessage({data:{id:++id,action,...args}});return messages.pop();};
    const p=project(),file={format:'hc-workshop-file',version:1,sourceName:'Cube',project:p,shell:cube};
    const accepted=await call('open',{file});assert.equal(accepted.ok,true);
    const invalid=structuredClone(p);invalid.construction.wall_mm=.1;
    assert.equal((await call('build',{project:invalid})).ok,false);
    const saved=await call('save');assert.deepEqual(JSON.parse(JSON.stringify(saved.file)),file);
    assert.equal((await call('export',{part:'faceplate'})).ok,true);
    assert.deepEqual((await call('open',{file:saved.file})).built,accepted.built);
});
