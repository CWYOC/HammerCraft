import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { browserContext } from './helpers.mjs';
import { designer } from './designer-helper.mjs';
import init, * as engine from '../docs/wasm/acoustic_engine.js';
await init({ module_or_path: fs.readFileSync(new URL('../docs/wasm/acoustic_engine_bg.wasm', import.meta.url)) });
const graph = browserContext('docs/cad-circuit.js').window.HCCircuit;
const plain = x => JSON.parse(JSON.stringify(x));

function circuit() {
    return { input: 'in', output: 'out', ground: 'gnd',
        nodes: ['in', 'out', 'gnd', 'a', 'b'].map(id => ({ id, x: 100, y: 100, hidden: !['in', 'gnd'].includes(id) })),
        components: [{ id: 'r', label: 'R1', kind: 'resistor', value: 16, nodeA: 'a', nodeB: 'b', x: 300, y: 120, rotationDeg: 0 }],
        filters: [] };
}
function wired() {
    const c = circuit();
    graph.createWire(c, { nodeId: 'in' }, { componentId: 'r', side: 'a', nodeId: 'a' });
    graph.createWire(c, { componentId: 'r', side: 'b', nodeId: 'b' }, { driverTerminal: 'plus', nodeId: 'out' });
    return c;
}

test('ideal wires compile to nets and the JS and shipped WASM solvers agree on a voltage divider', () => {
    const d = designer(); const driver = d.driver(); driver.circuit = wired(); driver.path = [];
    d.state.drivers = [driver];
    const compiled = graph.compile(driver.circuit);
    assert.deepEqual(plain(compiled.errors), []);
    assert.equal(compiled.circuit.nodes.length, 3);
    assert.equal(compiled.circuit.components.length, 1);
    assert.ok(Math.abs(d.passiveCircuitH(driver, 1000).re - 0.5) < 1e-9);
    const rust = JSON.parse(engine.simulate_json(JSON.stringify(d.rustRequest([1000]))));
    assert.ok(Math.abs(rust.combined[0].db + 20 * Math.log10(2)) < 0.001);
});

test('copy and paste creates isolated pins, and floating parts do not change the working circuit', () => {
    const c = wired(); const before = graph.compile(c).circuit;
    const copy = graph.duplicateComponent(c, c.components[0], 'R2');
    assert.notEqual(copy.nodeA, 'a'); assert.notEqual(copy.nodeB, 'b'); assert.notEqual(copy.id, 'r');
    const result = graph.compile(c);
    assert.deepEqual(plain(result.circuit), plain(before));
    assert.match(result.warnings.join(' '), /Unconnected.*R2/);
});

test('deleting a component also removes its wires and orphaned pin nodes', () => {
    const c = wired(); graph.removeComponent(c, 'r');
    assert.equal(c.components.length, 0);
    assert.equal(c.nodes.some(n => ['a', 'b'].includes(n.id)), false);
    assert.match(graph.compile(c).errors.join(' '), /Complete the signal path/);
});

test('shorts, open signal paths and invalid values produce actionable diagnostics', () => {
    const c = circuit();
    assert.match(graph.compile(c).errors.join(' '), /Driver \+/);
    graph.createWire(c, { nodeId: 'in' }, { nodeId: 'gnd' });
    assert.match(graph.compile(c).errors.join(' '), /shorted to ground/);
    c.components[0].value = -5;
    assert.match(graph.compile(c).errors.join(' '), /R1: enter a valid resistor value/);
    const broken = wired(); broken.nodes = broken.nodes.filter(n => n.id !== 'gnd');
    assert.match(graph.compile(broken).errors.join(' '), /missing its ground terminal/);
});

test('bypass and zero-ohm resistors collapse to ideal shorts', () => {
    for (const change of [{ bypassed: true }, { value: 0 }]) {
        const c = wired(); Object.assign(c.components[0], change);
        const result = graph.compile(c);
        assert.equal(result.circuit.input, result.circuit.output);
        assert.equal(result.circuit.components.length, 0);
        assert.equal(result.errors.length, 0);
    }
});

test('moving and rotating components change wire geometry without changing the electrical graph', () => {
    const c = wired(); const before = graph.compile(c);
    const nets = result => plain({ ...result.circuit, components: result.circuit.components.map(({ x, y, rotationDeg, ...c }) => c) });
    Object.assign(c.components[0], { x: 500, y: 260, rotationDeg: 90 });
    assert.deepEqual(nets(graph.compile(c)), nets(before));
});

