import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { designer } from './designer-helper.mjs';
import init, * as engine from '../docs/wasm/acoustic_engine.js';
import { fitSource } from './diagnostics/fit-source-network.mjs';
import { fitManifest } from './diagnostics/fit-driver-sources.mjs';
import { grid, hash } from './diagnostics/measurement-validation.mjs';
await init({module_or_path:fs.readFileSync(new URL('../docs/wasm/acoustic_engine_bg.wasm',import.meta.url))});
const simulate=r=>JSON.parse(engine.simulate_json(JSON.stringify(r)));
const rows=JSON.parse(fs.readFileSync(new URL('./fixtures/driver-library.json',import.meta.url)));
const tube=(length,diameter=2)=>({type:'tube',length,diameter,loss:0});
function setup(row=rows[0]) {
    const d=designer(),driver=d.databaseDriverToDesign(row);
    driver.circuit.output='in';driver.circuit.nodes=driver.circuit.nodes.filter(n=>n.id!=='drv');d.state.drivers=[driver];
    d.document.getElementById('iemAcousticLoadType').value=driver.measurementReferenceLoad.type;
    if(driver.measurementReferenceLoad.volume_mm3)d.document.getElementById('iemCouplerVolume').value=String(driver.measurementReferenceLoad.volume_mm3);
    d.context.window.HCAcousticEngine={simulate:async r=>simulate(r),version:async()=>engine.engine_version()};
    return {d,driver};
}
// Synthetic calibration session used only to test the fitter; never saved as lab evidence.
function syntheticCases(row=rows[0], branches=[]) {
    const {d,driver}=setup(row);
    const band=[Math.max(100,row.fr[0].frequency_hz),Math.min(8000,row.fr.at(-1).frequency_hz)];
    const truth={type:'foster',resistance_acoustic_ohm:1.8e8,inertance_kg_per_m4:2300,compliance_m3_per_pa:2.1e-13,branches};
    const paths=[[tube(6)],[tube(7),{type:'damper',value:680},tube(5)],[tube(9,1.5),{type:'damper',value:2200},tube(5,1.5)]];
    const cases=paths.map((p,i)=>{
        driver.path=p;const setup=d.validationSetup(),request=structuredClone(setup.request);
        request.frequencies_hz=grid(...band,60);request.drivers[0].acoustic_source=truth;
        return {item:{id:`synthetic-${i}`,driver:driver.name,role:i===2?'validation':'fit',band_hz:band},setup,
            measurement:{schema_version:1,kind:'physical_measurement',setup_confirmed:true,setup_sha256:hash(setup),input_voltage_v:.1,
                specimen_id:'SYNTHETIC TEST ONLY',mount_id:'synthetic',coupler_model:'synthetic',calibration_id:'synthetic',acquired_at:'synthetic',
                points:simulate(request).combined}};
    });
    return {d,driver,cases,truth};
}
for(const row of rows)test(`${row.manufacturer} ${row.model}: individual passive network, persistence, reference unity and damper sweep`,async()=>{
    const {d,driver}=setup(row),original=JSON.stringify(driver.measurement),pathBefore=JSON.stringify(driver.path),wiring=JSON.stringify(driver.circuit);
    assert.equal(driver.measurementReferenceLoad.type,row.model==='28UAP01'?'closed_cavity':'iec711_lumped');
    d.usePassiveSource(driver);
    assert.equal(driver.sourceModel,'passive_network');assert.equal(driver.sourceNetworkFit,undefined);
    assert.equal(JSON.stringify(driver.path),pathBefore);assert.equal(JSON.stringify(driver.circuit),wiring);
    driver.sourceNetwork.branches.push({resistance_acoustic_ohm:2e8,resonance_hz:4800,q:3});
    const source=JSON.stringify(driver.sourceNetwork),frequencies=grid(20,20000,160);
    const request=()=>d.rustRequest(frequencies,true);
    driver.path=d.referenceInfo(driver).modelled.map(e=>({...e}));
    assert.ok(simulate(d.rustRequest(frequencies)).combined.every(p=>Math.abs(p.db)<1e-8));
    let previous;
    for(const resistance of [0,320,680,1000,1500,2200,4700]) {
        driver.path=[tube(5,1.5),{type:'damper',value:resistance},tube(7,1.5)];
        const r=request(),result=simulate(r).combined;
        assert.equal(JSON.stringify(r.drivers[0].acoustic_source),source);
        assert.ok(result.every(p=>Number.isFinite(p.db)&&Number.isFinite(p.phase_deg)));
        if(previous)assert.ok(result.some((p,i)=>Math.abs(p.db-previous[i].db)>.1));
        previous=result;
    }
    await d.calculate();assert.ok(d.state.last.undampedDrivers[0]);
    const expected=simulate(d.rustRequest(d.state.last.drivers[0].map(p=>p.frequency),true)).combined;
    assert.ok(expected.every((p,i)=>Math.abs(p.db-d.state.last.drivers[0][i].db)<1e-8));
    d.saveProject();d.loadProject();assert.equal(JSON.stringify(d.state.drivers[0].sourceNetwork),source);
    assert.equal(JSON.stringify(d.state.drivers[0].measurement),original);
    assert.match(d.document.getElementById('iemModelNotes').textContent,/Starting parameters are uncalibrated/);
});
test('all-driver source fitter recovers held-out synthetic damping without reading validation measurements',()=>{
    const {d,driver,cases}=syntheticCases(rows.find(r=>r.model==='28UAP01'));
    const expected=cases[2].measurement.points;
    const fitInput=[...cases.slice(0,2),{item:cases[2].item,get measurement(){throw Error('Validation leakage');},get setup(){throw Error('Validation leakage');}}];
    const profile=fitSource(fitInput,simulate,{branches:0,maxEvaluations:1800,points:60});
    assert.ok(profile.fit.rms_db<.02,JSON.stringify(profile.fit));
    assert.equal(profile.independently_validated,false);assert.equal(profile.evidence.length,2);
    d.importSourceProfile(driver,profile);
    const request=d.rustRequest(expected.map(p=>p.frequency_hz),true);
    assert.ok(simulate(request).combined.every((p,i)=>Math.abs(p.db-expected[i].db)<.1),'Withheld synthetic geometry/resistance recovered');
    assert.equal(d.validationSetup().drivers[0].source_fit.independently_validated,false);
    d.saveProject();d.loadProject();assert.equal(d.state.drivers[0].sourceNetworkFit.status,'FIT_NOT_VALIDATED');
    const before=JSON.stringify(d.state.drivers[0]);
    profile.binding.model='Different receiver';assert.throws(()=>d.importSourceProfile(d.state.drivers[0],profile),/different receiver/);
    assert.equal(JSON.stringify(d.state.drivers[0]),before);
});
test('profiles cannot be reused after a baseline/reference change and editing parameters removes fit provenance',()=>{
    const {d,driver,cases}=syntheticCases();
    const profile=fitSource(cases,simulate,{branches:0,maxEvaluations:1200,points:40});d.importSourceProfile(driver,profile);
    driver.measurement[0].db+=1;assert.ok(d.physicalInputErrors().some(e=>/different receiver/.test(e)));
    driver.measurement[0].db-=1;
    const input={dataset:{sourceNetwork:`${driver.id}:series:resistance_acoustic_ohm`},value:'850'};
    d.document.querySelectorAll=s=>s==='[data-source-network]'?[input]:[];d.bindDriverEvents();input.onchange();
    assert.equal(driver.sourceNetwork.resistance_acoustic_ohm,850e5);assert.equal(driver.sourceNetworkFit,undefined);
    assert.equal(d.physicalInputErrors().length,0);
});
test('one-mode source fitting predicts held-out synthetic data and freezes profiles into new acquisition packets',()=>{
    const {cases,truth}=syntheticCases(rows[0],[{resistance_acoustic_ohm:7e8,resonance_hz:4200,q:5}]);
    const profile=fitSource(cases,simulate,{maxEvaluations:8000,points:60});
    assert.ok(profile.fit.rms_db<.05,JSON.stringify(profile.fit));
    const heldOut=structuredClone(cases[2].setup.request);heldOut.frequencies_hz=cases[2].measurement.points.map(p=>p.frequency_hz);
    heldOut.drivers[0].acoustic_source=profile.source;
    const predicted=simulate(heldOut).combined;
    assert.ok(predicted.every((p,i)=>Math.abs(p.db-cases[2].measurement.points[i].db)<.3),'One-mode held-out response agrees');
    assert.ok(profile.source.branches.length===truth.branches.length);
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hc-frozen-source-test-'));
    try {
        const profiles=path.join(tmp,'profiles');fs.mkdirSync(profiles);
        fs.writeFileSync(path.join(profiles,'synthetic.source.json'),JSON.stringify(profile));
        const packet=path.join(tmp,'packet');
        const result=spawnSync(process.execPath,['tests/diagnostics/prepare-iem-validation.mjs',packet,profiles],{encoding:'utf8'});
        assert.equal(result.status,0,result.stderr);
        const manifest=JSON.parse(fs.readFileSync(path.join(packet,'manifest.json')));
        for(const item of manifest.cases.filter(c=>c.driver==='Sonion 2356')) {
            const setup=JSON.parse(fs.readFileSync(path.join(packet,item.setup_file)));
            assert.deepEqual(setup.request.drivers[0].acoustic_source,profile.source);
            assert.equal(setup.drivers[0].source_fit.independently_validated,false);
            const template=JSON.parse(fs.readFileSync(path.join(packet,'measurement-templates',`${item.id}.json`)));
            assert.equal(template.setup_sha256,hash(setup));assert.deepEqual(template.points,[]);
        }
    } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});
