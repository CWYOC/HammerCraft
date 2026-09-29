import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { designer } from './designer-helper.mjs';
import init, * as engine from '../docs/wasm/acoustic_engine.js';
await init({ module_or_path: fs.readFileSync(new URL('../docs/wasm/acoustic_engine_bg.wasm', import.meta.url)) });
const rows = JSON.parse(fs.readFileSync(new URL('./fixtures/driver-library.json', import.meta.url)));
const simulate = r => JSON.parse(engine.simulate_json(JSON.stringify(r)));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function setup(row) {
    const d = designer(), driver = d.databaseDriverToDesign(row);
    driver.circuit.output = 'in'; driver.circuit.nodes = driver.circuit.nodes.filter(n => n.id !== 'drv');
    driver.path = Array.from(d.referenceInfo(driver).modelled, p => ({ ...p }));
    driver.referenceValidationMode = true;
    d.state.drivers = [driver];
    d.document.getElementById('iemAcousticLoadType').value = driver.measurementReferenceLoad.type;
    d.document.getElementById('iemCouplerVolume').value = String(driver.measurementReferenceLoad.volume_mm3 || 2000);
    d.context.window.HCAcousticEngine = { simulate: async r => simulate(r), version: async () => engine.engine_version() };
    return { d, driver };
}
for (const row of rows) test(`${row.model}: common voltage scales landmarks once in forward, exported setup and saved project`, async () => {
    const { d, driver } = setup(row), correction = 20 * Math.log10(.1 / row.drive_voltage_v);
    assert.equal(driver.voltageMode, 'common');
    driver.gain = 2;
    const response = simulate(d.rustRequest(row.fr.map(p => p.frequency_hz), true)).combined;
    response.forEach((p, i) => near(p.db, row.fr[i].magnitude_db + correction + 2));
    await d.calculate(); assert.equal(d.state.last.validation[0].pass, true);
    const direct = simulate(d.rustRequest(d.state.last.combined.map(p => p.frequency), true)).combined;
    direct.forEach((p, i) => near(p.db, d.state.last.combined[i].db));
    const exported = d.validationSetup();
    assert.equal(exported.input_voltage_v, .1);
    assert.equal(exported.drivers[0].measurement_voltage_v, row.drive_voltage_v);
    assert.equal(exported.drivers[0].measured_phase, false);
    const original = simulate(d.rustRequest([1000], true)).combined[0].db;
    d.document.getElementById('iemInputVoltage').value = '.2';
    const doubled = simulate(d.rustRequest([1000], true)).combined[0].db;
    d.saveProject(); d.newProject(); d.loadProject();
    assert.equal(d.document.getElementById('iemInputVoltage').value, '.2');
    near(simulate(d.rustRequest([1000], true)).combined[0].db, doubled);
    near(doubled - original, 20 * Math.log10(2));
});

test('doubling recorded baseline voltage subtracts 6.0206 dB; doubling input adds it', () => {
    const { d, driver } = setup({ ...rows[0], drive_voltage_v: .1 });
    const level = () => simulate(d.rustRequest([1000], true)).combined[0].db;
    const initial = level(); driver.measurementVoltageV = .2;
    near(level() - initial, -20 * Math.log10(2));
    d.document.getElementById('iemInputVoltage').value = '.2'; near(level(), initial);
});

test('optimizer gain and voltage calibration remain separate when applying a candidate', () => {
    const { d, driver } = setup(rows.find(r => r.model === '17A003'));
    driver.path = [{ type: 'tube', length: 12, diameter: 2, loss: 0 }];
    driver.gain = 0;
    const target = simulate(d.rustRequest([100, 1000, 5000], true)).combined;
    const candidates = JSON.parse(engine.reverse_design_json(JSON.stringify({
        base_request: d.rustRequest([100, 1000, 5000], true), target, driver_index: 0,
        min_tube_length_mm: 12, max_tube_length_mm: 12, min_tube_diameter_mm: 2, max_tube_diameter_mm: 2,
        damper_values: [0], capacitor_values_uf: [0], resistor_values_ohm: [0], gain_range_db: 0,
        result_count: 1, max_evaluations: 1,
    })));
    near(candidates[0].score_rmse_db, 0);
    d.applyRevPhysical(candidates[0], 0, false);
    simulate(d.rustRequest([100, 1000, 5000], true)).combined.forEach((p, i) => near(p.db, target[i].db));
    assert.equal(driver.measurementVoltageV, .07);
});

