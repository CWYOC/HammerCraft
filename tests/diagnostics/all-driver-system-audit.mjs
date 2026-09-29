// Reproducible numerical audit of every supplied library driver.
// node tests/diagnostics/all-driver-system-audit.mjs library.json result.json
// Optional: HC_AUDIT_WASM=/path/to/deployed.wasm
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { designer } from '../designer-helper.mjs';
import init, * as engine from '../../docs/wasm/acoustic_engine.js';

const rows = JSON.parse(fs.readFileSync(process.argv[2] || new URL('../fixtures/driver-library.json', import.meta.url)));
const binary = fs.readFileSync(process.env.HC_AUDIT_WASM || new URL('../../docs/wasm/acoustic_engine_bg.wasm', import.meta.url));
await init({ module_or_path: binary });
let simulationCount = 0, responsePointCount = 0;
const simulate = request => {
    const result = JSON.parse(engine.simulate_json(JSON.stringify(request)));
    simulationCount++;
    responsePointCount += result.drivers.reduce((n, d) => n + d.points.length, 0);
    return result;
};
const grid = Array.from({ length: 240 }, (_, i) => 20 * 1000 ** (i / 239));
const max = values => Math.max(...values);
const error = (a, b) => max(a.map((p, i) => Math.abs(p.db - b[i].db)));
const phaseError = (a, b, expected = 0) => max(a.map((p, i) => Math.abs(Math.atan2(
    Math.sin((p.phase_deg - b[i].phase_deg - expected) * Math.PI / 180),
    Math.cos((p.phase_deg - b[i].phase_deg - expected) * Math.PI / 180)))));
