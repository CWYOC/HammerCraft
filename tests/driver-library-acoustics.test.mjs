import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { designer } from './designer-helper.mjs';
import init, * as engine from '../docs/wasm/acoustic_engine.js';
await init({ module_or_path: fs.readFileSync(new URL('../docs/wasm/acoustic_engine_bg.wasm', import.meta.url)) });
// All ten default database measurements, captured 2026-09-25; no live DB dependency.
const rows = JSON.parse(fs.readFileSync(new URL('./fixtures/driver-library.json', import.meta.url)));
const supported = new Set(['2356', '28UAP01', '38D1XJ007Mi/8a', 'EST65DA01', '17A003', '33AJ007i/9']);
const frequencies = Array.from({ length: 240 }, (_, i) => 20 * 1000 ** (i / 239));
const simulate = request => JSON.parse(engine.simulate_json(JSON.stringify(request)));

function setup(row) {
    const d = designer(), driver = d.databaseDriverToDesign(row);
    driver.circuit.nodes = driver.circuit.nodes.filter(n => n.id !== 'drv'); driver.circuit.output = 'in';
    d.state.drivers = [driver];
    d.context.window.HCAcousticEngine = { simulate: async request => simulate(request), version: async () => 'test WASM' };
    return { d, driver };
}

for (const row of rows) test(`${row.manufacturer} ${row.model}: ${supported.has(row.model) ? 'reference and changed acoustic paths' : 'missing fixture data is diagnosed'}`, async () => {
    const { d, driver } = setup(row);
    if (!supported.has(row.model)) {
        assert.equal(driver.measurementReferenceCompensation, false);
        assert.equal(d.referenceInfo(driver).complete, false);
        assert.match(d.databaseReferenceError(driver), /dimensions are missing|adapter geometry is missing/);
        let calls = 0;
        d.context.window.HCAcousticEngine.simulate = async () => { calls++; throw Error('Invalid reference reached engine'); };
        await d.calculate();
        assert.equal(calls, 0); assert.equal(d.state.last, null);
        assert.match(d.document.getElementById('iemSimulationMessage').textContent, /acoustic prediction unavailable/i);
        d.state.reverse = [{ frequency: 100, db: 90 }, { frequency: 10000, db: 90 }];
        d.document.getElementById('iemReverseDriver').value = '0';
        await d.reverseRun();
        assert.match(d.document.getElementById('iemReverseMessage').textContent, /acoustic prediction unavailable/i);
        // Old saved projects previously claimed compensation for coupler-only rows.
        driver.measurementReferenceCompensation = true;
        d.ensureDriverShape(driver);
        assert.equal(driver.measurementReferenceCompensation, false);
        return;
    }
    assert.equal(driver.sourceModel, 'estimated_resistance');
    assert.equal(driver.measurementReferenceCompensation, true);
    assert.equal(d.databaseReferenceError(driver), '');
    const load = driver.measurementReferenceLoad;
    d.document.getElementById('iemAcousticLoadType').value = load.type;
    if (load.type === 'closed_cavity') d.document.getElementById('iemCouplerVolume').value = String(load.volume_mm3);
    driver.path = Array.from(d.referenceInfo(driver).modelled, p => ({ ...p }));
    const reference = simulate(d.rustRequest(frequencies)).combined;
    assert.ok(reference.every(p => Math.abs(p.db) < 1e-8), 'Matched reference must cancel');
    const source = d.rustRequest([1000]).drivers[0].acoustic_source;
    for (const [length, diameter] of [[6, 1], [12, 2], [20, 3]]) {
        driver.path = [{ type: 'tube', length, diameter, loss: 0 }];
        const request = d.rustRequest(frequencies);
        assert.deepEqual(request.drivers[0].acoustic_source, source);
        const response = simulate(request).combined;
        assert.ok(response.every(p => Number.isFinite(p.db) && Number.isFinite(p.phase_deg)));
        assert.ok(response.some(p => Math.abs(p.db) > 0.1), 'Changing geometry must affect the prediction');
        driver.path.push({ type: 'damper', value: 1000 });
        const dampedRequest = d.rustRequest(frequencies);
        assert.equal(dampedRequest.drivers[0].acoustic_path.at(-1).resistance_acoustic_ohm, 1e8);
        const damped = simulate(dampedRequest).combined;
        assert.ok(damped.some((p, i) => Math.abs(p.db - response[i].db) > 1), 'A catalog damper must have an acoustic effect');
    }
});

test('an old 2 cc project receives the supported reference load and finite-source default', async () => {
    const { d, driver } = setup(rows.find(r => r.model === '28UAP01'));
    driver.measurementReferenceLoad = null; driver.measurementReferenceCompensation = false;
    delete driver.sourceModel; delete driver.sourceResistanceCgs; delete driver.sourceReferenceDiameterMm;
    d.ensureDriverShape(driver);
    assert.equal(driver.measurementReferenceLoad.type, 'closed_cavity');
    assert.equal(driver.measurementReferenceLoad.volume_mm3, 2000);
    assert.equal(driver.measurementReferenceCompensation, true);
    assert.equal(driver.sourceModel, 'estimated_resistance');
    assert.equal(driver.sourceReferenceDiameterMm, 1);
    const load = d.document.getElementById('iemAcousticLoadType'); load.dispatchEvent = () => {};
    d.document.getElementById('iemLoadLossResistance').value = '123456789';
    const button = { dataset: { useReferencePath: driver.id } };
    d.document.querySelectorAll = selector => selector === '[data-use-reference-path]' ? [button] : [];
    d.bindDriverEvents(); await button.onclick();
    assert.equal(Number(d.document.getElementById('iemLoadLossResistance').value), 0, 'Reset stale cavity leakage as well as volume');
    assert.equal(d.state.last.validation[0].pass, true);
});
