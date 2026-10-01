// Published-curve diagnostic; optional --fitted uses the provisional guide fit.
// Fit residuals are not independent measurement validation.
// node tests/diagnostics/sonion-2356-benchmark.mjs [output.json] [--fitted]
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { designer } from '../designer-helper.mjs';
import init, * as engine from '../../docs/wasm/acoustic_engine.js';

const readJson = relative => JSON.parse(fs.readFileSync(new URL(relative, import.meta.url)));
const example = readJson('../fixtures/sonion-2356-design-example.json');
const library = readJson('../fixtures/driver-library.json');
await init({ module_or_path: fs.readFileSync(new URL('../../docs/wasm/acoustic_engine_bg.wasm', import.meta.url)) });
const fitted = process.argv.includes('--fitted');
const simulate = request => JSON.parse(engine.simulate_json(JSON.stringify(request)));
const d = designer(), driver = d.databaseDriverToDesign(library.find(row => row.model === '2356'));
driver.id = 'sonion-2356-benchmark';
driver.circuit.nodes = driver.circuit.nodes.filter(n => n.id !== 'drv');
driver.circuit.output = 'in';
d.state.drivers = [driver];
d.document.getElementById('iemAcousticLoadType').value = 'generic_711_approx';
d.document.getElementById('iemSplMode').value = 'absolute';
if (fitted) assert.ok(d.applySonion2356Model(driver));
d.context.window.HCAcousticEngine = { simulate: async request => simulate(request), version: async () => engine.engine_version() };

function pathAt(position = null) {
    const path = [];
    let distance = 0, inserted = false;
    for (const section of example.tube_sections_mm) {
        const tube = length => ({ type: 'tube', length, diameter: section.diameter, loss: 0 });
        const offset = position - distance;
        if (position !== null && !inserted && offset >= 0 && offset <= section.length) {
            if (offset > 0) path.push(tube(offset));
            path.push({ type: 'damper', value: example.damper_cgs_ohm });
            if (offset < section.length) path.push(tube(section.length - offset));
            inserted = true;
        } else path.push(tube(section.length));
        distance += section.length;
    }
    if (position !== null && !inserted) throw Error('Damper position is outside the tube');
    return path;
}
function interp(points, frequency) {
    assert.ok(frequency >= points[0].frequency && frequency <= points.at(-1).frequency, 'No extrapolation of the guide');
    let i = 1;
    while (points[i].frequency < frequency) i++;
    const a = points[i - 1], b = points[i];
    return a.db + (b.db - a.db) * Math.log(frequency / a.frequency) / Math.log(b.frequency / a.frequency);
}
const logGrid = (lo, hi, count) => Array.from({ length: count }, (_, i) => lo * (hi / lo) ** (i / (count - 1)));
const frequencies = logGrid(100, 8000, 120);
const plotFrequencies = logGrid(100, 8000, 500);
const rms = values => Math.sqrt(values.reduce((sum, x) => sum + x * x, 0) / values.length);
const subtract = (a, b) => a.map((x, i) => x - b[i]);
const guideUndamped = frequencies.map(f => interp(example.undamped, f));
const guideDamped = frequencies.map(f => interp(example.damped, f));
const guideChange = subtract(guideDamped, guideUndamped);
function responseAt(position, grid) {
    driver.path = pathAt(position);
    return simulate(d.rustRequest(grid, true)).combined.map(p => ({ frequency: p.frequency_hz, db: p.db }));
}
const undamped = responseAt(null, frequencies).map(p => p.db);
const undampedPlot = responseAt(null, plotFrequencies);
const peaks = [[2000, 3500], [4000, 6000]].map(([lo, hi]) =>
    example.undamped.filter(p => p.frequency >= lo && p.frequency <= hi).reduce((a, b) => a.db >= b.db ? a : b));
// Position is not specified by the guide. These are scenarios, not known fixtures.
const positions = [7, 8.25, 9.5, 12.5];
const scenarios = [];
for (const position of positions) {
    const damped = responseAt(position, frequencies).map(p => p.db);
    const change = subtract(damped, undamped);
    const plot = responseAt(position, plotFrequencies);
    const peakFrequencies = peaks.map(p => p.frequency);
    const peakDamped = responseAt(position, peakFrequencies);
    const peakUndamped = responseAt(null, peakFrequencies);
    scenarios.push({
        assumed_damper_distance_mm: position,
        damped_rmse_db: rms(subtract(damped, guideDamped)),
        damping_change_rmse_db: rms(subtract(change, guideChange)),
        at_guide_undamped_peaks: peaks.map((p, i) => ({
            frequency_hz: p.frequency,
            guide_damping_change_db: interp(example.damped, p.frequency) - p.db,
            model_damping_change_db: peakDamped[i].db - peakUndamped[i].db,
        })),
        damped: plot,
    });
}

// Exercise the production chart composition too, including the new comparison.
driver.path = pathAt(8.25);
await d.calculate();
assert.ok(d.state.last?.undampedDrivers[0], 'The production comparison is available');
const chartPoints = d.state.last.undampedDrivers[0];
const direct = responseAt(null, chartPoints.map(p => p.frequency));
assert.ok(direct.every((p, i) => Math.abs(p.db - chartPoints[i].db) < 1e-8), 'The displayed comparison matches the direct calculation');

const report = {
    source: example.source,
    provenance: example.provenance,
    engine: engine.engine_version(),
    validation_status: fitted ? 'FIT RESIDUALS: source fitted to these guide curves, not independently validated. Other damper positions are extrapolations.' : 'Legacy estimated-source diagnostic; not calibrated to this example.',
    configuration: {
        tubes_mm: example.tube_sections_mm,
        damper_cgs_ohm: example.damper_cgs_ohm,
        known_damper_position_mm: example.damper_position_mm,
        drive_voltage_v: example.drive_voltage_v,
        source_model: driver.sourceModel,
        source_resistance_cgs_ohm: driver.sourceResistanceCgs,
        output_load: fitted ? 'iec711_lumped; published side-branch network' : 'generic_711_approx; main tube and microphone only',
        acoustic_source: d.rustRequest([1000]).drivers[0].acoustic_source,
        baseline: driver.measurementSource || 'Library Sonion 2356 datasheet magnitude',
        reference_path: driver.measurementReferencePath,
        gain_db: driver.gain,
        normalization_or_fitting: fitted ? 'Passive source parameters fitted jointly to damping change, undamped SPL and damped SPL at 8.25 mm; no gain fit or display smoothing. Unknown drive level limits absolute interpretation.' : 'None; absolute-level comparison uses the existing library baseline. Unknown drive level limits its interpretation.',
    },
    comparison_band_hz: example.comparison_band_hz,
    sample_count: frequencies.length,
    frequency_weighting: 'Equally spaced in log frequency',
    undamped_rmse_db: rms(subtract(undamped, guideUndamped)),
    undamped: undampedPlot,
    scenarios,
};
const summary = { ...report, undamped: undefined, scenarios: scenarios.map(({ damped, ...rest }) => rest) };
if (process.argv[2] && !process.argv[2].startsWith('--')) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
