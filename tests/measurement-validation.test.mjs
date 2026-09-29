// Synthetic fixtures test the comparator. These are never lab evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { designer } from './designer-helper.mjs';
import init, * as engine from '../docs/wasm/acoustic_engine.js';
import { hash, grid, interpolate, scoreCase, scoreDamping, defaultCriteria } from './diagnostics/measurement-validation.mjs';
function fixture() {
    const frequencies = grid(100, 8000);
    const points = frequencies.map(frequency_hz => ({ frequency_hz, db: 90, phase_deg: 179 }));
    const tube = { type: 'tube', length_mm: 12, diameter_mm: 2, loss_factor: 0 };
    const setup = { schema_version: 1, input_voltage_v: .1,
        request: { drivers: [{ id: 'test', acoustic_path: [tube] }] },
        drivers: [{ id: 'test', name: 'Synthetic test fixture', voltage_mode: 'common', measurement_voltage_v: .1,
            baseline_band_hz: [100, 8000], measured_phase: true, measured_impedance_phase: true }] };
    const item = { id: 'test', driver: 'Synthetic test fixture', role: 'validation', band_hz: [100, 8000] };
    const measurement = { schema_version: 1, kind: 'physical_measurement', setup_sha256: hash(setup), setup_confirmed: true,
        specimen_id: 'TEST ONLY', mount_id: 'TEST ONLY', pair_id: 'TEST ONLY', coupler_model: 'TEST ONLY', calibration_id: 'TEST ONLY',
        acquired_at: '2026-09-29', input_voltage_v: .1, expanded_uncertainty_db: .2, phase_reference: 'TEST ONLY', points };
    const simulate = request => ({ combined: request.frequencies_hz.map(frequency_hz => ({ frequency_hz, db: 90, phase_deg: -179 })) });
    return { setup, item, measurement, simulate };
}
test('comparison uses absolute level and wrapped phase errors, with no per-curve fitting', () => {
    const { setup, item, measurement, simulate } = fixture();
    const match = scoreCase(item, setup, measurement, simulate);
    assert.equal(match.status, 'PASS'); assert.equal(match.metrics.spl.rms, 0); assert.equal(match.metrics.phase.rms, 2);
    measurement.points.forEach(p => { p.db += 3; });
    const shifted = scoreCase(item, setup, measurement, simulate);
    assert.equal(shifted.status, 'FAIL'); assert.equal(shifted.metrics.spl.rms, 3); assert.equal(shifted.metrics.spl.bias, -3);
});
test('missing, synthetic, fitting and uncalibrated data cannot earn a physical pass', () => {
    const f = fixture(); assert.equal(scoreCase(f.item, f.setup, null, f.simulate).status, 'AWAITING_MEASUREMENT');
    for (const mutation of [x => { x.measurement.kind = 'synthetic'; }, x => { x.item.role = 'fit'; },
        x => { x.measurement.calibration_id = ''; }, x => { x.measurement.setup_sha256 = 'wrong'; },
        x => { x.measurement.input_voltage_v = .2; }, x => { x.measurement.expanded_uncertainty_db = 2; },
        x => { x.setup.drivers[0].measured_phase = false; }, x => { x.setup.drivers[0].voltage_mode = 'reference'; },
        x => { x.setup.drivers[0].baseline_band_hz = [1000, 8000]; }, x => { x.measurement.points.forEach(p => { p.phase_deg = null; }); },
        x => { x.measurement.phase_reference = true; }]) {
        const x = fixture(); mutation(x);
        assert.equal(scoreCase(x.item, x.setup, x.measurement, x.simulate).status, 'INCOMPLETE');
    }
});
test('comparison rejects extrapolation, duplicate/invalid frequencies, sparse points and nonfinite predictions', () => {
    let f = fixture(); f.measurement.points.shift();
    assert.throws(() => scoreCase(f.item, f.setup, f.measurement, f.simulate), /complete requested band/);
    f = fixture(); f.measurement.points[1].frequency_hz = 100;
    assert.throws(() => scoreCase(f.item, f.setup, f.measurement, f.simulate), /strictly increasing/);
    f = fixture(); f.measurement.points[1].db = NaN;
    assert.throws(() => scoreCase(f.item, f.setup, f.measurement, f.simulate), /finite SPL/);
    f = fixture(); f.measurement.points = [f.measurement.points[0], f.measurement.points.at(-1)];
    assert.equal(scoreCase(f.item, f.setup, f.measurement, f.simulate).status, 'INCOMPLETE');
    f = fixture();
    assert.throws(() => scoreCase(f.item, f.setup, f.measurement, () => ({ combined: [] })), /invalid or mismatched/);
    assert.throws(() => interpolate(f.measurement.points, 99), /Extrapolation/);
});
test('damping comparison detects incorrect attenuation and refuses mismatched bores', () => {
    const a = fixture(), b = fixture();
    a.setup.request.drivers[0].acoustic_path = [{ type: 'tube', length_mm: 6, diameter_mm: 2, loss_factor: 0 },
        { type: 'damper', resistance_acoustic_ohm: 1500e5 }, { type: 'tube', length_mm: 6, diameter_mm: 2, loss_factor: 0 }];
    a.measurement.setup_sha256 = hash(a.setup);
    a.measurement.points.forEach(p => { p.db -= 3; });
    const damped = scoreCase(a.item, a.setup, a.measurement, a.simulate);
    const undamped = scoreCase(b.item, b.setup, b.measurement, b.simulate);
    scoreDamping(damped, undamped, [a.setup, b.setup], [a.measurement, b.measurement], defaultCriteria.damping_rmse_db);
    assert.equal(damped.metrics.damping.rms, 3); assert.ok(damped.failures.includes('Damping-change RMS error'));
    a.setup.request.drivers[0].acoustic_path[0].diameter_mm = 1;
    const mismatch = scoreCase(a.item, a.setup, a.measurement, a.simulate);
    scoreDamping(mismatch, undamped, [a.setup, b.setup], [a.measurement, b.measurement], 1);
    assert.equal(mismatch.metrics.damping, undefined);
    assert.ok(mismatch.blockers.some(s => s.includes('differs in geometry')));
});
test('wrapped interpolation follows the short arc and never substitutes zero for missing phase', () => {
    const points = [{ frequency_hz: 100, db: 90, phase_deg: 179 }, { frequency_hz: 1000, db: 90, phase_deg: -179 }];
    assert.equal(interpolate(points, Math.sqrt(100 * 1000), 'phase_deg'), 180);
    points[1].phase_deg = null; assert.equal(interpolate(points, 500, 'phase_deg'), null);
});

