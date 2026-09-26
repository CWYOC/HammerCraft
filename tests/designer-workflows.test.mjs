import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { read } from './helpers.mjs';
import { designer } from './designer-helper.mjs';
import init, * as engine from '../docs/wasm/acoustic_engine.js';
await init({ module_or_path: fs.readFileSync(new URL('../docs/wasm/acoustic_engine_bg.wasm', import.meta.url)) });

function connected(d) {
    const driver = d.driver();
    driver.circuit.output = driver.circuit.input;
    driver.path = [];
    d.state.drivers = [driver];
    return driver;
}

test('driver field edits survive adding an acoustic element', () => {
    const d = designer(); const driver = connected(d);
    const name = { dataset: { f: 'name' }, value: 'Edited woofer' };
    const gain = { dataset: { f: 'gain' }, value: '4.5' };
    const card = { dataset: { driverId: driver.id }, querySelectorAll: () => [name, gain] };
    const button = { dataset: { addPath: `${driver.id}:tube` } };
    d.document.querySelectorAll = selector => ({ '.iem-driver-card': [card], '[data-add-path]': [button] }[selector] || []);
    d.bindDriverEvents();
    for (const input of [name, gain]) { input.oninput?.({ target: input }); input.onchange?.({ target: input }); }
    button.onclick();
    assert.equal(driver.name, 'Edited woofer');
    assert.equal(driver.gain, 4.5);
    assert.equal(driver.path.length, 1);
});

test('a driver without measured FR uses its sensitivity in the shipped WASM engine', () => {
    for (const databaseDriverId of [undefined, 'database-without-fr']) {
        const d = designer(); const driver = connected(d);
        Object.assign(driver, { sensitivity: 104, gain: -2, databaseDriverId });
        const result = JSON.parse(engine.simulate_json(JSON.stringify(d.rustRequest([1000]))));
        assert.ok(Math.abs(result.combined[0].db - 102) < 1e-6, `Actual level: ${result.combined[0].db}`);
    }
});

test('JS fallback preserves uploaded phase when summing drivers', () => {
    const d = designer(); const a = connected(d);
    a.measurement = [{ frequency: 1000, db: 90, phase: 0 }]; a.responseAbsolute = true;
    const b = structuredClone(a); b.id = 'second'; b.measurement[0].phase = 180;
    d.state.drivers.push(b);
    assert.ok(d.fallback().combined.every(p => p.db < -100), 'Opposite phases should cancel');
});

test('project save and load restore the output load and simulation/display settings', () => {
    const d = designer(); connected(d);
    const expected = { iemAcousticLoadType: 'closed_cavity', iemCouplerVolume: '1700',
        iemTemperature: '27', iemHumidity: '65', iemLoadLossResistance: '120',
        iemSplMode: 'absolute', iemReverseMatchMode: 'relative', iemReverseLengthMax: '15' };
    for (const [id, value] of Object.entries(expected)) d.document.getElementById(id).value = value;
    d.saveProject();
    for (const id of Object.keys(expected)) d.document.getElementById(id).value = '';
    d.loadProject();
    for (const [id, value] of Object.entries(expected)) assert.equal(String(d.document.getElementById(id).value), value, id);
});

test('applying a reverse candidate removes all dampers when zero resistance was scored', () => {
    const d = designer(); const driver = connected(d);
    driver.path = [{ type: 'tube', length: 10, diameter: 2 }, { type: 'damper', value: 1000 }, { type: 'damper', value: 2200 }];
    d.applyRevPhysical({ tube_length_mm: 10, tube_diameter_mm: 2, damper_ohm: 0, resistor_ohm: 0, capacitor_uf: 0, gain_db: 0 }, 0, false);
    assert.equal(driver.path.filter(p => p.type === 'damper').length, 0);
});

test('reverse candidates preserve legacy low-pass filters that were included in their score', () => {
    const d = designer(); const driver = connected(d);
    driver.circuit.nodes.push({ id: 'lp-out', x: 400, y: 120 });
    driver.circuit.components.push({ id: 'lp', label: 'LP1', nodeA: 'in', nodeB: 'lp-out', kind: 'low_pass', frequency: 2300, q: 0.707 });
    driver.circuit.output = 'lp-out';
    const before = d.rustRequest([1000]).drivers[0].electrical;
    d.applyRevPhysical({ tube_length_mm: 10, tube_diameter_mm: 2, damper_ohm: 0, resistor_ohm: 0, capacitor_uf: 0, gain_db: 0 }, 0, false);
    assert.deepEqual(d.rustRequest([1000]).drivers[0].electrical, before);
});

test('an empty import is rejected instead of deleting the existing response', async () => {
    const d = designer();
    await assert.rejects(d.parseFile({ text: async () => 'Frequency,Magnitude\ninvalid,data' }, 'fr'), /valid|numeric|response/i);
});

const candidate = { score_rmse_db: 1, tube_length_mm: 10, tube_diameter_mm: 2,
    damper_ohm: 0, resistor_ohm: 0, capacitor_uf: 0, gain_db: 0 };

