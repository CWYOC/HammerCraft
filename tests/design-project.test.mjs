import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
    createProject,
    validateProject,
    connectTube,
    disconnectTube,
    synchronize,
} from "../docs/design-project.mjs";
import { designer } from "./designer-helper.mjs";
import init, * as engine from "../docs/wasm/acoustic_engine.js";
await init({
    module_or_path: fs.readFileSync(
        new URL("../docs/wasm/acoustic_engine_bg.wasm", import.meta.url),
    ),
});
const plain = (x) => JSON.parse(JSON.stringify(x));
function fixture() {
    const app = designer(),
        d = app.driver();
    app.ensureDriverShape(d);
    d.id = "acoustic-1";
    d.name = "Measured driver";
    d.gain = 3;
    d.polarity = -1;
    d.measurementVoltageV = 0.1;
    d.measurement = [
        { frequency: 20, db: 100, phase: -4 },
        { frequency: 20000, db: 90, phase: 7 },
    ];
    d.impedanceCurve = [
        { frequency: 20, ohm: 16, phase: 2 },
        { frequency: 20000, ohm: 20, phase: 6 },
    ];
    d.path = [
        { type: "tube", length: 7, diameter: 1.5, loss: 0.02 },
        { type: "damper", value: 1500 },
        { type: "tube", length: 3, diameter: 2, loss: 0 },
    ];
    d.measurementReferencePath = [
        { element_type: "tube", length_mm: 10, inner_diameter_mm: 2 },
    ];
    d.referenceValidationMode = true;
    d.circuit.components.push({
        id: "resistor-1",
        kind: "resistor",
        value: 5,
        nodeA: "in",
        nodeB: "drv",
        x: 200,
        y: 100,
    });
    app.context.window.HCCircuit.makeEditable(d.circuit);
    app.ensureDriverShape(d);
    app.state.drivers = [d];
    const g = {
        id: "geometry-1",
        preset: 13,
        position_mm: [0, 0, 0],
        rotation_deg: [0, 0, 0],
        end_mm: [-3, 11, -2.4],
        bend_mm: [-7, 5, 0],
        lead_mm: 3,
        inner_diameter_mm: 1.6,
        outer_diameter_mm: 2.4,
    };
    // Circuit-link tests need a feasible envelope for every catalog outlet.
    const shell = { vertices: [[-30,-30,-30],[30,-30,-30],[30,30,-30],[-30,30,-30],[-30,-30,30],[30,-30,30],[30,30,30],[-30,30,30]], triangles: [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]] };
    const file = {
        format: "hc-workshop-file",
        version: 1,
        sourceName: "Starter",
        shell,
        project: {
            format: "hc-headphone-workshop",
            version: 1,
            name: "Combined",
            shell_scale: [1, 1, 1],
            mirrored: false,
            drivers: [g],
        },
    };
    const built = JSON.parse(
        engine.workshop_build_json(
            JSON.stringify(file.project),
            JSON.stringify(shell),
        ),
    );
    const project = createProject(
        file,
        plain(app.exportProject()),
        "project-1",
    );
    return { app, d, g, project, paths: built.paths };
}
const link = (p) =>
    connectTube(p, {
        geometryDriverId: "geometry-1",
        acousticDriverId: "acoustic-1",
        tubeIndex: 0,
        id: "link-1",
    });
