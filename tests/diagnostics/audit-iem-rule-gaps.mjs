// Diagnostic observations, not manufacturing acceptance tests. Run from any cwd.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { designer } from '../designer-helper.mjs';
import init, * as engine from '../../docs/wasm/acoustic_engine.js';
const read = name => fs.readFileSync(new URL(name, import.meta.url));
const wasm = read('../../docs/wasm/acoustic_engine_bg.wasm');
await init({ module_or_path: wasm });
const shell = JSON.parse(engine.workshop_import_stl(read('../../docs/assets/workshop/solid-shell.stl'), 1));
const catalog = JSON.parse(read('../../docs/assets/workshop/drivers.json'));
const geometryDriver = (id, preset = 13) => ({ id, preset, position_mm: [0,0,0], rotation_deg: [0,0,0],
    bend_mm: [-12,0,0], end_mm: [-18,0,0], lead_mm: 2, inner_diameter_mm: 1.6, outer_diameter_mm: 2.4 });
const project = drivers => ({ format: 'hc-headphone-workshop', version: 1, name: 'Synthetic rule-gap probe',
    shell_scale: [2,2,2], mirrored: false, drivers });
const build = (drivers, mesh = shell) => JSON.parse(engine.workshop_build_json(JSON.stringify(project(drivers)), JSON.stringify(mesh)));
const observations = [];

const routed = geometryDriver('route-owner'), obstruction = geometryDriver('obstruction');
obstruction.position_mm = [-10,0,0]; obstruction.bend_mm = [-14,6,0]; obstruction.end_mm = [-14,12,0];
const crossed = build([routed, obstruction]);
const controls = crossed.paths.find(p => p.driver_id === routed.id).control_points;
const obstructionSize = catalog.find(p => p.id === obstruction.preset).size_mm;
let insideSamples = 0;
for (let k = 0; k <= 1000; k++) {
    const t = k / 1000, u = 1 - t;
    const point = [0,1,2].map(i => u*u*u*controls[0][i] + 3*u*u*t*controls[1][i] + 3*u*t*t*controls[2][i] + t*t*t*controls[3][i]);
    if (point.every((x,i) => Math.abs(x - obstruction.position_mm[i]) < obstructionSize[i]/2)) insideSamples++;
}
observations.push({ id: 'route-through-package', build_accepted: true, samples_strictly_inside_unrelated_box_package: insideSamples,
    sample_count: 1001, warnings: crossed.warnings, placement_checks: crossed.placement_checks,
    interpretation: 'The second preset is a box at zero rotation; these samples penetrate the actual displayed package, not merely a conservative bounding box.' });

const broadOutlet = geometryDriver('broad-outlet', 15), outletBuild = build([broadOutlet]);
observations.push({ id: 'outlet-transition-not-described', build_accepted: true,
    catalog_outlet_diameter_mm: catalog.find(p => p.id === 15).outlet_diameter_mm,
    tube_bore_mm: broadOutlet.inner_diameter_mm, warnings: outletBuild.warnings, placement_checks: outletBuild.placement_checks,
    interpretation: 'A narrower tube can be valid with a designed transition. No adapter/sealing geometry or compatibility check is requested here.' });

const inverted = structuredClone(shell); inverted.triangles.forEach(t => [t[1],t[2]] = [t[2],t[1]]);
const invertedBuild = build([], inverted);
observations.push({ id: 'globally-inverted-shell', build_accepted: true, signed_volume_mm3: invertedBuild.shell.signed_volume_mm3,
    boundary_edges: invertedBuild.shell.boundary_edges, inconsistent_edges: invertedBuild.shell.inconsistent_edges,
    warnings: invertedBuild.warnings, placement_checks: invertedBuild.placement_checks,
    interpretation: 'Consistent inward winding is not the same as a valid solid orientation. Inspect the signed volume and shell-orientation diagnostic; build acceptance permits editing and is not manufacturing approval.' });

const app = designer(), a = app.driver();
Object.assign(a, { id: 'synthetic-a', name: 'Synthetic flat receiver', responseAbsolute: true, path: [],
    measurement: [{frequency:100,db:90},{frequency:10000,db:90}], voltageMode:'common', measurementVoltageV:0.1 });
a.circuit.output = a.circuit.input;
app.state.drivers = [a, {...structuredClone(a), id:'synthetic-b'}];
app.context.window.HCAcousticEngine = { simulate: async request => JSON.parse(engine.simulate_json(JSON.stringify(request))), version:async()=>engine.engine_version() };
await app.calculate();
const exported = app.validationSetup();
observations.push({ id: 'assumed-phase-combined-response', input_errors: Array.from(app.physicalInputErrors()),
    individual_level_db: 90, combined_level_db: app.state.last.combined[0].db,
    measured_phase_flags: Array.from(exported.drivers, d => d.measured_phase),
    ui_notes: app.document.getElementById('iemModelNotes').textContent,
    interpretation: 'Exploratory summation is allowed and the missing phase is warned about. Validation metadata correctly preserves the missing evidence; a design-release gate is still absent.' });

app.state.drivers = [a];
const beyondBand = JSON.parse(engine.simulate_json(JSON.stringify(app.rustRequest([20,100,1000,10000,20000],true))));
observations.push({ id:'outside-measured-band', baseline_band_hz:[100,10000],
    requested_frequencies_hz:[20,100,1000,10000,20000], response:beyondBand.combined,
    interpretation:'The baseline endpoints are held outside the recorded range and a full-band response is returned. This is a numerical extension, not measured evidence at 20 Hz or 20 kHz.' });
app.applyRevPhysical({ tube_length_mm:10, tube_diameter_mm:2, damper_ohm:0, resistor_ohm:0, capacitor_uf:0, gain_db:8 },0,false);
observations.push({ id:'reverse-candidate-gain-realizability', applied_gain_db:a.gain,
    circuit_component_kinds:Array.from(a.circuit.components,c=>c.kind),
    input_errors:Array.from(app.physicalInputErrors()),
    interpretation:'The independent 8 dB gain parameter is accepted without a mapped amplifier or other hardware implementation. This does not establish that an all-passive assembly can realise the scored candidate.' });

console.log(JSON.stringify({engine:engine.engine_version(), wasm_sha256:createHash('sha256').update(wasm).digest('hex'),
    scope:'Synthetic diagnostic probes of missing checks; not physical validation and not an acceptance pass.', observations},null,2));