test('a reverse result cannot be applied to a replacement driver occupying the old array index', async () => {
    const d = designer(); connected(d);
    d.state.reverse = [{ frequency: 100, db: 90 }, { frequency: 10000, db: 90 }];
    d.document.getElementById('iemReverseDriver').value = '0';
    const button = { dataset: { applyRevPhysical: '0' } };
    d.document.querySelectorAll = selector => selector === '[data-apply-rev-physical]' ? [button] : [];
    d.context.window.HCAcousticEngine = { reverseDesign: async () => [candidate] };
    await d.reverseRun();
    const replacement = connected(d); replacement.name = 'Replacement';
    const before = JSON.stringify(replacement);
    button.onclick();
    assert.equal(JSON.stringify(replacement), before);
    assert.match(d.document.getElementById('iemReverseMessage').textContent, /changed|again/i);
});

test('invalid physical parameters stop simulation instead of being silently clamped by the engine', async () => {
    const d = designer(); const driver = connected(d); let calls = 0;
    driver.path = [{ type: 'tube', length: 10, diameter: -2, loss: 0 }];
    d.context.window.HCAcousticEngine = { simulate: async () => { calls++; throw Error('should not run'); } };
    await d.calculate();
    assert.equal(calls, 0);
    assert.equal(d.state.last, null);
    assert.match(d.document.getElementById('iemSimulationMessage').textContent, /diameter/i);
});

test('reverse search rejects inverted ranges and negative component values', async () => {
    const d = designer(); connected(d); let calls = 0;
    d.state.reverse = [{ frequency: 100, db: 90 }, { frequency: 10000, db: 90 }];
    d.document.getElementById('iemReverseDriver').value = '0';
    d.document.getElementById('iemReverseLengthMin').value = '20';
    d.document.getElementById('iemReverseLengthMax').value = '3';
    d.document.getElementById('iemReverseCaps').value = '-5';
    d.context.window.HCAcousticEngine = { reverseDesign: async () => { calls++; return []; } };
    await d.reverseRun();
    assert.equal(calls, 0);
    assert.match(d.document.getElementById('iemReverseMessage').textContent, /minimum|maximum|negative|non-negative/i);
});

test('invalid driver imports retain the previous measurement and report the error', async () => {
    const d = designer(); const driver = connected(d);
    driver.measurement = [{ frequency: 1000, db: 90 }];
    await d.importDriverFile(driver, { text: async () => 'invalid,data' }, 'fr');
    assert.equal(driver.measurement[0].db, 90);
    assert.match(d.document.getElementById('iemSimulationMessage').textContent, /No valid response/);
});

test('uploaded FR replaces database-specific compensation and keeps measured phase', async () => {
    const d = designer(); const driver = connected(d);
    Object.assign(driver, { databaseDriverId: 'db', measurementReferenceCompensation: true,
        measurementReferencePath: [{ element_type: 'tube', length_mm: 10, inner_diameter_mm: 2 }],
        measurementReferenceLoad: { type: 'generic_711_approx' } });
    await d.importDriverFile(driver, { text: async () => '100,90,180\n1000,92,90' }, 'fr');
    const request = d.rustRequest([1000]).drivers[0];
    assert.equal(request.response[0].phase_deg, 180);
    assert.equal(request.measurement_reference_path.length, 0);
});

test('a late engine-version lookup cannot overwrite newer circuit diagnostics', async () => {
    const d = designer(); const driver = connected(d);
    let versionDone; let versionStarted;
    const started = new Promise(resolve => { versionStarted = resolve; });
    d.context.window.HCAcousticEngine = {
        simulate: async () => ({ drivers: [{ points: [{ frequency_hz: 1000, db: 0, phase_deg: 0 }] }] }),
        version: () => { versionStarted(); return new Promise(resolve => { versionDone = resolve; }); },
    };
    const pending = d.calculate(); await started;
    driver.circuit.output = 'drv';
    await d.calculate();
    versionDone('old engine'); await pending;
    assert.equal(d.document.getElementById('iemEngineStatus').textContent, 'CHECK CIRCUIT');
});

test('library failures remain visible without deleting saved data or crashing the tab', async () => {
    const d = designer(); d.storage.set('hc_iem_driver_library', '{broken');
    d.context.window.hcSupabase = { from() { throw Error('Database temporarily offline'); } };
    await d.renderLibrary();
    assert.match(d.document.getElementById('iemDriverLibrary').innerHTML, /Database temporarily offline/);
    assert.match(d.document.getElementById('iemLibraryMessage').textContent, /Unable to read saved drivers/);
    assert.equal(d.storage.get('hc_iem_driver_library'), '{broken');
});

test('the WASM loader retries after a temporary initialization failure', async () => {
    let attempts = 0;
    const window = { importEngine: async () => ({
        default: async options => {
            assert.match(options.module_or_path, /acoustic_engine_bg\.wasm\?v=0\.17\.0$/);
            if (++attempts === 1) throw Error('Temporary network failure');
        },
        engine_version: () => 'test engine',
    }) };
    vm.runInNewContext(read('docs/wasm-loader.js').replace('import("./wasm/acoustic_engine.js?v=0.17.0")', 'window.importEngine()'), { window });
    await assert.rejects(window.HCAcousticEngine.load(), /Temporary/);
    assert.equal(await window.HCAcousticEngine.version(), 'test engine');
    assert.equal(attempts, 2);
    assert.equal(window.HCAcousticEngine.isLoaded(), true);
});