test("one file round-trips geometry, circuits, calibration, phase, targets and stable links", () => {
    const { project, paths } = fixture();
    const linked = synchronize(link(project), paths).project;
    const restored = validateProject(JSON.parse(JSON.stringify(linked)));
    assert.deepEqual(restored, linked);
    assert.deepEqual(restored.geometry.shell, project.geometry.shell);
    assert.deepEqual(
        restored.acoustics.drivers[0].circuit,
        project.acoustics.drivers[0].circuit,
    );
    for (const key of [
        "measurement",
        "impedanceCurve",
        "measurementVoltageV",
        "measurementReferencePath",
        "gain",
        "polarity",
    ])
        assert.deepEqual(
            restored.acoustics.drivers[0][key],
            project.acoustics.drivers[0][key],
        );
});
test("accepted Rust route updates only the chosen tube; dampers and other sections are preserved", () => {
    const { project, paths } = fixture(),
        before = plain(project),
        result = synchronize(link(project), paths);
    const d = result.project.acoustics.drivers[0];
    assert.equal(d.path[0].length, paths[0].length_mm);
    assert.equal(d.path[0].diameter, 1.6);
    assert.equal(d.path[0].loss, 0.02);
    assert.deepEqual(
        d.path.slice(1),
        project.acoustics.drivers[0].path.slice(1),
    );
    assert.equal(d.referenceValidationMode, false);
    assert.equal(result.statuses[0].ok, true);
    assert.deepEqual(project, before);
    assert.deepEqual(
        synchronize(result.project, paths).project,
        result.project,
    );
});
test("path reordering keeps a link attached by tube ID, never array index", () => {
    const { project, paths } = fixture(),
        p = link(project);
    const a = p.acoustics.drivers[0];
    a.path.reverse();
    const result = synchronize(p, paths);
    assert.equal(
        result.project.acoustics.drivers[0].path[2].length,
        paths[0].length_mm,
    );
    assert.equal(result.project.acoustics.drivers[0].path[0].length, 3);
});
test("geometry changes propagate real Rust length; mirror preserves length", () => {
    const { project, paths } = fixture(),
        p = link(project);
    p.geometry.project.drivers[0].end_mm = [4, 15, 2];
    const calculate = (p) =>
        JSON.parse(
            engine.workshop_build_json(
                JSON.stringify(p.geometry.project),
                JSON.stringify(p.geometry.shell),
            ),
        ).paths;
    const updated = calculate(p);
    assert.notEqual(updated[0].length_mm, paths[0].length_mm);
    const result = synchronize(p, updated);
    assert.equal(
        result.project.acoustics.drivers[0].path[0].length,
        updated[0].length_mm,
    );
    p.geometry.project.mirrored = true;
    assert.equal(calculate(p)[0].length_mm, updated[0].length_mm);
});
test("removed drivers, replaced sections, changed package and missing metrics become explicit stale links", () => {
    const { project, paths } = fixture();
    for (const mutate of [
        (p) => (p.geometry.project.drivers = []),
        (p) => (p.acoustics.drivers = []),
        (p) => p.acoustics.drivers[0].path.shift(),
        (p) => (p.geometry.project.drivers[0].preset = 2),
    ]) {
        const p = link(project);
        mutate(p);
        const r = synchronize(p, paths);
        assert.equal(r.statuses[0].ok, false);
        if (r.project.acoustics.drivers[0])
            assert.ok(r.project.acoustics.drivers[0].geometryLinkError);
    }
    assert.equal(synchronize(link(project), []).statuses[0].ok, false);
});
test("unlink preserves the last dimensions and releases managed fields", () => {
    const { project, paths } = fixture(),
        linked = synchronize(link(project), paths).project,
        unlinked = synchronize(disconnectTube(linked, "link-1"), paths).project;
    assert.equal(unlinked.links.length, 0);
    assert.equal(
        unlinked.acoustics.drivers[0].path[0].length,
        paths[0].length_mm,
    );
    assert.equal(
        unlinked.acoustics.drivers[0].path[0].geometryBinding,
        undefined,
    );
});
test("reject ambiguous duplicate assignments and malformed shared formats", () => {
    const { project } = fixture();
    assert.throws(
        () =>
            connectTube(link(project), {
                geometryDriverId: "geometry-1",
                acousticDriverId: "acoustic-1",
                tubeIndex: 2,
                id: "link-2",
            }),
        /linked twice/,
    );
    assert.throws(
        () =>
            connectTube(project, {
                geometryDriverId: "geometry-1",
                acousticDriverId: "acoustic-1",
                tubeIndex: 1,
                id: "link-1",
            }),
        /tube section/,
    );
    assert.throws(
        () => validateProject({ ...project, version: 99 }),
        /version/,
    );
    const bad = plain(project);
    bad.acoustics.drivers.push(bad.acoustics.drivers[0]);
    assert.throws(() => validateProject(bad), /unique/);
    const unsafe = plain(project);
    unsafe.acoustics.drivers[0].id = '"><img src=x>';
    assert.throws(() => validateProject(unsafe), /IDs/);
});
test("acoustic adapter updates linked dimensions without replacing circuit edits or measurement provenance", async () => {
    const { app, project, paths } = fixture(),
        original = plain(app.state.drivers[0]);
    app.context.window.HCAcousticEngine = {
        simulate: async () => {
            throw new Error("Deliberately unavailable fixture");
        },
    };
    const result = synchronize(link(project), paths);
    await app.applyGeometryLinks(result.project.acoustics);
    const actual = plain(app.state.drivers[0]);
    assert.deepEqual(actual.circuit, original.circuit);
    assert.deepEqual(
        actual.measurementReferencePath,
        original.measurementReferencePath,
    );
    assert.deepEqual(actual.measurement, original.measurement);
    assert.equal(actual.path[0].length, paths[0].length_mm);
    assert.match(
        app.pathNode(app.state.drivers[0], app.state.drivers[0].path[0], 0),
        /readonly/,
    );
    const revision = app.state.calculationRevision;
    await app.applyGeometryLinks(result.project.acoustics);
    assert.equal(app.state.calculationRevision, revision);
});
test("stale link blocks acoustic calculation and reverse optimisation cannot overwrite a linked tube", async () => {
    const { app, project, paths } = fixture();
    const p = link(project);
    p.geometry.project.drivers[0].preset = 2;
    const result = synchronize(p, paths);
    await app.applyGeometryLinks(result.project.acoustics);
    assert.ok(
        app.physicalInputErrors().some((e) => e.includes("3D package changed")),
    );
    const before = plain(app.state.drivers[0]);
    app.applyRevPhysical(
        { tube_length_mm: 40, tube_diameter_mm: 3, gain_db: 8, damper_ohm: 0 },
        0,
        false,
    );
    assert.deepEqual(plain(app.state.drivers[0]), before);
    assert.match(
        app.document.getElementById("iemReverseMessage").textContent,
        /controlled by the 3D route/,
    );
});
test("acoustic project import is non-mutating and rejects bad IDs before replacing editor state", () => {
    const { app } = fixture(),
        saved = plain(app.exportProject()),
        bad = plain(saved);
    bad.drivers.push(bad.drivers[0]);
    assert.throws(() => app.importProject(bad), /unique/);
    assert.deepEqual(plain(app.exportProject()), saved);
    app.importProject(saved);
    assert.deepEqual(
        saved.drivers[0].measurement,
        plain(app.state.drivers[0].measurement),
    );
});

