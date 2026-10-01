import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import init, * as engine from '../docs/wasm/acoustic_engine.js';
import { createProject, connectTube, synchronize } from '../docs/design-project.mjs';
import { designer } from './designer-helper.mjs';
await init({ module_or_path: fs.readFileSync(new URL('../docs/wasm/acoustic_engine_bg.wasm', import.meta.url)) });
const catalog = JSON.parse(fs.readFileSync(new URL('../docs/assets/workshop/drivers.json', import.meta.url)));
const shell = JSON.parse(engine.workshop_import_stl(fs.readFileSync(new URL('../docs/assets/workshop/solid-shell.stl', import.meta.url)), 1));
const project = drivers => ({ format:'hc-headphone-workshop', version:1, name:'Placement test', shell_scale:[2,2,2], mirrored:false, drivers });
const build = (p, mesh=shell) => JSON.parse(engine.workshop_build_json(JSON.stringify(p), JSON.stringify(mesh)));
const checks = (b, code) => b.placement_checks.filter(c => c.code === code);
const rotate = (v, deg) => {
    v = [...v];
    for(let axis=0;axis<3;axis++) {
        const angle=deg[axis]*Math.PI/180, a=(axis+1)%3, b=(axis+2)%3, [x,y]=[v[a],v[b]];
        v[a]=Math.cos(angle)*x-Math.sin(angle)*y; v[b]=Math.sin(angle)*x+Math.cos(angle)*y;
    }
    return v;
};
function driver(preset=13, id='driver', position=[0,0,0], rotation=[0,0,0]) {
    const s=catalog.find(s=>s.id===preset);
    const point=t=>rotate(s.outlet_mm.map((v,i)=>v+t*s.outlet_axis[i]),rotation).map((v,i)=>v+position[i]);
    return { id,preset,position_mm:position,rotation_deg:rotation,bend_mm:point(6),end_mm:point(12),lead_mm:2,inner_diameter_mm:1.6,outer_diameter_mm:2.4 };
}

for(const s of catalog) test(`${s.name}: clear outlet departure, rotated and mirrored checks preserve missing-data status`,()=>{
    for(const rotation of [[0,0,0],[19,31,43]]) {
        const p=project([driver(s.id,'d',[0,0,0],rotation)]), b=build(p);
        assert.deepEqual(b.placement_checks.filter(c=>c.status==='error'||c.status==='warning'),[]);
        assert.deepEqual(b.paths[0].placement_errors,[]);
        assert.equal(checks(b,'outlet-adapter')[0].status,'unverified');
        assert.equal(checks(b,'part-dimensions')[0].status,s.supplier_dimensioned&&s.supplier_interface_dimensioned?'pass':'unverified');
        assert.equal(checks(b,'rear-vent').length,s.rear_vent_required?1:0);
        assert.equal(checks(b,'drive-electronics').length,s.dedicated_drive?1:0);
        assert.equal(checks(b,'tube-bend')[0].status,'unverified');
        p.mirrored=true;
        const mirrored=build(p);
        assert.deepEqual(mirrored.placement_checks.filter(c=>c.code!=='mirrored-components'),b.placement_checks);
        assert.equal(checks(mirrored,'mirrored-components')[0].status,'unverified');
    }
});

test('the reproduced route through another receiver is diagnosed and repairing it clears affected route errors',()=>{
    const a=driver(13,'a'), b=driver(13,'b',[-10,0,0]);
    a.bend_mm=[-12,0,0];a.end_mm=[-18,0,0];
    b.bend_mm=[-14,6,0];b.end_mm=[-14,12,0];
    const p=project([a,b]), before=structuredClone(p), result=build(p);
    const collision=checks(result,'tube-package').find(c=>c.part_ids.includes('path:a')&&c.part_ids.includes('b'));
    assert.equal(collision.status,'error');
    assert.match(collision.message,/penetrates/);
    assert.ok(result.paths.every(p=>p.placement_errors.some(m=>m===collision.message)));
    assert.deepEqual(p,before,'diagnosing a layout must not move or silently repair the parts');
    p.drivers[1]=driver(13,'b',[-10,8,0]);
    assert.deepEqual(build(p).paths.map(p=>p.placement_errors),[[],[]]);
});

test('a route returning through its own driver is not hidden by the outlet attachment exception',()=>{
    const d=driver();d.bend_mm=[4,0,0];d.end_mm=[10,0,0];
    assert.equal(checks(build(project([d])),'tube-own-package')[0].status,'error');
});

test('rotated packages use convex geometry; overlapping bounding boxes alone do not fail',()=>{
    const a=driver(3,'a',[0,0,0],[0,0,45]);
    const shifted=gap=>driver(3,'b',[-gap/Math.sqrt(2),gap/Math.sqrt(2),0],[0,0,45]);
    const clear=build(project([a,shifted(3.1)]));
    const bounds=m=>[0,1,2].map(i=>[Math.min(...m.vertices.map(v=>v[i])),Math.max(...m.vertices.map(v=>v[i]))]);
    const [x,y]=clear.parts.filter(p=>p.kind==='driver').map(p=>bounds(p.mesh));
    assert.ok(x.every((r,i)=>r[0]<y[i][1]&&r[1]>y[i][0]),'fixture really has overlapping AABBs');
    assert.equal(checks(clear,'package-package')[0].status,'pass');
    assert.equal(checks(build(project([a,shifted(2)])),'package-package')[0].status,'error');
    assert.equal(checks(build(project([a,shifted(2.73)])),'package-package')[0].status,'warning');
});