test('source-file import rejects a stale async completion and source selection refreshes the parameter panel',async()=>{
    const {d,driver,cases}=syntheticCases();
    const profile=fitSource(cases,simulate,{branches:0,maxEvaluations:1000,points:40});
    let resolve;
    const input={dataset:{sourceProfile:driver.id},files:[{size:2000,text:()=>new Promise(r=>{resolve=r;})}]};
    const message={textContent:''};
    d.document.querySelectorAll=s=>s==='[data-source-profile]'?[input]:[];
    d.document.querySelector=()=>message;
    d.bindDriverEvents();const pending=input.onchange();
    d.usePassiveSource(driver);const before=JSON.stringify(driver);
    resolve(JSON.stringify(profile));await pending;
    assert.equal(JSON.stringify(driver),before);assert.match(message.textContent,/Design changed during import/);
    const select={dataset:{f:'sourceModel'},value:'estimated_resistance'};
    const card={dataset:{driverId:driver.id},querySelectorAll:s=>s==='[data-f]'?[select]:[]};
    d.document.querySelectorAll=s=>s==='.iem-driver-card'?[card]:[];
    d.bindDriverEvents();select.onchange();
    assert.equal(driver.sourceModel,'estimated_resistance');
    assert.doesNotMatch(d.sourceNetworkHtml(driver),/Source network parameters/);
});
test('visible source fields are synchronized on input, calculation and export without changing untouched fits',async()=>{
    const {d,driver,cases}=syntheticCases();
    const profile=fitSource(cases,simulate,{branches:0,maxEvaluations:1000,points:40});d.importSourceProfile(driver,profile);
    const input={dataset:{sourceNetwork:`${driver.id}:series:resistance_acoustic_ohm`},value:String(driver.sourceNetwork.resistance_acoustic_ohm/1e5)};
    d.document.querySelectorAll=s=>s==='[data-source-network]'?[input]:[];
    d.bindDriverEvents();
    d.exportProject();assert.ok(driver.sourceNetworkFit,'Untouched display value preserves fit provenance');
    input.value='-1';input.oninput();assert.equal(driver.sourceNetworkFit,undefined);assert.equal(driver.sourceNetwork.resistance_acoustic_ohm,-1e5);
    await d.calculate();assert.equal(d.state.last,null);assert.match(d.document.getElementById('iemSimulationMessage').textContent,/Source R and M/);
    input.value='1300';await d.calculate();assert.ok(d.state.last);assert.equal(driver.sourceNetwork.resistance_acoustic_ohm,1300e5);
    input.value='1500';assert.equal(d.exportProject().drivers[0].sourceNetwork.resistance_acoustic_ohm,1500e5);
});
test('invalid network imports are transactional and the simplified fallback is blocked',async()=>{
    const {d,driver}=setup();d.usePassiveSource(driver);const before=JSON.stringify(d.exportProject());
    const invalid=d.exportProject();invalid.drivers[0].sourceNetwork.branches=[null];
    assert.throws(()=>d.importProject(invalid),/source branches/);assert.equal(JSON.stringify(d.exportProject()),before);
    driver.path=[];d.context.window.HCAcousticEngine.simulate=async()=>{throw Error('Unavailable');};
    await d.calculate();assert.equal(d.state.last,null);assert.equal(d.document.getElementById('iemEngineStatus').textContent,'ACOUSTIC ENGINE REQUIRED');
});
test('missing measurements, stale hashes and source-independent reference cases cannot create a fit',()=>{
    const {cases}=syntheticCases();
    assert.throws(()=>fitSource([cases[0],cases[2]],simulate),/two measured fit cases/);
    cases[0].measurement.setup_sha256='wrong';assert.throws(()=>fitSource(cases,simulate),/setup hash/);
    cases[0].measurement.setup_sha256=hash(cases[0].setup);
    cases[1].setup.request.drivers[0].acoustic_path=structuredClone(cases[0].setup.request.drivers[0].acoustic_path);
    cases[1].measurement.setup_sha256=hash(cases[1].setup);
    assert.throws(()=>fitSource(cases,simulate),/two distinct source-sensitive/);
});
test('batch fitting reports every missing driver without writing invented source profiles',async()=>{
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hc-all-driver-fit-test-'));
    try {
        const entries=rows.map((row,i)=>{const {d,driver}=setup(row);const name=`setup-${i}.json`;fs.writeFileSync(path.join(tmp,name),JSON.stringify(d.validationSetup()));return {id:String(i),driver:driver.name,role:'fit',setup_file:name,measurement_file:`missing-${i}.json`};});
        fs.writeFileSync(path.join(tmp,'manifest.json'),JSON.stringify({schema_version:1,cases:entries}));
        const report=await fitManifest(path.join(tmp,'manifest.json'),path.join(tmp,'output'));
        assert.equal(report.results.length,10);assert.ok(report.results.every(r=>r.status==='AWAITING_MEASUREMENTS'));
        assert.deepEqual(fs.readdirSync(path.join(tmp,'output')),['report.json']);
        await assert.rejects(()=>fitManifest(path.join(tmp,'manifest.json'),path.join(tmp,'output')),/already exists/);
    }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
