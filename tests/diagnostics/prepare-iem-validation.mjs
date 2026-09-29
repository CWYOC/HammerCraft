// Prepare reproducible prediction setups and blank measurement forms. Never creates measured points.
// node tests/diagnostics/prepare-iem-validation.mjs output-directory
import fs from 'node:fs';
import path from 'node:path';
import { designer } from '../designer-helper.mjs';
import { hash, defaultCriteria } from './measurement-validation.mjs';
const output = process.argv[2];
if (!output) throw Error('Supply a new output directory');
if (fs.existsSync(output)) throw Error('Output already exists; use a new directory to preserve measurements');
fs.mkdirSync(path.join(output, 'setups'), { recursive: true });
fs.mkdirSync(path.join(output, 'measurement-templates'));
const rows = JSON.parse(fs.readFileSync(new URL('../fixtures/driver-library.json', import.meta.url)));
const write = (name, data) => fs.writeFileSync(path.join(output, name), JSON.stringify(data, null, 2) + '\n');
const tube = (length = 12, diameter = 2) => ({ type: 'tube', length, diameter, loss: 0 });
const damper = value => ({ type: 'damper', value });
const variants = [
    { id: 'reference', role: 'fit', reference: true },
    { id: 'straight', role: 'validation', path: [tube()] },
    ...[680, 1500, 2200].map(r => ({ id: `damper-${r}`, role: r === 680 ? 'fit' : 'validation', path: [tube(6), damper(r), tube(6)], pair: 'straight' })),
    { id: 'tube-6', role: 'fit', path: [tube(6)] },
    { id: 'tube-20', role: 'validation', path: [tube(20)] },
    { id: 'bore-1.5', role: 'validation', path: [tube(12, 1.5)] },
    { id: 'damper-1500-inlet', role: 'validation', path: [damper(1500), tube()], pair: 'straight' },
    { id: 'resistor-10', role: 'validation', path: [tube()], component: { kind: 'resistor', value: 10 } },
    { id: 'capacitor-1', role: 'validation', path: [tube()], component: { kind: 'capacitor', value: 1 } },
    { id: 'inverted', role: 'validation', path: [tube()], polarity: -1 },
    { id: 'half-voltage', role: 'validation', path: [tube()], inputVoltage: .05 },
];
const cases = [], inventory = [];
for (const row of rows) {
    const slug = `${row.manufacturer}-${row.model}`.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
    const configs = [...variants];
    if (row.model === '2356') configs.push(
        { id: 'guide-geometry-undamped', role: 'validation', path: [tube(7, 1.5), tube(2.5, 2.1), tube(3, 2.5)] },
        { id: 'guide-geometry-1500-at-7mm', role: 'validation', pair: 'guide-geometry-undamped', path: [tube(7, 1.5), damper(1500), tube(2.5, 2.1), tube(3, 2.5)] },
        { id: 'guide-geometry-1500-at-9.5mm', role: 'validation', pair: 'guide-geometry-undamped', path: [tube(7, 1.5), tube(2.5, 2.1), damper(1500), tube(3, 2.5)] },
    );
    for (const variant of configs) {
        const d = designer(), driver = d.databaseDriverToDesign(row);
        driver.id = slug; driver.circuit.nodes = driver.circuit.nodes.filter(n => n.id !== 'drv'); driver.circuit.output = 'in';
        driver.path = structuredClone(variant.reference ? Array.from(d.referenceInfo(driver).modelled) : variant.path);
        driver.polarity = variant.polarity || 1;
        if (variant.component) {
            driver.circuit.nodes.push({ id: 'out', label: 'DRIVER+', x: 600, y: 120 });
            driver.circuit.output = 'out';
            driver.circuit.components.push({ id: 'series', nodeA: 'in', nodeB: 'out', ...variant.component });
        }
        d.state.drivers = [driver];
        d.document.getElementById('iemInputVoltage').value = String(variant.inputVoltage || .1);
        d.document.getElementById('iemAcousticLoadType').value = driver.measurementReferenceLoad.type;
        d.document.getElementById('iemCouplerVolume').value = String(driver.measurementReferenceLoad.volume_mm3 || 2000);
        const setup = d.validationSetup(), id = `${slug}-${variant.id}`;
        const item = { id, driver: driver.name, role: variant.role,
            band_hz: [Math.max(100, row.fr[0].frequency_hz), Math.min(8000, row.fr.at(-1).frequency_hz)],
            setup_file: `setups/${id}.json`, measurement_file: `measurements/${id}.json`,
            ...(variant.pair ? { paired_undamped_case: `${slug}-${variant.pair}` } : {}) };
        cases.push(item); write(item.setup_file, setup);
        write(`measurement-templates/${id}.json`, {
            schema_version: 1, kind: 'pending', setup_sha256: hash(setup), setup_confirmed: false,
            specimen_id: null, mount_id: null, pair_id: null, coupler_model: null, calibration_id: null,
            acquired_at: null, input_voltage_v: null, expanded_uncertainty_db: null, phase_reference: null,
            notes: 'Blank acquisition form. Record actual hardware, confirm setup, and insert raw measured points; never use simulated data here.', points: [],
        });
    }
    inventory.push({ driver: `${row.manufacturer} ${row.model}`, cases: configs.length, measurement_voltage_v: row.drive_voltage_v,
        fixture: row.coupler, measured_fr_phase: false, physical_status: 'AWAITING_MEASUREMENTS',
        additional_scope: row.model === 'EST65DA01' ? 'Only 1–8 kHz pilot; a characterized extended-frequency fixture and transformer conditions are still needed for its intended upper band.' : 'Pilot band only; low bass, upper treble and assembly validation remain separate.' });
}
write('manifest.json', { schema_version: 1, criteria: defaultCriteria, cases });
write('driver-readiness.json', inventory);
fs.writeFileSync(path.join(output, 'README.md'), `# IEM measurement packet\n\n${rows.length} drivers, ${cases.length} planned configurations. No physical measurements are included.\n\nStart with Sonion 2356. The guide-geometry cases define damper positions for new bench tests; the original published example does not identify its damper position.\n\nUse the protocol in docs/IEM_VALIDATION_PROTOCOL.md. Record the actual coupler and geometry before collecting data. Review the receiver/transformer ratings before applying the proposed voltage. The generated fixture is a model assumption, not proof of the manufacturer's fixture.\n\nKeep fit and validation cases separate. Fit using only fit cases; freeze the final model and regenerate a NEW packet before measuring held-out validation cases. Never overwrite measurement records. Copy a completed template into measurements/ at the path named in manifest.json. Duplicate case IDs/files for each specimen and remount, updating damping pair IDs accordingly.\n\nThe default packet covers a pilot band only. Shared bores, complete IEMs, extended-frequency EST performance, and distortion need additional physical tests. The report does not certify those capabilities.\n`);
console.log(JSON.stringify({ output: path.resolve(output), drivers: rows.length, cases: cases.length, measurements: 0 }));
