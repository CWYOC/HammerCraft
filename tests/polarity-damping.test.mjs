import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { designer } from './designer-helper.mjs';
import init, * as engine from '../docs/wasm/acoustic_engine.js';
await init({ module_or_path: fs.readFileSync(new URL('../docs/wasm/acoustic_engine_bg.wasm', import.meta.url)) });
const simulate = request => JSON.parse(engine.simulate_json(JSON.stringify(request)));

function setup() {
    const d = designer(), driver = d.driver();
    driver.circuit.nodes = driver.circuit.nodes.filter(n => n.id !== 'drv'); driver.circuit.output = 'in';
    driver.path = []; driver.sensitivity = 90;
    d.state.drivers = [driver];
    d.context.window.HCAcousticEngine = { simulate: async request => simulate(request), version: async () => engine.engine_version() };
    return { d, driver };
}

test('polarity checkbox flips phase without rewiring or changing single-driver SPL, and persists', async () => {
    const { d, driver } = setup();
    const originalCircuit = JSON.stringify(driver.circuit);
    const field = { dataset: { f: 'polarity' }, type: 'checkbox', checked: false };
    const badge = { dataset: {}, textContent: '' };
    const card = { dataset: { driverId: driver.id }, querySelectorAll: () => [field], querySelector: () => badge };
    d.document.querySelectorAll = selector => selector === '.iem-driver-card' ? [card] : [];
    d.bindDriverEvents();
    await d.calculate(); const before = d.state.last.drivers[0];
    field.checked = true; field.onchange();
    assert.equal(d.state.last, null);
    assert.match(badge.textContent, /INVERTED.*180/);
    await d.calculate();
    d.state.last.drivers[0].forEach((p, i) => {
        assert.ok(Math.abs(p.db - before[i].db) < 1e-9);
        assert.ok(Math.abs(Math.cos((p.phase - before[i].phase) * Math.PI / 180) + 1) < 1e-9);
    });
    assert.match(d.state.chart.data.datasets[0].label, /INVERTED 180°/);
    assert.equal(JSON.stringify(driver.circuit), originalCircuit);
    d.saveProject(); d.loadProject(); assert.equal(d.state.drivers[0].polarity, -1);
    field.checked = false; field.onchange(); assert.equal(d.state.drivers[0].polarity, 1);
});

test('inverting one identical driver changes the complex sum from +6 dB to cancellation in WASM and fallback', () => {
    const { d, driver } = setup();
    d.state.drivers.push({ ...structuredClone(driver), id: 'second' });
    assert.ok(Math.abs(simulate(d.rustRequest([1000])).combined[0].db - 96.020599913) < 1e-8);
    d.state.drivers[1].polarity = -1;
    assert.ok(simulate(d.rustRequest([1000])).combined[0].db < -100);
    assert.ok(d.fallback().combined.every(p => p.db < -100));
});

test('series dampers lower a resonant source peak and broaden its measured -3 dB bandwidth', () => {
    const { d, driver } = setup();
    driver.sensitivity = 0;
    Object.assign(driver, { sourceModel: 'resonant', sourceResistanceCgs: 100, sourceResonanceHz: 3000, sourceQ: 50 });
    const frequencies = Array.from({ length: 6001 }, (_, i) => 500 * 24 ** (i / 6000));
    const rho = 1.2929 * 273.15 / 293.15, c = 331.3 + .606 * 20 + .0124 * 50;
    const zl = rho * c / (Math.PI * .001 ** 2), rs = 1e7;
    let previous = { peak: Infinity, q: Infinity };
    for (const damper of [0, 320, 680, 1500, 2200]) {
        driver.path = [{ type: 'damper', value: damper }];
        const response = simulate(d.rustRequest(frequencies)).combined;
        const peak = Math.max(...response.map(p => p.db));
        const band = response.filter(p => p.db >= peak - 10 * Math.log10(2));
        const bandwidth = band.at(-1).frequency_hz - band[0].frequency_hz;
        const q = 3000 / bandwidth;
        const expectedPeak = 20 * Math.log10(zl / (rs + zl + damper * 1e5));
        const expectedQ = rs * 50 / (rs + zl + damper * 1e5);
        assert.ok(Math.abs(peak - expectedPeak) < .001);
        assert.ok(Math.abs(q / expectedQ - 1) < .01, `R=${damper}: measured Q ${q}, expected ${expectedQ}`);
        assert.ok(peak < previous.peak && q < previous.q, 'Peak height and Q decrease together');
        previous = { peak, q };
    }
});

