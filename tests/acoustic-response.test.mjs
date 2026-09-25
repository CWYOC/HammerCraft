import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { designer } from './designer-helper.mjs';
import init, * as engine from '../docs/wasm/acoustic_engine.js';
await init({ module_or_path: fs.readFileSync(new URL('../docs/wasm/acoustic_engine_bg.wasm', import.meta.url)) });
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/sonion-2356.json', import.meta.url)));
const simulate = request => JSON.parse(engine.simulate_json(JSON.stringify(request)));

function sonion() {
    const d = designer(), driver = d.driver();
    Object.assign(driver, { name: 'Sonion 2356', databaseDriverId: '2356', responseAbsolute: true,
        impedance: fixture.nominalImpedance, measurement: structuredClone(fixture.response),
        measurementReferenceCompensation: true, measurementReferencePath: structuredClone(fixture.referencePath),
        measurementReferenceLoad: { type: 'generic_711_approx' },
        path: [{ type: 'tube', length: 12, diameter: 2, loss: 0 }] });
    driver.circuit.output = 'in';
    driver.circuit.nodes = driver.circuit.nodes.filter(n => n.id !== 'drv');
    d.state.drivers = [driver];
    d.document.getElementById('iemAcousticLoadType').value = 'generic_711_approx';
    d.context.window.HCAcousticEngine = { simulate: async request => simulate(request), version: async () => 'test WASM' };
    return { d, driver };
}

test('Sonion screenshot artifacts reproduce with ideal pressure and depend on the source assumption', () => {
    const { d, driver } = sonion();
    const frequencies = [817, 1122, 9717, 12634, 15067];
    const estimated = simulate(d.rustRequest(frequencies, true)).combined;
    driver.sourceModel = 'ideal_pressure';
    const ideal = simulate(d.rustRequest(frequencies, true)).combined;
    // Capture the reported failure, not just reference/reference = 1.
    assert.ok(ideal[0].db < 94 && ideal[1].db > 127 && ideal[2].db < 84);
    assert.ok(estimated[0].db > 105 && estimated[0].db < 108);
    assert.ok(estimated[1].db > 106 && estimated[1].db < 109);
    assert.ok(estimated[2].db > 99 && estimated[2].db < 103);
    assert.ok(estimated.slice(3).every(p => p.db < 100));
});

test('source impedance stays fixed when design diameter, length or element order changes', () => {
    const { d, driver } = sonion();
    const source = d.rustRequest([1000]).drivers[0].acoustic_source;
    assert.equal(driver.sourceReferenceDiameterMm, 1.4);
    assert.ok(source.resistance_acoustic_ohm > 2.6e8 && source.resistance_acoustic_ohm < 2.8e8);
    for (const diameter of [0.8, 1.4, 2, 3]) {
        driver.path = [{ type: 'damper', value: 680 }, { type: 'tube', length: 20, diameter }];
        assert.deepEqual(d.rustRequest([1000]).drivers[0].acoustic_source, source);
    }
    driver.sourceModel = 'custom_resistance'; driver.sourceResistanceCgs = 1500;
    assert.equal(d.rustRequest([1000]).drivers[0].acoustic_source.resistance_acoustic_ohm, 1.5e8);
    d.saveProject(); driver.sourceResistanceCgs = 1; d.loadProject();
    assert.equal(d.state.drivers[0].sourceResistanceCgs, 1500);
});

test('matched reference remains unity for both source models and the forward/optimizer pipelines agree', async () => {
    const { d, driver } = sonion();
    driver.path = fixture.referencePath.map(p => ({ type: 'tube', length: p.length_mm, diameter: p.inner_diameter_mm, loss: 0 }));
    driver.referenceValidationMode = true;
    for (const sourceModel of ['estimated_resistance', 'ideal_pressure', 'custom_resistance']) {
        driver.sourceModel = sourceModel;
        await d.calculate();
        assert.equal(d.state.last.validation[0].pass, true);
        const forward = d.state.last.drivers[0];
        const full = simulate(d.rustRequest(forward.map(p => p.frequency), true)).combined;
        for (let i = 0; i < full.length; i++) assert.ok(Math.abs(full[i].db - forward[i].db) < 1e-9);
    }
    driver.path = [{ type: 'tube', length: 12, diameter: 2, loss: 0 }];
    driver.sourceModel = 'estimated_resistance';
    await d.calculate();
    assert.equal(d.state.last.validation[0].pass, false, 'Changing geometry must actually change the response');
    assert.match(d.document.getElementById('iemModelNotes').textContent, /estimated source resistance.*damping side cavities are missing/);
});

test('catalog damper units yield the independently calculated pressure divider attenuation', () => {
    const d = designer(), driver = d.driver();
    driver.circuit.output = 'in'; driver.circuit.nodes = driver.circuit.nodes.filter(n => n.id !== 'drv');
    driver.path = [{ type: 'damper', value: 1000 }]; d.state.drivers = [driver];
    const request = d.rustRequest([1000]);
    assert.equal(request.drivers[0].acoustic_path[0].resistance_acoustic_ohm, 1e8);
    const rho = 1.2929 * 273.15 / 293.15, c = 331.3 + .606 * 20 + .0124 * 50;
    const zl = rho * c / (Math.PI * .001 ** 2);
    const expected = 20 * Math.log10(zl / (zl + 1e8));
    assert.ok(expected < -4 && expected > -6);
    assert.ok(Math.abs(simulate(request).combined[0].db - expected) < 1e-9);
});