test('cylindrical packages are not treated as solid bounding-box corners',()=>{
    const clear=build(project([driver(15,'a'),driver(15,'b',[5,0,5])]));
    assert.equal(checks(clear,'package-package')[0].status,'pass');
    assert.equal(checks(build(project([driver(15,'a'),driver(15,'b',[4,0,4])])),'package-package')[0].status,'error');
});

test('outer tube contact is warned about even when the centreline misses the package',()=>{
    const a=driver(13,'a'), b=driver(13,'b',[-10,2.5,0]);
    const result=build(project([a,b]));
    const collision=checks(result,'tube-package').find(c=>c.part_ids.includes('path:a')&&c.part_ids.includes('b'));
    assert.ok(['error','warning'].includes(collision.status));
    // The straight centreline is y=0, outside b's y half-size of 1.48 mm.
    assert.ok(2.5>catalog[13].size_mm[1]/2);
});

test('crossing tubes are warned about; separating them in Z clears the contact',()=>{
    const a=driver(13,'a',[10,-8,0]), b=driver(13,'b',[10,8,0]);
    a.bend_mm=[-4,-4,0];a.end_mm=[-12,8,0];
    b.bend_mm=[-4,4,0];b.end_mm=[-12,-8,0];
    assert.equal(checks(build(project([a,b])),'tube-tube')[0].status,'warning');
    for(const key of ['position_mm','bend_mm','end_mm'])b[key][2]+=5;
    assert.equal(checks(build(project([a,b])),'tube-tube')[0].status,'pass');
});

test('a locally folded starter bend is rejected as a route input and the revised starter is clear',()=>{
    const d=driver();d.bend_mm=[-4,6,0];d.end_mm=[-3,11,-2.4];
    const bad=build(project([d]));
    assert.equal(checks(bad,'tube-bend')[0].status,'error');
    assert.match(bad.paths[0].placement_errors.join(' '),/bend radius/);
    d.lead_mm=3;d.bend_mm=[-7,5,0];
    const fixed=build(project([d]));
    assert.deepEqual(fixed.paths[0].placement_errors,[]);
    assert.equal(checks(fixed,'tube-bend')[0].status,'unverified','a clear geometric bend is not a validated material bend limit');
});

test('an interior cusp is detected and a loop raises nonlocal self-contact',()=>{
    const d=driver();d.lead_mm=10;d.bend_mm=[10,0,0];d.end_mm=[-8,0,0];
    assert.match(checks(build(project([d])),'tube-bend')[0].message,/zero tangent/);
    d.lead_mm=15;d.bend_mm=[-12,18,0];d.end_mm=[-3.45,0,0];
    assert.equal(checks(build(project([d])),'tube-self-contact')[0].status,'warning');
});

test('inverted and open shells fail their specific checks without claiming finished-shell validation',()=>{
    const reversed=structuredClone(shell);reversed.triangles.forEach(t=>[t[1],t[2]]=[t[2],t[1]]);
    const bad=build(project([]),reversed);
    assert.equal(checks(bad,'shell-orientation')[0].status,'error');
    assert.equal(checks(bad,'finished-shell')[0].status,'unverified');
    reversed.triangles.pop();
    assert.equal(checks(build(project([]),reversed),'shell-topology')[0].status,'error');
    assert.equal(checks(build(project([driver(13,'d',[100,0,0])])),'package-stock-bounds')[0].status,'error');
});

test('confirmed placement errors block linked acoustic calculation and clear after repair',async()=>{
    const app=designer(), acoustic=app.driver();app.ensureDriverShape(acoustic);acoustic.id='a';app.state.drivers=[acoustic];
    const g=driver();g.bend_mm=[4,0,0];g.end_mm=[10,0,0];
    const p=project([g]), file={format:'hc-workshop-file',version:1,sourceName:'Test',project:p,shell};
    const design=connectTube(createProject(file,JSON.parse(JSON.stringify(app.exportProject())),'test'),{
        id:'link',geometryDriverId:g.id,acousticDriverId:'a',tubeIndex:0,
    });
    const bad=synchronize(design,build(p).paths);
    assert.equal(bad.statuses[0].ok,false);
    assert.match(bad.project.acoustics.drivers[0].geometryLinkError,/3D placement error/);
    app.state.drivers=bad.project.acoustics.drivers;
    let calls=0;app.context.window.HCAcousticEngine={simulate:async()=>{calls++;throw Error('Should not calculate');}};
    await app.calculate();assert.equal(calls,0);assert.equal(app.state.last,null);
    p.drivers[0]=driver();
    const fixed=synchronize(bad.project,build(p).paths);
    assert.equal(fixed.statuses[0].ok,true);
    assert.equal(fixed.project.acoustics.drivers[0].geometryLinkError,undefined);
    assert.equal(fixed.project.acoustics.drivers[0].path[0].geometryBinding.stale,false);
});