test("reference-unity action cannot replace a managed tube or change the output load", async () => {
    const { app, project, paths } = fixture();
    app.state.drivers = synchronize(
        link(project),
        paths,
    ).project.acoustics.drivers;
    const d = app.state.drivers[0];
    d.measurementReferenceLoad = { type: "generic_711_approx" };
    app.document.getElementById("iemAcousticLoadType").dispatchEvent = () => {};
    const button = { dataset: { useReferencePath: d.id } };
    app.document.querySelectorAll = (selector) =>
        selector === "[data-use-reference-path]" ? [button] : [];
    app.bindDriverEvents();
    const before = plain(d),
        load = app.document.getElementById("iemAcousticLoadType").value;
    await button.onclick();
    assert.deepEqual(plain(d), before);
    assert.equal(
        app.document.getElementById("iemAcousticLoadType").value,
        load,
    );
    assert.match(
        app.document.getElementById("iemSimulationMessage").textContent,
        /unlink/i,
    );
});

test("reusing a library driver clears old project bindings but preserves its dimensions and measurements", async () => {
    const { app, project, paths } = fixture();
    const saved = synchronize(link(project), paths).project.acoustics
        .drivers[0];
    saved.geometryLinkError = "Old project driver removed";
    app.storage.set("hc_iem_driver_library", JSON.stringify([saved]));
    const button = { dataset: { libUse: "0" } };
    app.document.querySelectorAll = (selector) =>
        selector === "[data-lib-use]" ? [button] : [];
    await app.renderLibrary();
    button.onclick();
    const added = app.state.drivers.at(-1);
    assert.equal(added.geometryLinkError, undefined);
    assert.equal(added.path[0].geometryBinding, undefined);
    assert.equal(added.path[0].length, paths[0].length_mm);
    assert.deepEqual(plain(added.measurement), saved.measurement);
});

test("saving a reusable driver detaches the library copy without unlinking the current design", () => {
    const { app, project, paths } = fixture();
    app.state.drivers = synchronize(
        link(project),
        paths,
    ).project.acoustics.drivers;
    const d = app.state.drivers[0],
        before = plain(d);
    const button = { dataset: { saveDriver: d.id } };
    app.document.querySelectorAll = (selector) =>
        selector === "[data-save-driver]" ? [button] : [];
    app.bindDriverEvents();
    button.onclick();
    const stored = JSON.parse(app.storage.get("hc_iem_driver_library"))[0];
    assert.equal(stored.path[0].geometryBinding, undefined);
    assert.equal(stored.path[0].length, paths[0].length_mm);
    assert.deepEqual(plain(d), before);
});