test('resonant source parameters are fixed across reference, design, saved projects and reverse candidates', async () => {
    const { d, driver } = setup();
    Object.assign(driver, { databaseDriverId: 'synthetic', responseAbsolute: true,
        measurement: [{ frequency: 100, db: 90 }, { frequency: 10000, db: 100 }],
        sourceModel: 'resonant', sourceResistanceCgs: 100, sourceResonanceHz: 3000, sourceQ: 50,
        measurementReferenceCompensation: true, measurementReferenceLoad: { type: 'anechoic' },
        measurementReferenceOverride: { path: [], tubeless: true } });
    const source = d.rustRequest([1000]).drivers[0].acoustic_source;
    await d.calculate();
    assert.ok(d.state.last.drivers[0].every(p => Math.abs(p.db - (90 + 5 * Math.log10(p.frequency / 100))) < 1e-8 || p.frequency < 100 || p.frequency > 10000));
    driver.path = [{ type: 'tube', length: 12, diameter: 2, loss: 0 }, { type: 'damper', value: 680 }];
    await d.calculate();
    const forward = d.state.last.drivers[0];
    const full = simulate(d.rustRequest(forward.map(p => p.frequency), true)).combined;
    assert.ok(full.every((p, i) => Math.abs(p.db - forward[i].db) < 1e-8));
    const candidates = JSON.parse(engine.reverse_design_json(JSON.stringify({
        base_request: d.rustRequest([100, 1000, 10000], true),
        target: [{ frequency_hz: 100, db: 90, phase_deg: 0 }, { frequency_hz: 10000, db: 100, phase_deg: 0 }],
        driver_index: 0, min_tube_length_mm: 12, max_tube_length_mm: 12, min_tube_diameter_mm: 2, max_tube_diameter_mm: 2,
        damper_values: [6.8e7], resistor_values_ohm: [0], capacitor_values_uf: [0], gain_range_db: 0, max_evaluations: 1, result_count: 1,
    })));
    assert.ok(Number.isFinite(candidates[0].score_rmse_db));
    d.saveProject(); d.loadProject();
    assert.deepEqual(d.rustRequest([1000]).drivers[0].acoustic_source, source);
    d.applyRevPhysical({ tube_length_mm: 8, tube_diameter_mm: 1, damper_ohm: 1500, resistor_ohm: 0, capacitor_uf: 0, gain_db: 0 }, 0, false);
    assert.deepEqual(d.rustRequest([1000]).drivers[0].acoustic_source, source);
    const request = d.rustRequest([1000, 3000, 6000]);
    const atEnd = simulate(request).combined;
    request.drivers[0].acoustic_path.reverse();
    assert.ok(simulate(request).combined.some((p, i) => Math.abs(p.db - atEnd[i].db) > .1), 'Damper position changes the coupled response');
});

test('invalid resonant parameters and missing WASM cannot produce misleading damping curves', async () => {
    const { d, driver } = setup();
    Object.assign(driver, { sourceModel: 'resonant', sourceQ: -1 });
    await d.calculate(); assert.equal(d.state.last, null);
    assert.match(d.document.getElementById('iemSimulationMessage').textContent, /Q must be greater/);
    driver.sourceQ = 2;
    d.context.window.HCAcousticEngine.simulate = async () => { throw Error('Network failure'); };
    await d.calculate(); assert.equal(d.state.last, null);
    assert.match(d.document.getElementById('iemSimulationMessage').textContent, /fallback cannot predict resonance damping/);
    driver.sourceModel = 'estimated_resistance'; driver.path = [{ type: 'damper', value: 680 }];
    await d.calculate(); assert.equal(d.state.last, null);
    assert.equal(d.document.getElementById('iemEngineStatus').textContent, 'ACOUSTIC ENGINE REQUIRED');
});
