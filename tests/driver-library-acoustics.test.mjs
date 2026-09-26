import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { designer } from './designer-helper.mjs';
import init, * as engine from '../docs/wasm/acoustic_engine.js';
await init({ module_or_path: fs.readFileSync(new URL('../docs/wasm/acoustic_engine_bg.wasm', import.meta.url)) });
// All ten default database measurements, captured 2026-09-25; no live DB dependency.
const rows = JSON.parse(fs.readFileSync(new URL('./fixtures/driver-library.json', import.meta.url)));
const frequencies = Array.from({ length: 240 }, (_, i) => 20 * 1000 ** (i / 239));
const simulate = request => JSON.parse(engine.simulate_json(JSON.stringify(request)));

function setup(row) {
    const d = designer(), driver = d.databaseDriverToDesign(row);
    driver.circuit.nodes = driver.circuit.nodes.filter(n => n.id !== 'drv'); driver.circuit.output = 'in';
    d.state.drivers = [driver];
    d.context.window.HCAcousticEngine = { simulate: async request => simulate(request), version: async () => 'test WASM' };
    return { d, driver };
}

for (const row of rows) test(`${row.manufacturer} ${row.model}: reference, changed tubes, dampers and reverse design`, async () => {
    const { d, driver } = setup(row);
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
    await d.calculate();
    const forward = d.state.last.drivers[0];
    const full = simulate(d.rustRequest(forward.map(p => p.frequency), true)).combined;
    assert.ok(full.every((p, i) => Math.abs(p.db - forward[i].db) < 1e-8), 'Forward and optimizer baselines agree');
    const results = JSON.parse(engine.reverse_design_json(JSON.stringify({
        base_request: d.rustRequest([100, 1000, 10000], true), target: [{ frequency_hz: 100, db: 110, phase_deg: 0 }, { frequency_hz: 10000, db: 100, phase_deg: 0 }],
        driver_index: 0, min_tube_length_mm: 12, max_tube_length_mm: 12,
        min_tube_diameter_mm: 2, max_tube_diameter_mm: 2, damper_values: [6.8e7],
        capacitor_values_uf: [0], resistor_values_ohm: [0], gain_range_db: 0, result_count: 1, max_evaluations: 1,
    })));
    assert.ok(results.length && Number.isFinite(results[0].score_rmse_db), 'Reverse design produces a finite candidate');
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

test('documented and assumed references stay distinct and preserve raw library metadata', () => {
    for (const [model, status, count] of [['RAU-34832-B148', 'DOCUMENTED TUBE', 1], ['RDI-34006-000', 'DOCUMENTED TUBELESS', 0],
        ['CI-22955-000', 'ASSUMED ADAPTER', 2], ['HODVTEC-31618-000', 'ASSUMED DIRECT COUPLING', 0]]) {
        const row = rows.find(r => r.model === model), { d, driver } = setup(row);
        assert.equal(JSON.stringify(driver.measurementReferencePath), JSON.stringify(row.reference_path));
        assert.equal(d.referenceInfo(driver).status, status);
        assert.equal(d.rustRequest([1000]).drivers[0].measurement_reference_path.length, count);
        assert.equal(driver.sourceReferenceDiameterMm, model.startsWith('RAU') ? 1 : 2);
        // Re-open a project created before reference profiles existed.
        delete driver.referenceProfileVersion;
        driver.measurementReferenceCompensation = false; driver.sourceModel = 'ideal_pressure';
        d.ensureDriverShape(driver);
        assert.equal(driver.measurementReferenceCompensation, true);
        assert.equal(driver.sourceModel, 'estimated_resistance');
        driver.sourceModel = 'ideal_pressure'; // Later explicit diagnostic choice survives.
        d.ensureDriverShape(driver);
        assert.equal(driver.sourceModel, 'ideal_pressure');
        delete driver.referenceProfileVersion;
        driver.sourceModel = 'resonant'; driver.sourceQ = 7;
        d.ensureDriverShape(driver);
        assert.equal(driver.sourceModel, 'resonant');
        assert.equal(driver.sourceQ, 7);
    }
});

test('tubeless unity button clears the design tube and uses the reference load', async () => {
    const { d, driver } = setup(rows.find(r => r.model === 'RDI-34006-000'));
    const button = { dataset: { useReferencePath: driver.id } };
    d.document.getElementById('iemAcousticLoadType').dispatchEvent = () => {};
    d.document.querySelectorAll = selector => selector === '[data-use-reference-path]' ? [button] : [];
    d.bindDriverEvents(); await button.onclick();
    assert.equal(driver.path.length, 0);
    assert.equal(d.state.last.validation[0].pass, true);
    assert.match(d.document.getElementById('iemModelNotes').textContent, /DOCUMENTED TUBELESS/);
});

test('reference edits invalidate results, persist independently and reject invalid dimensions', async () => {
    const row = rows.find(r => r.model === 'RAU-34832-B148'), { d, driver } = setup(row);
    const field = { value: '4', dataset: { referenceField: `${driver.id}:0:length_mm` } };
    d.document.querySelectorAll = selector => selector === '[data-reference-field]' ? [field] : [];
    driver.referenceValidationMode = true;
    await d.calculate();
    d.bindDriverEvents(); field.onchange();
    assert.equal(d.state.last, null);
    assert.equal(driver.referenceValidationMode, false);
    assert.equal(d.rustRequest([1000]).drivers[0].measurement_reference_path[0].length_mm, 4);
    assert.equal(JSON.stringify(driver.measurementReferencePath), JSON.stringify(row.reference_path));
    d.saveProject(); d.loadProject();
    assert.equal(d.referenceInfo(d.state.drivers[0]).status, 'USER REFERENCE');
    assert.equal(d.rustRequest([1000]).drivers[0].measurement_reference_path[0].length_mm, 4);
    field.value = '-1'; field.onchange();
    await d.calculate();
    assert.equal(d.state.last, null);
    assert.match(d.databaseReferenceError(d.state.drivers[0]), /missing or unsupported/);
    // Restoring the library setup removes only the override.
    const reset = { dataset: { referenceReset: driver.id } };
    d.document.querySelectorAll = selector => selector === '[data-reference-reset]' ? [reset] : [];
    d.bindDriverEvents(); reset.onclick();
    assert.equal(d.referenceInfo(d.state.drivers[0]).status, 'DOCUMENTED TUBE');
    assert.equal(d.rustRequest([1000]).drivers[0].measurement_reference_path[0].length_mm, 1.75);
});

test('an unknown fixture remains blocked until an explicit reference is supplied', async () => {
    const row = structuredClone(rows.find(r => r.model === 'RDI-34006-000'));
    row.model = 'Unknown receiver';
    const { d, driver } = setup(row);
    assert.equal(d.referenceInfo(driver).complete, false);
    await d.calculate(); assert.equal(d.state.last, null);
    const button = { dataset: { referenceDirect: driver.id } };
    d.document.querySelectorAll = selector => selector === '[data-reference-direct]' ? [button] : [];
    d.bindDriverEvents(); button.onclick();
    assert.equal(d.referenceInfo(driver).status, 'USER REFERENCE');
    await d.calculate(); assert.ok(d.state.last);
    const add = { dataset: { referenceAdd: `${driver.id}:damper` } };
    d.document.querySelectorAll = selector => selector === '[data-reference-add]' ? [add] : [];
    d.bindDriverEvents(); add.onclick();
    assert.equal(d.referenceInfo(driver).complete, true, 'An explicit reference may contain a damper without an external tube');
    assert.equal(d.rustRequest([1000]).drivers[0].measurement_reference_path[0].resistance_acoustic_ohm, 6.8e7);
    driver.measurementReferenceLoad = { type: 'cavity_with_leak', volume_mm3: 2000, leak_resistance_acoustic_ohm: 5e8 };
    await d.calculate(); assert.ok(d.state.last, 'Existing valid engine load variants remain supported');
    driver.measurementReferenceLoad = { type: 'closed_cavity', volume_mm3: -1 };
    await d.calculate(); assert.equal(d.state.last, null);
});