test('a tubeless reference de-embeds the source/load divider instead of applying it twice', () => {
    const d = designer(), driver = d.driver();
    driver.circuit.output = 'in'; driver.circuit.nodes = driver.circuit.nodes.filter(n => n.id !== 'drv');
    driver.path = [{ type: 'damper', value: 1000 }];
    driver.sourceModel = 'custom_resistance'; driver.sourceResistanceCgs = 2000;
    driver.measurementReferenceCompensation = true;
    driver.measurementReferencePath = [];
    driver.measurementReferenceLoad = { type: 'anechoic' };
    d.state.drivers = [driver];
    const request = d.rustRequest([1000]);
    const rho = 1.2929 * 273.15 / 293.15, c = 331.3 + .606 * 20 + .0124 * 50;
    const zl = rho * c / (Math.PI * .001 ** 2), zs = 2e8, damper = 1e8;
    const expected = 20 * Math.log10((zl + zs) / (zl + zs + damper));
    assert.ok(Math.abs(simulate(request).combined[0].db - expected) < 1e-9);
    request.drivers[0].measurement_reference_load = null;
    assert.ok(Math.abs(simulate(request).combined[0].db - 20 * Math.log10(zl / (zl + zs + damper))) < 1e-9,
        'An unreferenced response still includes the complete transfer');
});

test('copying a reference damper preserves catalog units and cancellation', async () => {
    const { d, driver } = sonion();
    driver.measurementReferencePath.push({ element_type: 'damper', damper_ohm: 680 });
    d.document.getElementById('iemAcousticLoadType').dispatchEvent = () => {};
    const button = { dataset: { useReferencePath: driver.id } };
    d.document.querySelectorAll = selector => selector === '[data-use-reference-path]' ? [button] : [];
    d.bindDriverEvents(); await button.onclick();
    assert.equal(driver.path.at(-1).value, 680);
    const request = d.rustRequest([1000]);
    assert.equal(request.drivers[0].measurement_reference_path.at(-1).resistance_acoustic_ohm, 6.8e7);
    assert.equal(d.state.last.validation[0].pass, true);
});

test('reverse search converts dampers to SI and returned candidates back exactly once', async () => {
    const { d, driver } = sonion();
    d.state.reverse = [{ frequency: 100, db: 110 }, { frequency: 10000, db: 100 }];
    d.document.getElementById('iemReverseDriver').value = '0';
    d.document.getElementById('iemReverseDampers').value = '680';
    d.document.getElementById('iemReverseCaps').value = '0';
    d.document.getElementById('iemReverseResistors').value = '0';
    d.document.getElementById('iemReverseGainRange').value = '0';
    for (const [name, value] of [['Length', 12], ['Diameter', 2]]) for (const bound of ['Min', 'Max']) d.document.getElementById(`iemReverse${name}${bound}`).value = String(value);
    const button = { dataset: { applyRevPhysical: '0' } };
    d.document.querySelectorAll = selector => selector === '[data-apply-rev-physical]' ? [button] : [];
    let candidate;
    d.context.window.HCAcousticEngine.reverseDesign = async request => {
        assert.deepEqual(Array.from(request.damper_values), [6.8e7]);
        const results = JSON.parse(engine.reverse_design_json(JSON.stringify(request)));
        candidate = results[0];
        return results;
    };
    await d.reverseRun();
    assert.equal(candidate.damper_ohm, 6.8e7);
    assert.match(d.document.getElementById('iemReverseResults').innerHTML, /680 CGS acoustic Ω damper/);
    button.onclick();
    assert.equal(driver.path.find(p => p.type === 'damper').value, 680);
    assert.equal(d.rustRequest([1000]).drivers[0].acoustic_path.find(p => p.type === 'damper').resistance_acoustic_ohm, 6.8e7);
});

test('invalid custom source resistance stops calculation', async () => {
    const { d, driver } = sonion();
    driver.sourceModel = 'custom_resistance'; driver.sourceResistanceCgs = -1;
    await d.calculate();
    assert.equal(d.state.last, null);
    assert.match(d.document.getElementById('iemSimulationMessage').textContent, /source resistance must be greater than zero/);
});

test('splitting a uniform tube preserves its response and total-path metrics', async () => {
    const { d, driver } = sonion();
    await d.calculate();
    const before = d.state.last.combined;
    const metrics = ['iemPrimaryResonance', 'iemTubeDelay', 'iemTubeVolume'].map(id => d.document.getElementById(id).textContent);
    driver.path = [4, 8].map(length => ({ type: 'tube', length, diameter: 2, loss: 0 }));
    await d.calculate();
    assert.deepEqual(['iemPrimaryResonance', 'iemTubeDelay', 'iemTubeVolume'].map(id => d.document.getElementById(id).textContent), metrics);
    d.state.last.combined.forEach((point, i) => assert.ok(Math.abs(point.db - before[i].db) < 1e-9));
});
