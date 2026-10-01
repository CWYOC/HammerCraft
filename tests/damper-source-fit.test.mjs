import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { designer } from './designer-helper.mjs';
import init, * as engine from '../docs/wasm/acoustic_engine.js';
await init({ module_or_path: fs.readFileSync(new URL('../docs/wasm/acoustic_engine_bg.wasm', import.meta.url)) });
const simulate = request => JSON.parse(engine.simulate_json(JSON.stringify(request)));
const rows = JSON.parse(fs.readFileSync(new URL('./fixtures/driver-library.json', import.meta.url)));
const guide = JSON.parse(fs.readFileSync(new URL('./fixtures/sonion-2356-design-example.json', import.meta.url)));
const grid = (n = 120) => Array.from({ length: n }, (_, i) => 100 * 80 ** (i / (n - 1)));
function setup() {
    const d = designer(), driver = d.databaseDriverToDesign(rows.find(r => r.model === '2356'));
    driver.circuit.output = 'in'; driver.circuit.nodes = driver.circuit.nodes.filter(n => n.id !== 'drv');
    d.state.drivers = [driver];
    d.context.window.HCAcousticEngine = { simulate: async request => simulate(request), version: async () => engine.engine_version() };
    assert.ok(d.applySonion2356Model(driver, true));
    return { d, driver };
}
// Independent complex nodal solution, not the engine's transfer-matrix algorithm.
const add = (a,b) => [a[0]+b[0],a[1]+b[1]], neg = a => [-a[0],-a[1]];
const sub = (a,b) => add(a,neg(b));
const mul = (a,b) => [a[0]*b[0]-a[1]*b[1],a[0]*b[1]+a[1]*b[0]];
const div = (a,b) => { const n=b[0]**2+b[1]**2; return [(a[0]*b[0]+a[1]*b[1])/n,(a[1]*b[0]-a[0]*b[1])/n]; };
const inv = a => div([1,0],a);
function nodal711(f, source, damper) {
    const w=2*Math.PI*f, cap=c=>[0,-1/(w*c)/1e8], mass=m=>[0,w*m/1e8], resistor=r=>[r/1e8,0];
    let zs=add(resistor(source.resistance_acoustic_ohm+damper),add(mass(source.inertance_kg_per_m4),cap(source.compliance_m3_per_pa)));
    for (const b of source.branches) {
        const w0=2*Math.PI*b.resonance_hz;
        const parallel=inv(add(inv(resistor(b.resistance_acoustic_ohm)),add(inv(mass(b.resistance_acoustic_ohm/(w0*b.q))),inv(cap(b.q/(w0*b.resistance_acoustic_ohm))))));
        zs=add(zs,parallel);
    }
    assert.ok(zs[0] > 0, 'Source is passive');
    const terminal=add(resistor(4.22e5),cap(1.517e-12));
    const yIn=inv(add(zs,mass(82.9))), y12=inv(mass(130.3)), y23=inv(mass(133.4));
    const y1=add(inv(add(resistor(4.22e5),cap(.7e-12))),inv(add(resistor(55.66e6),add(mass(9400),cap(2.34e-12)))));
    const y2=add(inv(add(resistor(4.22e5),cap(1.5e-12))),inv(add(resistor(27.99e6),add(mass(983.8),cap(2.73e-12)))));
    const A=[[add(yIn,add(y1,y12)),neg(y12),[0,0]], [neg(y12),add(y12,add(y2,y23)),neg(y23)], [[0,0],neg(y23),add(y23,inv(terminal))]];
    const b=[yIn,[0,0],[0,0]];
    for(let i=0;i<3;i++) {
        for(let j=i+1;j<3;j++) {
            const k=div(A[j][i],A[i][i]);
            for(let c=i;c<3;c++) A[j][c]=sub(A[j][c],mul(k,A[i][c]));
            b[j]=sub(b[j],mul(k,b[i]));
        }
    }
    const x=[];
    for(let i=2;i>=0;i--) {
        let v=b[i];for(let j=i+1;j<3;j++)v=sub(v,mul(A[i][j],x[j]));x[i]=div(v,A[i][i]);
    }
    return mul(x[2],div(cap(1.517e-12),terminal));
}
test('711 side branches, microphone pressure and passive source match an independent RLC nodal circuit', () => {
    const { d }=setup(), frequencies=[20,100,300,1000,2500,4042,4900,8000,13500,20000];
    const request=d.rustRequest(frequencies);
    const driver=request.drivers[0];
    driver.response=[];driver.gain_db=0;driver.response_absolute_spl=true;
    driver.measurement_reference_path=[];driver.measurement_reference_load=null;
    for(const r of [0,320e5,1500e5,2200e5]) {
        driver.acoustic_path=[{type:'damper',resistance_acoustic_ohm:r}];
        simulate(request).combined.forEach((p,i)=>{
            const h=nodal711(frequencies[i],driver.acoustic_source,r);
            assert.ok(Math.abs(p.db-20*Math.log10(Math.hypot(...h)))<1e-8);
            const phase=Math.atan2(h[1],h[0])*180/Math.PI;
            assert.ok(Math.abs(Math.sin((p.phase_deg-phase)*Math.PI/180))<1e-9);
        });
    }
});
test('guide preset keeps the baseline and wiring, splits the tube correctly and survives save/load', async () => {
    const { d,driver }=setup();
    const baseline=JSON.stringify(driver.measurement), wiring=JSON.stringify(driver.circuit);
    d.applySonion2356Model(driver,true);
    assert.equal(JSON.stringify(driver.circuit),wiring,'Applying the model does not rewire the circuit');
    assert.equal(driver.path.reduce((n,e)=>n+(e.length||0),0),12.5);
    assert.equal(driver.path.find(e=>e.type==='damper').value,1500);
    assert.equal(driver.path.slice(0,2).reduce((n,e)=>n+e.length,0),8.25);
    assert.equal(d.physicalInputErrors().length,0);
    const request=d.rustRequest(grid(),true);
    await d.calculate();
    assert.ok(d.state.last.undampedDrivers[0]);
    simulate(d.rustRequest(d.state.last.drivers[0].map(p=>p.frequency),true)).combined.forEach((p,i)=>assert.ok(Math.abs(p.db-d.state.last.drivers[0][i].db)<1e-8));
    d.saveProject();d.loadProject();
    assert.equal(JSON.stringify(d.rustRequest(grid(),true)),JSON.stringify(request));
    assert.equal(JSON.stringify(d.state.drivers[0].measurement),baseline);
    assert.equal(d.validationSetup().drivers[0].source_fit.independently_validated,false);
    // Reference/reference is an arithmetic identity, separate from fit residuals.
    d.state.drivers[0].path=driver.measurementReferencePath.map(p=>({type:'tube',length:p.length_mm,diameter:p.inner_diameter_mm,loss:0}));
    const unity=d.rustRequest(grid());
    assert.ok(simulate(unity).combined.every(p=>Math.abs(p.db)<1e-8));
});
test('guide fit improves measured-curve residuals and preserves bass, without claiming held-out validation', () => {
    const { d,driver }=setup(), frequencies=grid();
    const response=()=>simulate(d.rustRequest(frequencies,true)).combined.map(p=>p.db);
    const damped=response();driver.path=driver.path.filter(e=>e.type!=='damper');const undamped=response();
    const interp=(points,f)=>{let i=1;while(points[i].frequency<f)i++;const a=points[i-1],b=points[i];return a.db+(b.db-a.db)*Math.log(f/a.frequency)/Math.log(b.frequency/a.frequency);};
    const rms=xs=>Math.sqrt(xs.reduce((n,x)=>n+x*x,0)/xs.length);
    const delta=damped.map((x,i)=>x-undamped[i]);
    assert.ok(rms(damped.map((x,i)=>x-interp(guide.damped,frequencies[i])))<.95,'Training-curve SPL residual regression');
    assert.ok(rms(delta.map((x,i)=>x-interp(guide.damped,frequencies[i])+interp(guide.undamped,frequencies[i])))<1.2,'Training-curve damping residual regression');
    assert.ok(delta.filter((_,i)=>frequencies[i]<300).every(x=>Math.abs(x)<.1));
    assert.ok(Math.min(...delta.filter((_,i)=>frequencies[i]>2000 && frequencies[i]<5500)) < -7);
    // Zero resistance must leave the full complex curve unchanged.
    driver.path.splice(2,0,{type:'damper',value:0});
    assert.ok(response().every((x,i)=>Math.abs(x-undamped[i])<1e-8));
});
test('fit is opt-in, limited to its receiver/fixture and does not replace linked geometry', () => {
    const { d,driver }=setup();
    for(const row of rows) {
        const other=d.databaseDriverToDesign(row);
        assert.notEqual(other.sourceModel,'sonion_2356_guide_v1','No silent migration of source choices');
        if(row.model!=='2356') {const before=JSON.stringify(other);assert.equal(d.applySonion2356Model(other,true),false);assert.equal(JSON.stringify(other),before);}
    }
    driver.path[0].geometryBinding={routeId:'route'};
    const path=JSON.stringify(driver.path);assert.equal(d.applySonion2356Model(driver,true),false);
    assert.ok(d.applySonion2356Model(driver));assert.equal(JSON.stringify(driver.path),path);
    driver.measurementReferenceOverride={path:[],tubeless:true};
    assert.ok(d.physicalInputErrors().some(e=>e.includes('2356 example fit requires')));
});
test('invalid passive networks are rejected and a missing engine cannot silently approximate the fitted source', async () => {
    const { d,driver }=setup();
    for(const mutate of [s=>s.resistance_acoustic_ohm=-1,s=>s.inertance_kg_per_m4=-1,s=>s.compliance_m3_per_pa=0,s=>s.branches[0].q=0,s=>s.branches[0].resonance_hz=-1,s=>s.branches=Array(17).fill(s.branches[0])]) {
        const request=d.rustRequest([1000]);mutate(request.drivers[0].acoustic_source);
        assert.throws(()=>simulate(request),/Invalid passive source network/);
        assert.throws(()=>engine.reverse_design_json(JSON.stringify({base_request:request,target:[],driver_index:0,min_tube_length_mm:1,max_tube_length_mm:1,min_tube_diameter_mm:1,max_tube_diameter_mm:1,damper_values:[0],resistor_values_ohm:[0],capacitor_values_uf:[0],gain_range_db:0,max_evaluations:1,result_count:1})),/Invalid passive source network/);
    }
    driver.path=[];
    d.context.window.HCAcousticEngine.simulate=async()=>{throw Error('Unavailable');};
    await d.calculate();assert.equal(d.state.last,null);
    assert.equal(d.document.getElementById('iemEngineStatus').textContent,'ACOUSTIC ENGINE REQUIRED');
});
test('all ten library drivers remain finite under the new coupler with multiple damper values', () => {
    assert.equal(rows.length,10);
    for(const row of rows) {
        const d=designer(),driver=d.databaseDriverToDesign(row);d.state.drivers=[driver];
        d.document.getElementById('iemAcousticLoadType').value='iec711_lumped';
        for(const r of [0,320,680,1000,1500,2200]) {
            driver.path=[{type:'tube',length:7,diameter:1.5,loss:0},{type:'damper',value:r},{type:'tube',length:5.5,diameter:2.1,loss:0}];
            const result=simulate(d.rustRequest([20,100,1000,3000,5000,8000,15000,20000],true));
            assert.ok(result.combined.every(p=>Number.isFinite(p.db)&&Number.isFinite(p.phase_deg)),`${driver.name}, ${r} Ω`);
        }
    }
});