test('a drawn crossing does not connect wires; an explicit split creates a branch junction', () => {
    const c = wired(); const first = c.components.find(c => c.kind === 'wire');
    first.route = [{ x: 200, y: 100 }]; first.routing = 'free';
    const baseline = graph.compile(c).circuit;
    const junction = graph.splitWire(c, first.id, [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 300, y: 100 }], { x: 180, y: 104 });
    assert.equal(junction.x, 180); assert.equal(junction.y, 100); assert.equal(junction.connectPoint, true);
    assert.equal(graph.compile(c).circuit.components.length, baseline.components.length);
    const other = graph.duplicateComponent(c, c.components[0], 'R2');
    other.x = junction.x; other.y = junction.y;
    assert.match(graph.compile(c).warnings.join(' '), /R2/);
    graph.createWire(c, { nodeId: junction.id }, { componentId: other.id, side: 'a', nodeId: other.nodeA });
    graph.createWire(c, { componentId: other.id, side: 'b', nodeId: other.nodeB }, { nodeId: 'gnd' });
    assert.equal(graph.compile(c).circuit.components.length, 2);
    assert.equal(graph.compile(c).warnings.length, 0);
});

test('wire routes retain manual waypoints and respect orthogonal and 45-degree constraints', () => {
    for (const routing of ['orthogonal', '45']) {
        const bend = { x: 120, y: 160 };
        const points = graph.wirePoints({ x: 20, y: 30 }, { x: 300, y: 210 }, { route: [bend], routing });
        assert.ok(points.some(p => p.x === bend.x && p.y === bend.y));
        points.slice(1).forEach((p, i) => {
            const dx = Math.abs(p.x - points[i].x), dy = Math.abs(p.y - points[i].y);
            assert.ok(dx === 0 || dy === 0 || (routing === '45' && dx === dy));
        });
    }
});

test('wire endpoints follow component pins and refuse stale owners or duplicate links', () => {
    const c = wired();
    const endpoint = { componentId: 'r', side: 'a', nodeId: 'stale' };
    assert.equal(graph.endpointNode(c, endpoint), 'a');
    assert.equal(graph.createWire(c, endpoint, { nodeId: 'in' }), null);
    graph.removeComponent(c, 'r');
    assert.equal(graph.createWire(c, endpoint, { nodeId: 'in' }), null);
});

test('ordered legacy projects migrate to a connected signal path', () => {
    const d = designer(); const driver = d.driver();
    driver.circuit = [{ type: 'series_r', value: 16 }, { type: 'low_pass', frequency: 3000, q: 0.707 }];
    d.ensureDriverShape(driver);
    assert.equal(graph.compile(driver.circuit).errors.length, 0);
    assert.ok(Math.abs(d.passiveCircuitH(driver, 1000).re - 0.5) < 1e-9);
    assert.equal(driver.circuit.filters[0].type, 'low_pass');
});

test('legacy series and shunt connections become editable wires without changing the response', () => {
    const d = designer(); const driver = d.driver();
    driver.circuit = [{ type: 'series_r', value: 16 }, { type: 'shunt_c', value: 10 }, { type: 'series_l', value: 0.2 }];
    d.ensureDriverShape(driver);
    const before = [100, 1000, 10000].map(f => d.passiveCircuitH(driver, f));
    graph.makeEditable(driver.circuit);
    const after = [100, 1000, 10000].map(f => d.passiveCircuitH(driver, f));
    after.forEach((value, i) => {
        assert.ok(Math.abs(value.re - before[i].re) < 1e-9);
        assert.ok(Math.abs(value.im - before[i].im) < 1e-9);
    });
    assert.equal(driver.circuit.components.filter(c => c.kind === 'wire').length, 6);
    const snapshot = JSON.stringify(driver.circuit);
    graph.makeEditable(driver.circuit);
    assert.equal(JSON.stringify(driver.circuit), snapshot, 'Migration is idempotent');
});

test('legacy direct source connections become removable wires', () => {
    const c = circuit(); c.output = c.input; c.components = [];
    graph.makeEditable(c);
    assert.notEqual(c.output, c.input);
    assert.equal(graph.compile(c).errors.length, 0);
    const driverWire = c.components.find(c => c.kind === 'wire');
    graph.removeComponent(c, driverWire.id);
    assert.match(graph.compile(c).errors.join(' '), /Complete the signal path/);
});

test('rendering a legacy direct connection does not mutate or hide the source', () => {
    const d = designer(); const driver = d.driver(); driver.circuit.output = driver.circuit.input;
    const before = JSON.stringify(driver.circuit);
    d.renderCircuitSvg(driver);
    assert.equal(JSON.stringify(driver.circuit), before);
    assert.match(d.document.getElementById(`cad-${driver.id}`).innerHTML, /class="iem-cad-node input/);
});

test('a late simulation cannot overwrite a newer invalid circuit state', async () => {
    const d = designer(); const driver = d.driver(); driver.circuit = wired(); d.state.drivers = [driver];
    let resolve;
    d.context.window.HCAcousticEngine = { simulate: () => new Promise(done => { resolve = done; }) };
    const pending = d.calculate();
    graph.removeComponent(driver.circuit, 'r');
    await d.calculate();
    assert.equal(d.document.getElementById('iemEngineStatus').textContent, 'CHECK CIRCUIT');
    resolve({ drivers: [], combined: [] }); await pending;
    assert.equal(d.state.last, null);
    assert.match(d.document.getElementById('iemSimulationMessage').textContent, /Complete the signal path/);
});
