import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { designer } from './designer-helper.mjs';
import init, * as engine from '../docs/wasm/acoustic_engine.js';
await init({ module_or_path: fs.readFileSync(new URL('../docs/wasm/acoustic_engine_bg.wasm', import.meta.url)) });

function setup() {
    const d = designer(), driver = d.driver();
    driver.circuit.output = driver.circuit.input;
    d.state.drivers = [driver];
    return { d, driver };
}

test('unsupported acoustic sections and filters block calculation instead of changing the requested design', async () => {
    for (const change of [driver => { driver.path[0].type = 'typo'; },
        driver => { driver.circuit.filters = [{ type: 'not_a_filter', frequency: 1000, q: 1 }]; }]) {
        const { d, driver } = setup(); change(driver); let calls = 0;
        d.context.window.HCAcousticEngine = { simulate: async () => { calls++; throw Error('Must not run'); } };
        await d.calculate();
        assert.equal(calls, 0);
        assert.match(d.document.getElementById('iemSimulationMessage').textContent, /unsupported/i);
        assert.equal(d.state.last, null);
    }
});

test('forward bore and filter Q limits agree with the engine and accept their exact boundaries', () => {
    const { d, driver } = setup();
    driver.path[0].diameter = 0.099;
    driver.circuit.filters = [{ type: 'low_pass', frequency: 1000, q: 0.049 }];
    assert.match(d.physicalInputErrors().join(' '), /diameter.*0\.1/);
    assert.match(d.physicalInputErrors().join(' '), /Q.*0\.05/);
    driver.path[0].diameter = 0.1; driver.circuit.filters[0].q = 0.05;
    assert.equal(d.physicalInputErrors().length, 0);
    const result = JSON.parse(engine.simulate_json(JSON.stringify(d.rustRequest([100, 1000, 10000]))));
    assert.ok(result.combined.every(p => Number.isFinite(p.db) && Number.isFinite(p.phase_deg)));
});

test('unsupported output loads and non-numeric numeric fields produce input diagnostics', () => {
    const { d, driver } = setup();
    d.document.getElementById('iemAcousticLoadType').value = 'unknown';
    assert.match(d.physicalInputErrors().join(' '), /load/i);
    d.document.getElementById('iemAcousticLoadType').value = 'anechoic';
    for (const value of [' ', false, [], {}]) {
        driver.gain = value;
        assert.match(d.physicalInputErrors().join(' '), /gain/);
    }
});

test('clearing damper resistance remains invalid until an explicit zero or positive value is entered', () => {
    const { d, driver } = setup();
    driver.path = [{ type: 'damper', value: 1000 }];
    const input = { dataset: { pathField: 'value' }, value: '' };
    const node = { dataset: { pathNode: `${driver.id}:0` }, querySelectorAll: () => [input] };
    d.document.querySelectorAll = selector => selector === '[data-path-node]' ? [node] : [];
    d.bindDriverEvents(); node.oninput();
    assert.match(d.physicalInputErrors().join(' '), /resistance/);
    input.value = '0'; node.oninput();
    assert.equal(d.physicalInputErrors().length, 0);
});

test('clearing a resistor in its property dialog does not create a zero-ohm short', async () => {
    const { d, driver } = setup();
    driver.circuit.output = 'drv';
    driver.circuit.components = [{ id: 'r', kind: 'resistor', label: 'R1', nodeA: 'in', nodeB: 'drv', value: 16 }];
    const modal = d.document.getElementById('iemCadPropertyModal');
    modal.dataset = { mode: 'component', driverId: driver.id, componentId: 'r' };
    const input = { dataset: { propertyField: 'value' }, value: '' };
    d.document.getElementById('iemCadPropertyBody').querySelectorAll = () => [input];
    d.document.body = { classList: { remove() {} } };
    d.applyCircuitPropertyPage();
    assert.match(d.context.window.HCCircuit.compile(driver.circuit).errors.join(' '), /valid resistor/);
    assert.equal(d.document.getElementById('iemEngineStatus').textContent, 'CHECK CIRCUIT');
});

test('blank and non-numeric resistors fail; explicit numeric zero still provides a short', () => {
    const { d, driver } = setup();
    driver.circuit.output = 'drv';
    const r = { id: 'r', kind: 'resistor', label: 'R1', nodeA: 'in', nodeB: 'drv' };
    driver.circuit.components = [r];
    for (const value of ['', ' ', null, false, [], {}]) {
        r.value = value;
        assert.match(d.context.window.HCCircuit.compile(driver.circuit).errors.join(' '), /valid resistor/);
    }
    for (const value of [0, '0']) {
        r.value = value;
        const compiled = d.context.window.HCCircuit.compile(driver.circuit);
        assert.equal(compiled.errors.length, 0);
        assert.equal(compiled.circuit.input, compiled.circuit.output);
    }
});

test('ambiguous circuit IDs are rejected rather than merging unrelated nodes or wire owners', () => {
    for (const kind of ['nodes', 'components']) {
        const { d, driver } = setup();
        driver.circuit.components = [{ id: 'r', kind: 'resistor', nodeA: 'in', nodeB: 'gnd', value: 16 }];
        driver.circuit[kind].push(structuredClone(driver.circuit[kind][0]));
        assert.match(d.context.window.HCCircuit.compile(driver.circuit).errors.join(' '), /unique/i);
    }
});

