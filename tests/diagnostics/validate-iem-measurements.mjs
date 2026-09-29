// node tests/diagnostics/validate-iem-measurements.mjs manifest.json output-directory
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import init, * as engine from '../../docs/wasm/acoustic_engine.js';
import { defaultCriteria, scoreCase, scoreDamping, hash, band } from './measurement-validation.mjs';

const [manifestFile, outputDir] = process.argv.slice(2);
if (!manifestFile || !outputDir) throw Error('Usage: node tests/diagnostics/validate-iem-measurements.mjs manifest.json output-directory');
const root = path.dirname(path.resolve(manifestFile));
const read = name => JSON.parse(fs.readFileSync(path.resolve(root, name), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
if (manifest.schema_version !== 1 || !Array.isArray(manifest.cases) || !manifest.cases.length) throw Error('Invalid validation manifest');
const criteria = { ...defaultCriteria, ...manifest.criteria };
for (const [key, value] of Object.entries(criteria)) {
    if (!(key in defaultCriteria) || !Number.isFinite(value) || value <= 0) throw Error(`Invalid criterion: ${key}`);
}
const ids = new Set();
for (const item of manifest.cases) {
    if (!item.id || ids.has(item.id) || !['fit', 'validation'].includes(item.role)) throw Error('Case IDs must be unique; role must be fit or validation');
    ids.add(item.id); band(item.band_hz);
}
for (const item of manifest.cases) {
    if (item.paired_undamped_case && (!ids.has(item.paired_undamped_case) || item.id === item.paired_undamped_case)) throw Error('Damping pair must name another manifest case');
}
const binary = fs.readFileSync(new URL('../../docs/wasm/acoustic_engine_bg.wasm', import.meta.url));
await init({ module_or_path: binary });
const simulate = request => JSON.parse(engine.simulate_json(JSON.stringify(request)));
const records = new Map(), results = [];
for (const item of manifest.cases) {
    try {
        const setup = read(item.setup_file);
        const measurement = item.measurement_file && fs.existsSync(path.resolve(root, item.measurement_file)) ? read(item.measurement_file) : null;
        const result = scoreCase(item, setup, measurement, simulate, criteria);
        results.push(result); records.set(item.id, { setup, measurement, result });
    } catch (error) {
        results.push({ id: item.id, driver: item.driver, role: item.role, status: 'INVALID', blockers: [error.message], failures: [] });
    }
}
for (const item of manifest.cases.filter(c => c.paired_undamped_case)) {
    const current = records.get(item.id), paired = records.get(item.paired_undamped_case);
    if (!current) continue;
    scoreDamping(current.result, paired?.result, [current.setup, paired?.setup], [current.measurement, paired?.measurement], criteria.damping_rmse_db);
}
const fittingData = new Set(results.filter(r => r.role === 'fit' && r.measurement_sha256).map(r => r.measurement_sha256));
for (const r of results) {
    if (r.role === 'validation' && fittingData.has(r.measurement_sha256)) {
        r.blockers.push('This acquisition was also used in a fitting case; it is not independent validation');
        if (r.status === 'PASS') r.status = 'INCOMPLETE';
    }
}
const totals = Object.fromEntries(['PASS', 'FAIL', 'INVALID', 'INCOMPLETE', 'AWAITING_MEASUREMENT'].map(s => [s, results.filter(r => r.status === s).length]));
const heldOut = results.filter(r => r.role === 'validation');
const status = heldOut.some(r => ['FAIL', 'INVALID'].includes(r.status)) || totals.INVALID ? 'FAIL'
    : heldOut.length && heldOut.every(r => r.status === 'PASS') ? 'PASS' : 'INCOMPLETE';
const report = { schema_version: 1, generated_at: new Date().toISOString(), status, criteria, totals,
    validation_cases: heldOut.length, passing_validation_cases: heldOut.filter(r => r.status === 'PASS').length,
    engine_version: engine.engine_version(), wasm_sha256: crypto.createHash('sha256').update(binary).digest('hex'), manifest_sha256: hash(manifest),
    interpretation: 'A pass covers only the specified independent cases, specimens, bands and tolerances. It is not certification of every geometry, real-ear response, peak Q or production variation. Criteria are project targets, not IEC limits. No gain or phase fitting is performed.', results };
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(report, null, 2) + '\n');
const clean = value => String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ');
const metric = value => Number.isFinite(value) ? value.toFixed(3) : '—';
const lines = ['# IEM physical measurement validation', '', `Status: **${status}**. Engine ${report.engine_version}.`, '', report.interpretation, '',
    '| Case | Driver | Role | Status | SPL RMS dB | SPL p95 dB | Phase RMS ° | Damping RMS dB | Missing evidence / failures |',
    '|---|---|---|---|---:|---:|---:|---:|---|',
    ...results.map(r => `| ${clean(r.id)} | ${clean(r.driver)} | ${r.role} | ${r.status} | ${metric(r.metrics?.spl.rms)} | ${metric(r.metrics?.spl.p95_abs)} | ${metric(r.metrics?.phase?.rms)} | ${metric(r.metrics?.damping?.rms)} | ${clean([...r.failures, ...r.blockers].join('; '))} |`),
    '', 'Detailed curves, peak checks, input hashes and provenance are in results.json.', ''];
fs.writeFileSync(path.join(outputDir, 'report.md'), lines.join('\n'));
console.log(JSON.stringify({ status, totals, report: path.resolve(outputDir, 'report.md') }));
process.exitCode = status === 'PASS' ? 0 : status === 'FAIL' ? 1 : 2;