const finite = points => assert.ok(points.length && points.every(p => Number.isFinite(p.db) && Number.isFinite(p.phase_deg)), 'Finite SPL and phase required');
const tube = (length = 12, diameter = 2) => ({ type: 'tube', length, diameter, loss: 0 });
function setup(row) {
    const d = designer(), driver = d.databaseDriverToDesign(row);
    driver.id = `${row.manufacturer}-${row.model}`;
    driver.circuit.nodes = driver.circuit.nodes.filter(n => n.id !== 'drv');
    driver.circuit.output = 'in';
    d.state.drivers = [driver];
    d.document.getElementById('iemAcousticLoadType').value = driver.measurementReferenceLoad?.type || 'anechoic';
    if (driver.measurementReferenceLoad?.volume_mm3) d.document.getElementById('iemCouplerVolume').value = String(driver.measurementReferenceLoad.volume_mm3);
    d.document.getElementById('iemSplMode').value = 'absolute';
    d.context.window.HCAcousticEngine = { simulate: async r => simulate(r), version: async () => engine.engine_version() };
    return { d, driver };
}
function interp(points, f, key) {
    if (f <= points[0].frequency_hz) return points[0][key];
    if (f >= points.at(-1).frequency_hz) return points.at(-1)[key];
    const i = points.findIndex(p => p.frequency_hz >= f), a = points[i - 1], b = points[i];
    return a[key] + (b[key] - a[key]) * Math.log(f / a.frequency_hz) / Math.log(b.frequency_hz / a.frequency_hz);
}
const report = {
    generated_at: new Date().toISOString(), engine: engine.engine_version(), wasm_sha256: crypto.createHash('sha256').update(binary).digest('hex'),
    library_driver_count: rows.length, frequency_grid: { min_hz: 20, max_hz: 20000, points: grid.length, spacing: 'logarithmic' },
    interpretation: 'PASS means software invariants passed. Finite sweep output and reference unity do not establish physical measurement accuracy.',
    drivers: [],
};
for (const row of rows) {
    const started = performance.now(), checks = [], { d, driver } = setup(row), reference = d.referenceInfo(driver);
    const item = {
        name: `${row.manufacturer} ${row.model}`, model: row.model, nominal_impedance_ohm: row.nominal_impedance_ohm,
        fr_points: row.fr.length, fr_range_hz: [row.fr[0]?.frequency_hz, row.fr.at(-1)?.frequency_hz],
        impedance_points: row.impedance_curve.length, impedance_range_hz: [row.impedance_curve[0]?.frequency_hz, row.impedance_curve.at(-1)?.frequency_hz],
        measured_fr_phase_points: row.fr.filter(p => Number.isFinite(p.phase_deg)).length,
        measured_impedance_phase_points: row.impedance_curve.filter(p => Number.isFinite(p.phase_deg)).length,
        reference_status: reference.status, reference_note: reference.note, reference_path: reference.modelled,
        coupler: row.coupler, source_resistance_cgs_ohm: driver.sourceResistanceCgs,
        measurement_drive_voltage_v: row.drive_voltage_v ?? null,
        gain_correction_to_0_1v_db: row.drive_voltage_v > 0 ? 20 * Math.log10(.1 / row.drive_voltage_v) : null,
        checks, metrics: {}, sweep: {},
    };
    async function check(name, fn) {
        try { const detail = await fn(); checks.push({ name, status: 'PASS', ...(detail === undefined ? {} : { detail }) }); }
        catch (e) { checks.push({ name, status: 'FAIL', detail: e?.message || String(e) }); }
    }
    const base = () => d.rustRequest(grid, true);
    await check('Library inputs and reference are usable', () => {
        assert.equal(d.databaseReferenceError(driver), '');
        assert.ok(row.fr.length > 1 && row.fr.every(p => p.frequency_hz > 0 && Number.isFinite(p.magnitude_db)));
        assert.ok(row.fr.every((p, i) => !i || p.frequency_hz > row.fr[i - 1].frequency_hz), 'FR frequencies strictly increasing');
        assert.ok(row.impedance_curve.every(p => p.frequency_hz > 0 && p.impedance_ohm > 0 && Number.isFinite(p.impedance_ohm)));
        assert.ok(row.impedance_curve.every((p, i) => !i || p.frequency_hz > row.impedance_curve[i - 1].frequency_hz), 'Impedance frequencies strictly increasing');
    });
    driver.path = reference.modelled.map(p => ({ ...p }));
    await check('Reference unity and baseline reproduction', () => {
        const unity = simulate(d.rustRequest(grid)).combined;
        item.metrics.reference_max_error_db = max(unity.map(p => Math.abs(p.db)));
        assert.ok(item.metrics.reference_max_error_db < 1e-8);
        const frequencies = row.fr.map(p => p.frequency_hz);
        const result = simulate(d.rustRequest(frequencies, true)).combined;
        const correction = driver.voltageMode === 'common' ? 20 * Math.log10(.1 / row.drive_voltage_v) : 0;
        assert.ok(max(result.map((p, i) => Math.abs(p.db - row.fr[i].magnitude_db - correction))) < 1e-8, 'Measured landmarks preserved at common voltage');
    });
    driver.path = [tube()];
    const baseRequest = base(), normal = simulate(baseRequest).combined;
    item.metrics.standard_12x2_spl_1khz = simulate(d.rustRequest([1000], true)).combined[0].db;
    await check('Tube, damper and placement sweep: finite output and fixed source', () => {
        let count = 0, minimum = Infinity, maximum = -Infinity;
        const source = JSON.stringify(baseRequest.drivers[0].acoustic_source);
        for (const length of [3, 6, 12, 20, 30]) for (const diameter of [.8, 1, 1.5, 2, 3]) {
            for (const resistance of [0, 320, 680, 1000, 1500, 2200, 4700]) for (const fraction of resistance ? [0, .5, 1] : [0]) {
                driver.path = [];
                if (fraction > 0) driver.path.push(tube(length * fraction, diameter));
                if (resistance) driver.path.push({ type: 'damper', value: resistance });
                if (fraction < 1) driver.path.push(tube(length * (1 - fraction), diameter));
                const request = base();
                assert.equal(JSON.stringify(request.drivers[0].acoustic_source), source);
                const result = simulate(request).combined; finite(result);
                minimum = Math.min(minimum, ...result.map(p => p.db)); maximum = Math.max(maximum, ...result.map(p => p.db)); count++;
            }
        }
        item.sweep = { cases: count, evaluated_frequencies: count * grid.length, min_spl_db: minimum, max_spl_db: maximum,
            tube_lengths_mm: [3, 6, 12, 20, 30], tube_diameters_mm: [.8, 1, 1.5, 2, 3], damper_cgs_ohm: [0, 320, 680, 1000, 1500, 2200, 4700], damper_fraction_along_tube: [0, .5, 1] };
        return `${count} cases; numerical stability only`;
    });
    driver.path = [tube()];
    await check('Zero damper and split tube invariance', () => {
        driver.path = [tube(6), { type: 'damper', value: 0 }, tube(6)];
        assert.ok(error(normal, simulate(base()).combined) < 1e-8);
    });
    driver.path = [tube()];
    await check('Five output loads and four source models', () => {
        for (const load of [{ type: 'anechoic' }, { type: 'generic711_approx' }, { type: 'radiation' },
            { type: 'closed_cavity', volume_mm3: 2000, loss_resistance_acoustic_ohm: 0 },
            { type: 'cavity_with_leak', volume_mm3: 2000, leak_resistance_acoustic_ohm: 5e8 }]) {
            const request = base(); request.acoustic_load = load; finite(simulate(request).combined);
        }
        for (const source of ['estimated_resistance', 'ideal_pressure', 'custom_resistance', 'resonant']) {
            driver.sourceModel = source; finite(simulate(base()).combined);
        }
        driver.sourceModel = 'estimated_resistance';
    });
    driver.sourceModel = 'estimated_resistance';
    await check('Chamber and nozzle output remains finite', () => {
        driver.path = [tube(5, 1.5), { type: 'chamber', length: 3, diameter: 4 }, { type: 'nozzle', length: 4, diameter: 2 }];
        finite(simulate(base()).combined);
    });
    driver.path = [tube()];
    await check('Series R, C and L agree with independent voltage divider', () => {
        let worst = 0;
        // The current live library has no impedance phase. Use its real-valued
        // log-interpolated Z; fail explicitly if this assumption stops holding.
        assert.ok(row.impedance_curve.every(p => !p.phase_deg), 'Update independent oracle for measured complex impedance');
        for (const [kind, value] of [['resistor', 1], ['resistor', 10], ['resistor', 100], ['capacitor', .1], ['capacitor', 1], ['inductor', .1]]) {
            const request = base();
            const element = kind === 'resistor' ? { type: kind, resistance_ohm: value } : kind === 'capacitor' ? { type: kind, capacitance_uf: value } : { type: kind, inductance_mh: value };
            request.drivers[0].circuit_netlist = { input_node: 'in', output_node: 'out', ground_node: 'gnd', nodes: ['in','out','gnd'].map(id => ({ id, label: id })),
                components: [{ id: 'series', label: 'series', node_a: 'in', node_b: 'out', kind: element, bypassed: false }] };
            const response = simulate(request).combined;
            response.forEach((p, i) => {
                const z = row.impedance_curve.length ? interp(row.impedance_curve, grid[i], 'impedance_ohm') : row.nominal_impedance_ohm;
                const real = kind === 'resistor' ? value : 0;
                const imaginary = kind === 'capacitor' ? -1 / (2 * Math.PI * grid[i] * value * 1e-6) : kind === 'inductor' ? 2 * Math.PI * grid[i] * value * .001 : 0;
                const expectedDb = 20 * Math.log10(z / Math.hypot(z + real, imaginary));
                worst = Math.max(worst, Math.abs(p.db - normal[i].db - expectedDb));
            });
        }
        item.metrics.electrical_divider_max_error_db = worst; assert.ok(worst < 1e-8, `Divider error ${worst}`);
    });
    await check('Gain is exactly +6 dB', () => {
        driver.gain = 6; assert.ok(max(simulate(base()).combined.map((p, i) => Math.abs(p.db - normal[i].db - 6))) < 1e-8); driver.gain = 0;
    });
    driver.gain = 0;
    await check('Polarity changes phase by 180 degrees without changing magnitude', () => {
        driver.polarity = -1; const inverted = simulate(base()).combined;
        assert.ok(error(normal, inverted) < 1e-8); assert.ok(phaseError(inverted, normal, 180) < 1e-8); driver.polarity = 1;
    });
    driver.polarity = 1;
    await check('Identical drivers add +6.0206 dB and opposite polarity cancels', () => {
        const request = base(); request.drivers.push({ ...structuredClone(request.drivers[0]), id: 'copy' });
        const added = simulate(request).combined;
        assert.ok(max(added.map((p, i) => Math.abs(p.db - normal[i].db - 20 * Math.log10(2)))) < 1e-8);
        request.drivers[1].polarity_inverted = true;
        const cancelled = simulate(request).combined;
        item.metrics.cancellation_max_relative_db = max(cancelled.map((p, i) => p.db - normal[i].db));
        assert.ok(item.metrics.cancellation_max_relative_db < -200);
    });
    driver.path = [tube(6), { type: 'damper', value: 1500 }, tube(6)];
    item.curves = grid.map((f, i) => ({ frequency_hz: f, datasheet_db: interp(row.fr, f, 'magnitude_db'), undamped_db: normal[i].db }));
    simulate(base()).combined.forEach((p, i) => { item.curves[i].damped_1500_midpoint_db = p.db; });
    await check('Frontend baseline, combined sum and undamped comparison', async () => {
        await d.calculate(); assert.ok(d.state.last, d.document.getElementById('iemSimulationMessage').textContent);
        const points = d.state.last.drivers[0], f = points.map(p => p.frequency), request = d.rustRequest(f, true);
        const actual = simulate(request).combined;
        item.metrics.frontend_engine_max_error_db = error(actual, points);
        assert.ok(item.metrics.frontend_engine_max_error_db < 1e-8);
        assert.ok(error(actual, d.state.last.combined) < 1e-8);
        request.drivers[0].acoustic_path = request.drivers[0].acoustic_path.filter(p => p.type !== 'damper');
        assert.ok(error(simulate(request).combined, d.state.last.undampedDrivers[0]) < 1e-8);
    });
    await check('Relative display retains damping difference', () => {
        d.document.getElementById('iemSplMode').value = 'relative'; d.draw();
        const traces = d.state.chart.data.datasets, actual = traces.find(p => p.label === driver.name), undamped = traces.find(p => /Undamped, same geometry/.test(p.label));
        assert.ok(actual && undamped);
        assert.ok(max(actual.data.map((p, i) => Math.abs(undamped.data[i].y - p.y - (d.state.last.undampedDrivers[0][i].db - d.state.last.drivers[0][i].db)))) < 1e-8);
        d.document.getElementById('iemSplMode').value = 'absolute';
    });
    await check('Save/Load preserves numerical request, polarity and comparison visibility', async () => {
        driver.polarity = -1; driver.gain = 3; d.document.getElementById('iemShowUndamped').checked = false;
        const before = JSON.stringify(base()); d.saveProject(); d.newProject(); d.loadProject();
        assert.equal(JSON.stringify(base()), before);
        assert.equal(d.document.getElementById('iemShowUndamped').checked, false);
        await d.calculate(); assert.ok(d.state.last);
    });
    // Start with a fresh instance after project load, which replaces driver objects.
    const reverse = setup(row);
    await check('Reverse design recovers a known constrained design and applies it consistently', async () => {
        const candidate = { tube_length_mm: 12, tube_diameter_mm: 2, damper_ohm: 680, resistor_ohm: 10, capacitor_uf: 1, gain_db: 0 };
        reverse.d.applyRevPhysical(candidate, 0, false);
        const baseRequest = reverse.d.rustRequest(grid, true), target = simulate(baseRequest).combined;
        const request = { base_request: baseRequest, target, driver_index: 0, min_tube_length_mm: 12, max_tube_length_mm: 12,
            min_tube_diameter_mm: 2, max_tube_diameter_mm: 2, damper_values: [6.8e7], resistor_values_ohm: [10], capacitor_values_uf: [1],
            gain_range_db: 0, max_evaluations: 200, result_count: 1, absolute_match: true, allow_peq: false };
        const result = JSON.parse(engine.reverse_design_json(JSON.stringify(request)))[0];
        assert.ok(result && Number.isFinite(result.score_rmse_db));
        item.metrics.reverse_known_target_rmse_db = result.score_rmse_db;
        assert.ok(result.score_rmse_db < 1e-8);
        reverse.d.applyRevPhysical({ ...result, damper_ohm: result.damper_ohm / 1e5 }, 0, false);
        assert.ok(error(target, simulate(reverse.d.rustRequest(grid, true)).combined) < 1e-8);
    });
    await check('Reverse search returns bounded candidates with independently reproducible scores', () => {
        const baseRequest = reverse.d.rustRequest(grid, true), target = simulate(baseRequest).combined;
        const request = { base_request: baseRequest, target, driver_index: 0, min_tube_length_mm: 6, max_tube_length_mm: 18,
            min_tube_diameter_mm: 1, max_tube_diameter_mm: 3, damper_values: [0, 6.8e7, 1.5e8], resistor_values_ohm: [0,10], capacitor_values_uf: [0,1],
            gain_range_db: 3, max_evaluations: 400, result_count: 3, absolute_match: true, allow_peq: false };
        const candidates = JSON.parse(engine.reverse_design_json(JSON.stringify(request)));
        assert.ok(candidates.length > 0);
        for (const c of candidates) {
            assert.ok(c.tube_length_mm >= 6 && c.tube_length_mm <= 18 && c.tube_diameter_mm >= 1 && c.tube_diameter_mm <= 3);
            assert.ok(Math.abs(c.gain_db) <= 3 && request.damper_values.includes(c.damper_ohm));
            reverse.d.applyRevPhysical({ ...c, damper_ohm: c.damper_ohm / 1e5 }, 0, false);
            const response = simulate(reverse.d.rustRequest(grid, true)).combined;
            const rms = Math.sqrt(response.reduce((s,p,i) => s + (p.db - target[i].db) ** 2, 0) / response.length);
            assert.ok(Math.abs(rms - c.score_rmse_db) < 1e-8);
        }
        item.metrics.reverse_bounded_best_rmse_db = candidates[0].score_rmse_db;
        return `${candidates.length} candidates; this verifies scoring, not a global optimum`;
    });
    await check('Invalid tube and disconnected circuit stop calculation', async () => {
        const broken = setup(row); broken.driver.path = [tube(-1)]; await broken.d.calculate(); assert.equal(broken.d.state.last, null);
        broken.driver.path = [tube()]; broken.driver.circuit = broken.d.driver().circuit;
        await broken.d.calculate(); assert.equal(broken.d.state.last, null);
    });
    await check('Unavailable WASM cannot silently substitute damper fallback', async () => {
        const broken = setup(row); broken.driver.path = [tube(), { type: 'damper', value: 1500 }];
        broken.d.context.window.HCAcousticEngine.simulate = async () => { throw Error('Intentional audit failure'); };
        await broken.d.calculate(); assert.equal(broken.d.state.last, null);
        assert.equal(broken.d.document.getElementById('iemEngineStatus').textContent, 'ACOUSTIC ENGINE REQUIRED');
    });
    item.elapsed_ms = performance.now() - started;
    item.passed = checks.filter(c => c.status === 'PASS').length; item.failed = checks.length - item.passed;
    report.drivers.push(item);
    console.log(`${item.name}: ${item.passed}/${checks.length} checks; ${item.sweep.cases || 0} sweep cases; ${item.failed ? 'FAIL' : 'PASS'}`);
    checks.filter(c => c.status === 'FAIL').forEach(c => console.log(`  ${c.name}: ${c.detail}`));
}
// Independent pressure sum across the full, heterogeneous library. This checks
// arithmetic, while the voltage/phase limitations below still prevent calibration.
const mixed = designer();
mixed.document.getElementById('iemAcousticLoadType').value = 'generic_711_approx';
mixed.state.drivers = rows.map((row, index) => {
    const { driver } = setup(row); driver.path = [tube(6 + index, 1.5 + .1 * index)];
    driver.gain = index % 3 - 1; driver.polarity = index % 2 ? -1 : 1;
    return driver;
});
mixed.context.window.HCAcousticEngine = { simulate: async r => simulate(r), version: async () => engine.engine_version() };
await mixed.calculate();
const mixedRequest = mixed.rustRequest(mixed.state.last.combined.map(p => p.frequency), true);
const isolated = mixedRequest.drivers.map(driver => simulate({ ...mixedRequest, drivers: [driver] }).combined);
const expected = isolated[0].map((_, i) => {
    const pressure = isolated.reduce(([re, im], curve) => {
        const p = curve[i], a = 10 ** (p.db / 20), angle = p.phase_deg * Math.PI / 180;
        return [re + a * Math.cos(angle), im + a * Math.sin(angle)];
    }, [0,0]);
    return { db: 20 * Math.log10(Math.max(1e-12, Math.hypot(...pressure))) };
});
const mixedError = error(expected, mixed.state.last.combined);
report.mixed_driver_sum = { driver_count: rows.length, max_error_db: mixedError, status: mixedError < 1e-8 ? 'PASS' : 'FAIL',
    meaning: 'All ten heterogeneous driver paths sum correctly, using the supplied/model phase and voltage-scaled source measurement levels.' };