test('malformed path/filter records reject project preparation without altering the working design', () => {
    const { d, driver } = setup(), original = JSON.stringify(driver);
    for (const mutate of [d => { d.path = [null]; }, d => { d.circuit.filters = [null]; }, d => { d.circuit.nodes = [null]; }]) {
        const imported = structuredClone(driver); mutate(imported);
        assert.throws(() => d.prepareProject({ version: 3, drivers: [imported] }), /invalid.*(path|filter|circuit)/i);
        assert.equal(JSON.stringify(driver), original);
    }
});

test('reference fixture bores below the supported minimum cannot be marked complete', () => {
    const { d, driver } = setup();
    driver.measurementReferenceLoad = { type: 'anechoic' };
    driver.measurementReferenceOverride = { path: [{ element_type: 'tube', length_mm: 10, inner_diameter_mm: 0.099 }] };
    assert.equal(d.referenceInfo(driver).complete, false);
    driver.measurementReferenceOverride.path[0].inner_diameter_mm = 0.1;
    assert.equal(d.referenceInfo(driver).complete, true);
});

test('reverse search refuses bounds below its engine limits instead of silently enlarging the tube', async () => {
    for (const [field, value, expected] of [['iemReverseLengthMin', '0.49', /0\.5/], ['iemReverseDiameterMin', '0.29', /0\.3/]]) {
        const { d } = setup(); let calls = 0;
        d.state.reverse = [{ frequency: 100, db: 90 }, { frequency: 10000, db: 90 }];
        d.document.getElementById('iemReverseDriver').value = '0';
        d.document.getElementById(field).value = value;
        d.context.window.HCAcousticEngine = { reverseDesign: async () => { calls++; return []; } };
        await d.reverseRun();
        assert.equal(calls, 0);
        assert.match(d.document.getElementById('iemReverseMessage').textContent, expected);
    }
});

test('reverse search accepts its exact length and diameter limits without changing them', async () => {
    const { d } = setup(); let request;
    d.state.reverse = [{ frequency: 100, db: 90 }, { frequency: 10000, db: 90 }];
    for (const [id, value] of Object.entries({ iemReverseDriver: '0', iemReverseLengthMin: '0.5', iemReverseLengthMax: '0.5', iemReverseDiameterMin: '0.3', iemReverseDiameterMax: '0.3' })) d.document.getElementById(id).value = value;
    d.context.window.HCAcousticEngine = { reverseDesign: async r => { request = r; return []; } };
    await d.reverseRun();
    assert.equal(request.min_tube_length_mm, 0.5); assert.equal(request.max_tube_length_mm, 0.5);
    assert.equal(request.min_tube_diameter_mm, 0.3); assert.equal(request.max_tube_diameter_mm, 0.3);
});

test('the exact 0.05 mm tube wall is accepted despite floating-point rounding; thinner walls are rejected', () => {
    const tube = { control_points: [[0,0,0],[0,0,3],[0,0,6],[0,0,10]], path_segments: 64, radial_segments: 16 };
    for (const bore of [0.1, 1.6, 2, 4, 10, 19.9]) {
        tube.inner_radius_mm = bore / 2; tube.outer_radius_mm = (bore + 0.1) / 2;
        assert.doesNotThrow(() => engine.workshop_tube_json(JSON.stringify(tube)), `bore ${bore}`);
        tube.outer_radius_mm -= 0.000001;
        assert.throws(() => engine.workshop_tube_json(JSON.stringify(tube)), /wall/);
    }
    tube.inner_radius_mm = 0.8; tube.outer_radius_mm = 1.2;
    tube.inlet_inner_radius_mm = 0.8; tube.inlet_outer_radius_mm = 0.85;
    assert.doesNotThrow(() => engine.workshop_tube_json(JSON.stringify(tube)));
});

test('coarse layout and topology defects remain warnings and cannot be mistaken for manufacturing approval', () => {
    const shell = JSON.parse(engine.workshop_import_stl(fs.readFileSync(new URL('../docs/assets/workshop/solid-shell.stl', import.meta.url)), 1));
    const driver = { id: 'a', preset: 13, position_mm: [100,0,0], rotation_deg: [0,0,0], end_mm: [100,-10,0], bend_mm: [100,-6,0], lead_mm: 2, inner_diameter_mm: 1.6, outer_diameter_mm: 2.4 };
    const project = { format: 'hc-headphone-workshop', version: 1, name: 'Rule test', shell_scale: [1,1,1], mirrored: false, drivers: [driver, { ...driver, id: 'b' }] };
    shell.triangles.pop();
    const built = JSON.parse(engine.workshop_build_json(JSON.stringify(project), JSON.stringify(shell)));
    assert.match(built.warnings.join(' '), /not evaluated/);
    assert.match(built.warnings.join(' '), /topology defects/);
    assert.match(built.warnings.join(' '), /exceeds.*bounding box/i);
    assert.match(built.warnings.join(' '), /overlap/i);
});
