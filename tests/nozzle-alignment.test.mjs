import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import init,* as engine from '../docs/wasm/acoustic_engine.js';
await init({module_or_path:fs.readFileSync(new URL('../docs/wasm/acoustic_engine_bg.wasm',import.meta.url))});
const cube=(r=12)=>({vertices:[[-r,-r,-r],[r,-r,-r],[r,r,-r],[-r,r,-r],[-r,-r,r],[r,-r,r],[r,r,r],[-r,r,r]],triangles:[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]]});
const native=JSON.parse(engine.workshop_import_stl(fs.readFileSync(new URL('../docs/assets/workshop/solid-shell.stl',import.meta.url)),1));
const driver=(y=0,id='d')=>({id,preset:13,position_mm:[0,y,0],rotation_deg:[0,0,0],lead_mm:2,bend_mm:[-6,y-.69,0],end_mm:[-8,y-.69,0],inner_diameter_mm:1.6,outer_diameter_mm:2.4});
const project=()=>({format:'hc-headphone-workshop',version:1,name:'Shared nozzle',shell_scale:[1,1,1],mirrored:false,drivers:[driver(-5,'a'),driver(0,'b'),driver(5,'c')]});
const build=(p,s=cube())=>JSON.parse(engine.workshop_build_json(JSON.stringify(p),JSON.stringify(s)));
const align=(p,s=cube(),id='a')=>JSON.parse(engine.workshop_align_nozzle_json(JSON.stringify(p),JSON.stringify(s),id));
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]);
function assertFlush(p,b) {
    const n=p.nozzle.normal.map((v,i)=>p.mirrored&&i===0?-v:v),origin=p.nozzle.origin_mm.map((v,i)=>p.mirrored&&i===0?-v:v);
    for(const route of b.paths) {
        const mesh=b.parts.find(part=>part.id===`path:${route.driver_id}`).mesh;
        const ringIndices=[...Array.from({length:16},(_,i)=>64*16+i),...Array.from({length:16},(_,i)=>65*16+64*16+i)];
        for(const index of ringIndices) assert.ok(Math.abs(dot(n,sub(mesh.vertices[index],origin)))<1e-7,'Every inner and outer rim vertex is flush');
        assert.ok(mesh.vertices.every(v=>dot(n,sub(v,origin))<1e-7),'No tube vertex protrudes past the nozzle plane');
        const tangent=sub(route.control_points[3],route.control_points[2]);
        assert.ok(Math.abs(dot(n,tangent)/Math.hypot(...tangent)-1)<1e-10);
    }
}
test('three separate tubes share a complete flush nozzle face and retain positions, diameters and acoustic lengths',()=>{
    const p=project(),before=structuredClone(p),a=align(p),b=build(a);
    assert.deepEqual(p,before);assert.deepEqual(b.export_blockers,[]);assertFlush(a,b);
    for(let i=0;i<3;i++) {
        assert.deepEqual(a.drivers[i].end_mm.slice(1),p.drivers[i].end_mm.slice(1),'Lateral positions retained');
        for(const key of ['id','preset','position_mm','rotation_deg','inner_diameter_mm','outer_diameter_mm'])assert.deepEqual(a.drivers[i][key],p.drivers[i][key]);
        assert.ok(b.paths[i].length_mm>build(p).paths[i].length_mm,'Updated lengths follow the extended path');
        const bytes=engine.workshop_export_stl(JSON.stringify(b.parts.find(part=>part.id===`path:${a.drivers[i].id}`).mesh));
        let terminalVertices=0;
        for(let off=84;off<bytes.length;off+=50)for(let j=0;j<3;j++) {
            const dv=new DataView(bytes.buffer,bytes.byteOffset+off+12+j*12,12),v=[0,1,2].map(k=>dv.getFloat32(4*k,true));
            const distance=dot(a.nozzle.normal,sub(v,a.nozzle.origin_mm));assert.ok(distance<1e-5);if(Math.abs(distance)<1e-5)terminalVertices++;
        }
        assert.ok(terminalVertices>=96,'Export includes the coplanar terminal annulus');
    }
    const unlocked=structuredClone(a);delete unlocked.nozzle;
    assert.ok(build(unlocked).export_blockers.some(e=>e.includes('shell')),'Generic shell contact is still blocked without a verified outlet');
});
test('tilted, translated and mirrored nozzle faces keep all outlet rims coplanar',()=>{
    const angle=.37,tilt=-.23;
    const rotate=([x,y,z])=>{const yy=y*Math.cos(tilt)-z*Math.sin(tilt),zz=y*Math.sin(tilt)+z*Math.cos(tilt);return[x*Math.cos(angle)-yy*Math.sin(angle),x*Math.sin(angle)+yy*Math.cos(angle),zz];};
    const move=v=>rotate(v).map((x,i)=>x+[.4,-.6,.3][i]);
    const s=cube();s.vertices=s.vertices.map(move);s.triangles.reverse();
    const p=project();for(const d of p.drivers){for(const key of ['position_mm','bend_mm','end_mm'])d[key]=move(d[key]);d.rotation_deg=[tilt*180/Math.PI,0,angle*180/Math.PI];}
    const a=align(p,s),b=build(a,s);assert.deepEqual(b.export_blockers,[]);assertFlush(a,b);
    a.mirrored=true;const m=build(a,s);assert.deepEqual(m.export_blockers,[]);assertFlush(a,m);
    for(let i=0;i<b.parts.length;i++)assert.deepEqual(m.parts[i].mesh.vertices,b.parts[i].mesh.vertices.map(([x,y,z])=>[-x,y,z]));
});
test('native nozzle detection selects its tilted end and avoids a folded exit route',()=>{
    const p=project();p.drivers=[driver(0,'a')];Object.assign(p.drivers[0],{position_mm:[3,-2,0],lead_mm:3,bend_mm:[-3,3,-2],end_mm:[-3,11,-2.4]});
    const a=align(p,native),b=build(a,native);assert.deepEqual(b.export_blockers,[]);assertFlush(a,b);
    assert.ok(a.nozzle.normal[1]>.96 && a.nozzle.normal[2]>.25);
    assert.deepEqual(build(JSON.parse(JSON.stringify(a)),native),b);
});
test('bad planes, overlapping outlets, outside footprints and stale shell scaling fail explicitly',()=>{
    const a=align(project()),original=structuredClone(a);
    for(const patch of [{normal:[0,0,0]},{normal:[1,0,0]},{origin_mm:[-11,0,0]},{lead_mm:0}]){
        const p=structuredClone(a);Object.assign(p.nozzle,patch);assert.throws(()=>align(p,cube(),''));
    }
    const overlap=project();overlap.drivers[1].end_mm=structuredClone(overlap.drivers[0].end_mm);assert.throws(()=>align(overlap),/overlap or touch/);
    const outside=project();outside.drivers[1].end_mm[2]=11.5;assert.throws(()=>align(outside),/footprint/);
    const stale=structuredClone(a);stale.shell_scale=[1.2,1,1];assert.throws(()=>build(stale),/footprint/);
    assert.deepEqual(a,original);
});
test('auto arrange respects the shared exit plane and tangent after relocating a driver',()=>{
    const p=align(project());p.drivers[0].position_mm[0]=15;
    const a=JSON.parse(engine.workshop_arrange_json(JSON.stringify(p),JSON.stringify(cube()),false)),b=build(a);
    assert.deepEqual(b.export_blockers,[]);assert.deepEqual(a.nozzle,p.nozzle);assertFlush(a,b);
});
test('drilled bores terminate on the same plane in one closed shell body',()=>{
    const p=project();p.drivers=[driver(-3,'a'),driver(3,'b')];
    for(const d of p.drivers){d.inner_diameter_mm=2;d.outer_diameter_mm=5;}
    p.construction={wall_mm:1.5,resolution_mm:.5,faceplate_axis:2,faceplate_depth_mm:2,faceplate_gap_mm:0,cut_sound_paths:true,drilled_channels:true,connector:null};
    const a=align(p,cube(10)),b=build(a,cube(10));assert.deepEqual(b.export_blockers,[]);assertFlush(a,b);
    assert.equal(b.parts.filter(p=>p.kind==='path').length,0);assert.equal(b.parts.filter(p=>p.kind==='channel').length,2);
    assert.equal(b.construction.body.boundary_edges,0);assert.equal(b.construction.body.nonmanifold_edges,0);
    assert.deepEqual(JSON.parse(engine.workshop_outlets_json(JSON.stringify(a),JSON.stringify(cube(10)))),a);
});
test('worker retains nozzle settings, reprojects edits, and rejects failed alignment transactionally',async()=>{
    const messages=[],context=vm.createContext({engine,init:async()=>{},URL,Uint8Array,JSON,self:{postMessage:m=>messages.push(m)}});
    vm.runInContext(fs.readFileSync(new URL('../docs/workshop-worker.js',import.meta.url),'utf8').replace(/^import .*\n/,'').replace(/new URL\('[^']+', import.meta.url\)/,"'fixture.wasm'"),context);
    const call=async(action,args={})=>{await context.self.onmessage({data:{id:1,action,...args}});return messages.pop();};
    const p=project(),file={format:'hc-workshop-file',version:1,project:p,shell:cube()};assert.equal((await call('open',{file})).ok,true);
    const aligned=await call('nozzle',{project:p,driverId:'a'});assert.equal(aligned.ok,true,aligned.error);
    const edited=structuredClone(aligned.project);edited.drivers[1].end_mm[0]+=2;
    const applied=await call('build',{project:edited});assert.equal(applied.ok,true,applied.error);assertFlush(applied.project,applied.built);
    const bad=structuredClone(applied.project);bad.drivers[1].end_mm[2]=20;assert.equal((await call('build',{project:bad})).ok,false);
    const saved=await call('save');assert.deepEqual(saved.file.project,applied.project);
    assert.deepEqual((await call('open',{file:saved.file})).built,applied.built);
    assert.equal((await call('export',{part:'path:a'})).ok,true);
});