test("shared names obey the Rust UTF-8 byte limit so saved projects remain reopenable", () => {
    const { project } = fixture();
    project.name = project.geometry.project.name = "中".repeat(66);
    assert.doesNotThrow(() => validateProject(project));
    assert.doesNotThrow(() =>
        engine.workshop_build_json(
            JSON.stringify(project.geometry.project),
            JSON.stringify(project.geometry.shell),
        ),
    );
    project.name = project.geometry.project.name = "中".repeat(67);
    assert.throws(() => validateProject(project), /name/i);
    assert.throws(() =>
        engine.workshop_build_json(
            JSON.stringify(project.geometry.project),
            JSON.stringify(project.geometry.shell),
        ),
    );
});

test("reverse candidate button preserves the managed-tube warning instead of reporting success", async () => {
    const { app, project, paths } = fixture();
    app.state.drivers = synchronize(
        link(project),
        paths,
    ).project.acoustics.drivers;
    app.state.reverse = [
        { frequency: 100, db: 90 },
        { frequency: 10000, db: 90 },
    ];
    app.document.getElementById("iemReverseDriver").value = "0";
    const button = { dataset: { applyRevPhysical: "0" } };
    app.document.querySelectorAll = (selector) =>
        selector === "[data-apply-rev-physical]" ? [button] : [];
    app.context.window.HCAcousticEngine = {
        reverseDesign: async () => [
            {
                score_rmse_db: 1,
                tube_length_mm: 10,
                tube_diameter_mm: 2,
                damper_ohm: 0,
                resistor_ohm: 0,
                capacitor_uf: 0,
                gain_db: 0,
            },
        ],
    };
    await app.reverseRun();
    const before = plain(app.state.drivers);
    button.onclick();
    assert.deepEqual(plain(app.state.drivers), before);
    assert.match(
        app.document.getElementById("iemReverseMessage").textContent,
        /controlled by the 3D route/,
    );
});

test("all catalog geometry presets feed the same Rust acoustic request as manual dimensions", () => {
    const { app, project } = fixture();
    const simulate = () =>
        JSON.parse(
            engine.simulate_json(
                JSON.stringify(
                    app.rustRequest([200, 1000, 3000, 7000, 12000], true),
                ),
            ),
        ).combined;
    const baseline = simulate();
    for (const {id:preset} of JSON.parse(fs.readFileSync(new URL('../docs/assets/workshop/drivers.json',import.meta.url)))) {
        const p = plain(project);
        const g = p.geometry.project.drivers[0];
        g.preset = preset;
        // Each package has its own outlet axis. Use a feasible straight route;
        // reusing the RAF bend behind other receivers now correctly fails placement.
        const catalog = JSON.parse(fs.readFileSync(new URL('../docs/assets/workshop/drivers.json', import.meta.url)));
        const s = catalog.find(s => s.id === preset);
        g.bend_mm = s.outlet_mm.map((x, i) => x + s.outlet_axis[i] * 6);
        g.end_mm = s.outlet_mm.map((x, i) => x + s.outlet_axis[i] * 12);
        const built = JSON.parse(
            engine.workshop_build_json(
                JSON.stringify(p.geometry.project),
                JSON.stringify(p.geometry.shell),
            ),
        );
        assert.deepEqual(built.paths[0].placement_errors, [], `preset ${preset}: feasible geometry`);
        const linked = synchronize(link(p), built.paths).project;
        app.state.drivers = plain(linked.acoustics.drivers);
        const linkedResponse = simulate();
        assert.ok(
            linkedResponse.every((p) => Number.isFinite(p.db)),
            `preset ${preset}: finite response`,
        );
        assert.ok(
            linkedResponse.some(
                (p, i) => Math.abs(p.db - baseline[i].db) > 0.01,
            ),
            `preset ${preset}: geometry changes response`,
        );
        app.state.drivers = plain(project.acoustics.drivers);
        app.state.drivers[0].path[0].length = built.paths[0].length_mm;
        app.state.drivers[0].path[0].diameter =
            p.geometry.project.drivers[0].inner_diameter_mm;
        app.state.drivers[0].referenceValidationMode = false;
        assert.deepEqual(
            linkedResponse,
            simulate(),
            `preset ${preset}: identical to manual acoustic dimensions`,
        );
    }
});
