import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { designer } from './designer-helper.mjs';
import init, * as engine from '../docs/wasm/acoustic_engine.js';
await init({ module_or_path: fs.readFileSync(new URL('../docs/wasm/acoustic_engine_bg.wasm', import.meta.url)) });
const simulate = request => JSON.parse(engine.simulate_json(JSON.stringify(request)));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const curve = db => [{ frequency: 100, db }, { frequency: 10000, db }];

function setup() {
    const d = designer(), driver = d.driver();
    driver.circuit.output = 'in'; driver.path = []; driver.responseAbsolute = true;
    driver.measurement = curve(90);
    d.state.drivers = [driver];
    d.context.window.HCAcousticEngine = { simulate: async request => simulate(request), version: async () => engine.engine_version() };
    d.bind();
    return { d, driver };
}

test('wrapped response phase adds coherently across ±180 degrees in WASM and browser fallback', () => {
    const { d, driver } = setup();
    driver.measurement[0].phase = 179; driver.measurement[1].phase = -179;
    d.state.drivers.push({ ...structuredClone(driver), id: 'second', measurement: curve(90).map(p => ({ ...p, phase: 180 })) });
    assert.ok(Math.abs(simulate(d.rustRequest([1000])).combined[0].db - 96.020599913) < 1e-8);
    assert.ok(d.fallback().combined.every(p => p.db > 96));
});

test('explicitly unwrapped response phase retains complete turns', () => {
    const { d, driver } = setup();
    driver.measurement[0].phase = -90; driver.measurement[1].phase = -450;
    d.state.drivers.push({ ...structuredClone(driver), id: 'second', measurement: curve(90).map(p => ({ ...p, phase: 90 })) });
    assert.ok(Math.abs(simulate(d.rustRequest([1000])).combined[0].db - 96.020599913) < 1e-8);
    const closest = d.fallback().combined.reduce((a, b) => Math.abs(a.frequency - 1000) < Math.abs(b.frequency - 1000) ? a : b);
    assert.ok(closest.db > 96);
});

test('wrapped impedance phase is interpolated on the same arc in WASM and the browser solver', () => {
    const { d, driver } = setup();
    driver.circuit.output = 'drv';
    driver.circuit.components = [{ id: 'r', kind: 'resistor', value: 8, nodeA: 'in', nodeB: 'drv' }];
    // Synthetic negative-real load isolates the phase branch-cut arithmetic.
    driver.impedanceCurve = [{ frequency: 100, ohm: 16, phase: 179 }, { frequency: 10000, ohm: 16, phase: -179 }];
    const result = simulate(d.rustRequest([1000])).combined[0];
    assert.ok(Math.abs(result.db - 96.020599913) < 1e-8);
    const browser = d.passiveCircuitH(driver, 1000);
    assert.ok(Math.abs(browser.re - 2) < 1e-8 && Math.abs(browser.im) < 1e-8);
});

test('target requests cannot overwrite a newer selection or a new/loaded project', async () => {
    const { d } = setup();
    const pending = new Map();
    d.context.window.hcSupabase = { from: () => ({ select: () => ({ eq: (_key, id) => ({ order: () => pending.get(id).promise }) }) }) };
    const start = id => { pending.set(id, deferred()); return d.loadTargetProduct(id); };
    const finish = (id, db) => pending.get(id).resolve({ data: curve(db).map(p => ({ frequency_hz: p.frequency, db: p.db })) });
    const first = start('first'), second = start('second');
    finish('second', 80); await second; finish('first', 70); await first;
    assert.equal(d.state.target[0].db, 80);
    const third = start('third'); d.newProject(); finish('third', 60); await third;
    assert.equal(d.state.target.length, 0);
    d.state.target = curve(77); d.saveProject();
    const fourth = start('fourth'); d.loadProject(); finish('fourth', 50); await fourth;
    assert.equal(d.state.target[0].db, 77);
});

test('failed or empty target queries clear the previous curve and report the problem', async () => {
    const { d } = setup();
    for (const outcome of [{ error: { message: 'Offline' } }, { data: [] }, { data: [{ frequency_hz: 0, db: 50 }, { frequency_hz: 100, db: null }] }]) {
        d.state.target = curve(80);
        d.context.window.hcSupabase = { from: () => ({ select: () => ({ eq: () => ({ order: async () => outcome }) }) }) };
        await d.loadTargetProduct('missing');
        assert.equal(d.state.target.length, 0);
        assert.match(d.document.getElementById('iemTargetMessage').textContent, /Unable|No valid/);
    }
});

test('target RMSE refreshes with the target and follows absolute versus relative graph settings', async () => {
    const { d } = setup();
    await d.calculate();
    d.state.target = curve(80);
    d.document.getElementById('iemSplMode').value = 'absolute'; d.draw();
    assert.equal(d.document.getElementById('iemTargetRmse').textContent, '10.00 dB');
    d.document.getElementById('iemSplMode').value = 'relative'; d.draw();
    assert.equal(d.document.getElementById('iemTargetRmse').textContent, '0.00 dB');
    d.state.target = []; d.draw();
    assert.equal(d.document.getElementById('iemTargetRmse').textContent, '—');
});

test('reverse target imports keep the latest file and cannot overwrite edits or project changes', async () => {
    const { d } = setup();
    const upload = d.document.getElementById('iemReverseFile');
    const start = () => { const pending = deferred(); return { pending, done: upload.onchange({ target: { files: [{ text: () => pending.promise }] } }) }; };
    const first = start(), second = start();
    second.pending.resolve('100 80\n10000 80'); await second.done;
    first.pending.resolve('100 70\n10000 70'); await first.done;
    assert.equal(d.state.reverseBase[0].db, 80);
    for (const edit of [() => d.setReverseBase(curve(75)), () => { d.state.targetPeq.push({ type: 'peq', frequency: 1000, gain: 3, q: 1 }); d.rebuildReverseFromBase(true); }, () => d.newProject(), () => { d.saveProject(); d.loadProject(); }]) {
        const late = start(); edit(); const expected = JSON.stringify(d.state.reverseBase);
        late.pending.resolve('100 60\n10000 60'); await late.done;
        assert.equal(JSON.stringify(d.state.reverseBase), expected);
    }
});

test('measurement query failures are visible and cannot become flat or assumed-fixture drivers', async () => {
    for (const failedTable of ['iem_driver_measurements', 'iem_driver_fr', 'iem_driver_impedance', 'iem_driver_measurement_paths']) {
        const { d } = setup();
        d.context.window.hcSupabase = { from(table) {
            const result = table === failedTable ? { error: { message: 'Connection lost' } } : { data:
                table === 'iem_drivers' ? [{ id: 'db-driver', manufacturer: 'Sonion', model: '2356' }] :
                table === 'iem_driver_measurements' ? [{ id: 'measurement', coupler: '711' }] : [] };
            const query = { select() { return this; }, eq() { return this; }, order() { return this; }, then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); } };
            return query;
        } };
        await d.renderLibrary();
        assert.match(d.document.getElementById('iemDriverLibrary').innerHTML, /DATA UNAVAILABLE/);
        assert.throws(() => d.databaseDriverToDesign(d.state.databaseLibrary[0]), /incomplete/i);
    }
});