test('legacy gain is preserved and unknown/invalid voltages cannot claim common calibration', async () => {
    const { d, driver } = setup(rows[0]);
    delete driver.voltageMode; delete driver.measurementVoltageV; driver.gain = 3.1;
    d.ensureDriverShape(driver);
    assert.equal(driver.voltageMode, 'reference'); assert.equal(driver.gain, 3.1);
    driver.voltageMode = 'common';
    for (const v of [null, '', 0, -1, NaN]) {
        driver.measurementVoltageV = v;
        await d.calculate(); assert.equal(d.state.last, null);
        assert.throws(() => d.validationSetup(), /measurement voltage/);
    }
    driver.measurementVoltageV = .1; d.document.getElementById('iemInputVoltage').value = '0';
    await d.calculate(); assert.equal(d.state.last, null);
});

test('database phase is retained in forward and full requests; FR import resets voltage metadata', async () => {
    const row = structuredClone(rows[0]); row.fr.forEach(p => { p.phase_deg = 60; });
    const { d, driver } = setup(row);
    await d.calculate();
    d.state.last.drivers[0].forEach(p => near(p.phase, 60));
    simulate(d.rustRequest([1000], true)).combined.forEach(p => near(p.phase_deg, 60));
    assert.equal(d.validationSetup().drivers[0].measured_phase, true);
    await d.importDriverFile(driver, { text: async () => '100,90\n1000,92' }, 'fr');
    assert.equal(driver.voltageMode, 'reference'); assert.equal(driver.measurementVoltageV, null);
    assert.equal(driver.measurement[0].phase, null);
});

test('relative uploaded FR and sensitivity are voltage-scaled without changing their shape', () => {
    const d = designer(), driver = d.driver();
    Object.assign(driver, { measurement: [{ frequency: 100, db: 4, phase: 0 }, { frequency: 1000, db: 0, phase: 0 }],
        sensitivity: 100, responseAbsolute: false, voltageMode: 'common', measurementVoltageV: .2, path: [] });
    driver.circuit.output = 'in'; d.state.drivers = [driver];
    const result = simulate(d.rustRequest([100, 1000], true)).combined;
    near(result[0].db, 104 - 20 * Math.log10(2)); near(result[1].db, 100 - 20 * Math.log10(2));
});

test('live library loading retains measurement voltage before conversion', async () => {
    const d = designer();
    d.context.window.hcSupabase = { from(table) {
        const data = table === 'iem_drivers' ? [{ id: 'db', manufacturer: 'Sonion', model: '17A003' }]
            : table === 'iem_driver_measurements' ? [{ id: 'measurement', is_default: true, coupler: '711', drive_voltage_v: .07 }]
            : table === 'iem_driver_fr' ? [{ frequency_hz: 100, magnitude_db: 100 }, { frequency_hz: 1000, magnitude_db: 100 }] : [];
        return { select() { return this; }, eq() { return this; }, order() { return this; },
            then(resolve, reject) { return Promise.resolve({ data }).then(resolve, reject); } };
    } };
    await d.renderLibrary();
    assert.equal(d.state.databaseLibrary[0].drive_voltage_v, .07);
    assert.equal(d.databaseDriverToDesign(d.state.databaseLibrary[0]).measurementVoltageV, .07);
});

test('legacy placeholder zero phase is never exported as known measured phase', () => {
    const { d, driver } = setup(rows[0]);
    driver.measurement.forEach(p => { p.phase = 0; });
    driver.impedanceCurve.forEach(p => { p.phase = 0; });
    delete driver.baselinePhaseMeasured; delete driver.impedancePhaseMeasured;
    const evidence = d.validationSetup().drivers[0];
    assert.equal(evidence.measured_phase, false); assert.equal(evidence.measured_impedance_phase, false);
});