// A controlled metadata-only change establishes whether measurement voltage
// affects the design request and produces the required signed SPL difference.
const voltageA = setup({ ...rows[0], drive_voltage_v: .1 });
const voltageB = setup({ ...rows[0], drive_voltage_v: .2 });
voltageB.driver.id = voltageA.driver.id;
const identical = JSON.stringify(voltageA.d.rustRequest([1000], true)) === JSON.stringify(voltageB.d.rustRequest([1000], true));
const voltageDifference = simulate(voltageB.d.rustRequest([1000], true)).combined[0].db
    - simulate(voltageA.d.rustRequest([1000], true)).combined[0].db;
report.common_voltage_check = {
    status: Math.abs(voltageDifference + 20 * Math.log10(2)) < 1e-8 ? 'PASS' : 'FAIL',
    requirement: 'Absolute multi-driver comparison at one input voltage must account for each baseline measurement voltage.',
    reproduction: 'Only drive_voltage_v changes from 0.1 to 0.2 V while the same numerical FR is retained.',
    requests_identical: identical,
    expected_level_difference_at_common_voltage_db: -20 * Math.log10(2),
    observed_level_difference_db: voltageDifference,
    limitation: 'Voltage scaling assumes linear response; this does not calibrate the source, coupler or missing measured phase.',
};
report.summary = { passed_checks: report.drivers.reduce((n,d) => n+d.passed,0), failed_checks: report.drivers.reduce((n,d) => n+d.failed,0),
    simulation_calls: simulationCount, response_points: responsePointCount, sweep_cases: report.drivers.reduce((n,d) => n+(d.sweep.cases||0),0),
    common_voltage_failures: report.common_voltage_check.status === 'FAIL' ? 1 : 0,
    note: 'Simulation counts exclude internal optimizer candidate evaluations.' };
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.summary));
if (report.summary.failed_checks || mixedError >= 1e-8) process.exitCode = 1;
else if (report.summary.common_voltage_failures) process.exitCode = 2;
