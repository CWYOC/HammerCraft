// Measurement comparison utilities. No gain fitting, phase fitting or extrapolation.
import crypto from 'node:crypto';

export const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const defaultCriteria = Object.freeze({ spl_rmse_db: 1, spl_p95_abs_db: 2,
    phase_rmse_deg: 15, damping_rmse_db: 1, peak_level_error_db: 2, peak_frequency_error_percent: 5 });
export const grid = (lo, hi, count = 240) => Array.from({ length: count }, (_, i) => lo * (hi / lo) ** (i / (count - 1)));
const finite = Number.isFinite;
const positive = x => finite(x) && x > 0;
export function band(value, name = 'band_hz') {
    if (!Array.isArray(value) || value.length !== 2 || !value.every(positive) || value[1] <= value[0]) throw Error(`Invalid ${name}`);
    return value;
}
export function validatePoints(points) {
    if (!Array.isArray(points) || points.length < 2) throw Error('At least two measured points are required');
    points.forEach((p, i) => {
        if (!positive(p.frequency_hz) || !finite(p.db) || (p.phase_deg != null && !finite(p.phase_deg))
            || (i && p.frequency_hz <= points[i - 1].frequency_hz)) throw Error('Measured frequencies must be positive and strictly increasing, with finite SPL and optional finite phase');
    });
}
export function interpolate(points, f, key = 'db') {
    if (f < points[0].frequency_hz || f > points.at(-1).frequency_hz) throw Error('Extrapolation is forbidden');
    let i = points.findIndex(p => p.frequency_hz >= f);
    if (points[i].frequency_hz === f) return points[i][key] ?? null;
    const a = points[i - 1], b = points[i];
    if (!finite(a[key]) || !finite(b[key])) return null;
    let delta = b[key] - a[key];
    if (key === 'phase_deg' && points.every(p => p.phase_deg == null || Math.abs(p.phase_deg) <= 180)) delta = wrap(delta);
    return a[key] + delta * Math.log(f / a.frequency_hz) / Math.log(b.frequency_hz / a.frequency_hz);
}
const wrap = x => ((x + 180) % 360 + 360) % 360 - 180;
export function stats(values) {
    if (!values.length || values.some(x => !finite(x))) throw Error('Cannot score missing/non-finite errors');
    const abs = values.map(Math.abs).sort((a, b) => a - b);
    return { rms: Math.sqrt(values.reduce((s, x) => s + x * x, 0) / values.length),
        p95_abs: abs[Math.ceil(abs.length * .95) - 1], max_abs: abs.at(-1),
        bias: values.reduce((s, x) => s + x, 0) / values.length, samples: values.length };
}
function assertSetup(setup) {
    if (setup.schema_version !== 1 || !positive(setup.input_voltage_v)
        || !setup.request?.drivers?.length || !Array.isArray(setup.drivers)
        || setup.drivers.length !== setup.request.drivers.length) throw Error('Invalid exported setup');
    setup.drivers.forEach((d, i) => {
        if (d.id !== setup.request.drivers[i].id) throw Error('Setup metadata does not match request drivers');
        if (d.baseline_band_hz !== null) band(d.baseline_band_hz, 'baseline_band_hz');
    });
}
export function scoreCase(item, setup, measurement, simulate, criteria = defaultCriteria) {
    assertSetup(setup);
    const [lo, hi] = band(item.band_hz);
    const blockers = [], failures = [];
    const setupSha = hash(setup);
    const base = { id: item.id, driver: item.driver, role: item.role, band_hz: item.band_hz,
        setup_sha256: setupSha, blockers, failures };
    if (!measurement) return { ...base, status: 'AWAITING_MEASUREMENT', blockers: ['No physical measurement file supplied'] };
    if (measurement.schema_version !== 1) throw Error('Unsupported measurement schema');
    validatePoints(measurement.points);
    const points = measurement.points;
    if (points[0].frequency_hz > lo || points.at(-1).frequency_hz < hi) throw Error('Measurement does not cover the complete requested band');
    const gapLimit = item.max_gap_octaves ?? .25;
    if (!positive(gapLimit) || gapLimit > .25) throw Error('max_gap_octaves must be positive and at most 0.25');
    for (let i = 1; i < points.length; i++) {
        if (points[i].frequency_hz > lo && points[i - 1].frequency_hz < hi
            && Math.log2(points[i].frequency_hz / points[i - 1].frequency_hz) > gapLimit + 1e-10) {
            blockers.push('Measurement sampling is too sparse for the declared band'); break;
        }
    }
    if (measurement.kind !== 'physical_measurement') blockers.push('Data is not declared physical measurement evidence');
    if (measurement.setup_sha256 !== setupSha || measurement.setup_confirmed !== true) blockers.push('Physical setup has not been confirmed against this frozen setup hash');
    for (const key of ['specimen_id', 'mount_id', 'coupler_model', 'calibration_id', 'acquired_at']) {
        if (typeof measurement[key] !== 'string' || !measurement[key].trim()) blockers.push(`Missing measurement ${key}`);
    }
    if (!positive(measurement.input_voltage_v) || Math.abs(measurement.input_voltage_v / setup.input_voltage_v - 1) > .01) blockers.push('Measured input voltage must match the requested source voltage within 1%');
    if (!finite(measurement.expanded_uncertainty_db) || measurement.expanded_uncertainty_db < 0) blockers.push('Expanded SPL uncertainty is missing');
    else if (measurement.expanded_uncertainty_db > criteria.spl_rmse_db / 2) blockers.push('Measurement uncertainty exceeds half of the SPL RMS target');
    if (item.role !== 'validation') blockers.push('This configuration is reserved for fitting, not independent validation');
    setup.drivers.forEach(d => {
        if (d.voltage_mode !== 'common' || !positive(d.measurement_voltage_v)) blockers.push(`${d.name}: baseline voltage is not calibrated`);
        if (!d.baseline_band_hz || d.baseline_band_hz[0] > lo || d.baseline_band_hz[1] < hi) blockers.push(`${d.name}: baseline does not cover this band`);
        if (!d.measured_phase) blockers.push(`${d.name}: baseline phase was not measured`);
        if (!d.measured_impedance_phase) blockers.push(`${d.name}: baseline impedance phase was not measured`);
    });
    const frequencies = grid(lo, hi);
    const request = structuredClone(setup.request); request.frequencies_hz = frequencies;
    const predicted = simulate(request).combined;
    if (!Array.isArray(predicted) || predicted.length !== frequencies.length
        || predicted.some((p, i) => !finite(p.db) || !finite(p.phase_deg) || Math.abs(p.frequency_hz / frequencies[i] - 1) > 1e-8)) throw Error('Simulator returned invalid or mismatched points');
    const measured = frequencies.map(frequency_hz => ({ frequency_hz, db: interpolate(points, frequency_hz), phase_deg: interpolate(points, frequency_hz, 'phase_deg') }));
    const spl = stats(predicted.map((p, i) => p.db - measured[i].db));
    if (spl.rms > criteria.spl_rmse_db) failures.push('SPL RMS error');
    if (spl.p95_abs > criteria.spl_p95_abs_db) failures.push('SPL 95th-percentile absolute error');
    let phase = null;
    if (typeof measurement.phase_reference === 'string' && measurement.phase_reference.trim() && measured.every(p => finite(p.phase_deg))) {
        phase = stats(predicted.map((p, i) => wrap(p.phase_deg - measured[i].phase_deg)));
        if (phase.rms > criteria.phase_rmse_deg) failures.push('Phase RMS error');
    } else blockers.push('Measured phase or its timing reference is missing');
    const peaks = (item.peak_bands_hz || []).map(range => {
        const [a, b] = band(range, 'peak_bands_hz');
        if (a < lo || b > hi) throw Error('Peak window is outside the validation band');
        const select = series => series.filter(p => p.frequency_hz >= a && p.frequency_hz <= b).reduce((max, p) => !max || p.db > max.db ? p : max, null);
        const actual = select(measured), model = select(predicted);
        if (!actual || !model) throw Error('Peak window has no samples');
        const interior = p => p.frequency_hz > a * 1.03 && p.frequency_hz < b / 1.03;
        if (!interior(actual) || !interior(model)) blockers.push('A peak lies at its window boundary; peak correspondence is not established');
        const level_error_db = model.db - actual.db;
        const frequency_error_percent = 100 * (model.frequency_hz / actual.frequency_hz - 1);
        if (Math.abs(level_error_db) > criteria.peak_level_error_db || Math.abs(frequency_error_percent) > criteria.peak_frequency_error_percent) failures.push('Peak error');
        return { band_hz: range, measured: actual, predicted: model, level_error_db, frequency_error_percent };
    });
    return { ...base, status: failures.length ? 'FAIL' : blockers.length ? 'INCOMPLETE' : 'PASS',
        measurement_sha256: hash(measurement), specimen_id: measurement.specimen_id, mount_id: measurement.mount_id,
        metrics: { spl, phase, peaks }, curves: { measured, predicted } };
}