test('CLI writes an incomplete report for synthetic round-trip evidence and exit 2 for missing data', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iem-comparator-test-'));
    try {
        await init({ module_or_path: fs.readFileSync(new URL('../docs/wasm/acoustic_engine_bg.wasm', import.meta.url)) });
        const rows = JSON.parse(fs.readFileSync(new URL('./fixtures/driver-library.json', import.meta.url)));
        const d = designer(), driver = d.databaseDriverToDesign(rows[0]);
        driver.circuit.output = 'in'; driver.circuit.nodes = driver.circuit.nodes.filter(n => n.id !== 'drv');
        d.state.drivers = [driver];
        const setup = d.validationSetup(), item = { id: 'synthetic-test', driver: driver.name, role: 'validation', band_hz: [100, 8000], setup_file: 'setup.json', measurement_file: 'measurement.json' };
        const write = (file, value) => fs.writeFileSync(path.join(tmp, file), JSON.stringify(value));
        write('setup.json', setup); write('manifest.json', { schema_version: 1, cases: [item] });
        const run = () => spawnSync(process.execPath, [new URL('./diagnostics/validate-iem-measurements.mjs', import.meta.url).pathname,
            path.join(tmp, 'manifest.json'), path.join(tmp, 'results')], { encoding: 'utf8' });
        assert.equal(run().status, 2);
        const request = structuredClone(setup.request); request.frequencies_hz = grid(100, 8000);
        const points = JSON.parse(engine.simulate_json(JSON.stringify(request))).combined;
        write('measurement.json', { ...fixture().measurement, kind: 'synthetic', setup_sha256: hash(setup), points });
        const result = run(); assert.equal(result.status, 2, result.stderr);
        const report = JSON.parse(fs.readFileSync(path.join(tmp, 'results', 'results.json')));
        assert.equal(report.status, 'INCOMPLETE'); assert.ok(report.results[0].metrics.spl.rms < 1e-8);
        assert.ok(report.results[0].blockers.some(s => s.includes('not declared physical')));
        assert.match(fs.readFileSync(path.join(tmp, 'results', 'report.md'), 'utf8'), /INCOMPLETE/);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