function withoutDampers(request) {
    const clean = structuredClone(request);
    delete clean.frequencies_hz;
    for (const d of clean.drivers) {
        d.acoustic_path = d.acoustic_path.filter(e => e.type !== 'damper').reduce((path, e) => {
            const last = path.at(-1);
            if (e.type === 'tube' && last?.type === 'tube' && last.diameter_mm === e.diameter_mm
                && last.loss_factor === e.loss_factor) last.length_mm += e.length_mm;
            else path.push(e);
            return path;
        }, []);
    }
    return clean;
}
export function scoreDamping(damped, undamped, setups, measurements, limit) {
    if (!damped.curves || !undamped?.curves) {
        damped.blockers.push('Paired undamped measurement is unavailable');
        if (damped.status === 'PASS') damped.status = 'INCOMPLETE';
        return;
    }
    const a = measurements[0], b = measurements[1];
    if (hash(withoutDampers(setups[0].request)) !== hash(withoutDampers(setups[1].request))
        || setups[0].input_voltage_v !== setups[1].input_voltage_v
        || JSON.stringify(damped.band_hz) !== JSON.stringify(undamped.band_hz)
        || !a.pair_id || a.pair_id !== b.pair_id || a.specimen_id !== b.specimen_id
        || a.coupler_model !== b.coupler_model || a.calibration_id !== b.calibration_id) {
        damped.blockers.push('Damping pair differs in geometry, electrical setup, specimen, calibration, or pair ID');
        if (damped.status === 'PASS') damped.status = 'INCOMPLETE';
        return;
    }
    damped.metrics.damping = stats(damped.curves.predicted.map((p, i) =>
        (p.db - undamped.curves.predicted[i].db) - (damped.curves.measured[i].db - undamped.curves.measured[i].db)));
    if (damped.metrics.damping.rms > limit) { damped.failures.push('Damping-change RMS error'); damped.status = 'FAIL'; }
    if (undamped.blockers.length) {
        damped.blockers.push('Paired undamped case has incomplete evidence');
        if (damped.status === 'PASS') damped.status = 'INCOMPLETE';
    }
}
