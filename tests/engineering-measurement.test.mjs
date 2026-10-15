import test from "node:test";
import assert from "node:assert/strict";
import { createProject, validateProject, ProjectHistory, isCurrent, faceId } from "../docs/engineering/project.mjs";
import { solveThermal as solveField, makeResult, summarize } from "../docs/engineering/thermal.mjs";
import { parseMeasurementTable, createMeasurement, validateMeasurement, resolveMeasurement, displayValue, measurementCSV, MAX_MEASUREMENT_BYTES, XY_QUANTITIES } from "../docs/engineering/measurement-data.mjs";
import { compareMeasurement, interpolateProfile, measurementComparisonCSV } from "../docs/engineering/measurement.mjs";
import { JobManager } from "../docs/engineering/jobs.mjs";
import { solutionLabel } from "../docs/engineering/measurement-view.mjs";

const mapping = (change = {}) => ({ delimiter: ",", header: true, xColumn: 0, yColumn: 1,
  x: { quantity: "position", unit: "mm" }, y: { quantity: "temperature", unit: "degC" }, positionAxis: 0, ...change });
const measurement = (csv = "position,temperature\n0,80\n30,50\n60,20", change = {}, id = "measured") =>
  createMeasurement(csv, mapping(change), "Thermocouple profile", "profile.csv", id, "2026-10-07T12:00:00Z");
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} ≈ ${b}`);
const solveThermal = (project, id) => makeResult(project, solveField(project.source), id);

test("CSV reader handles BOM, CRLF, escaped quotes, embedded delimiters/newlines and blank lines", () => {
  assert.deepEqual(parseMeasurementTable('\ufeff"x, position","T"\r\n\r\n"0","80"\r\n"a""b\nc",20'), [["x, position", "T"], ["0", "80"], ['a"b\nc', "20"]]);
  assert.deepEqual(parseMeasurementTable("x;y\n0;80\n", ";"), [["x", "y"], ["0", "80"]]);
  assert.deepEqual(parseMeasurementTable("x\ty\r0\t80", "\t"), [["x", "y"], ["0", "80"]]);
  for (const invalid of ['x,y\n"1,2', 'x,y\n"1"z,2', 'x,y\n1"2,3', 'x,y\n1,2,3', "x", "", "\0x,y", "\ufffd,y"])
    assert.throws(() => parseMeasurementTable(invalid));
  assert.throws(() => parseMeasurementTable("x|y", "|"));
});

test("measurement import maps arbitrary columns, converts units and preserves source ordering and duplicates", () => {
  const m = measurement("memo,temp,position\nlater,20,60\nearly,80,0\nrepeat,81,0", { xColumn: 2, yColumn: 1 });
  const data = resolveMeasurement(m);
  assert.deepEqual(data.points.map((p) => p.x), [0.06, 0, 0]);
  near(data.points[0].y, 293.15); near(data.points[2].y, 354.15);
  assert.deepEqual(data.points.map((p) => p.record), [2, 3, 4]);
  near(displayValue(data.points[0].y, mapping().y), 20);
  const noHeader = measurement("1e-3;2e1\n2e-3;3e1", { header: false, delimiter: ";", x: { quantity: "position", unit: "m" } });
  assert.equal(resolveMeasurement(noHeader).points[0].x, 0.001);
});

test("quantity catalog uses engineering units, including generic frequency, force, impedance and flow", () => {
  for (const [quantity, specification] of Object.entries(XY_QUANTITIES)) for (const unit of specification.units) {
    const m = measurement("x,y\n1,2", { x: { quantity, unit }, y: { quantity, unit }, positionAxis: quantity === "position" ? 0 : null });
    const p = resolveMeasurement(m).points[0]; near(displayValue(p.x, m.mapping.x), 1); near(displayValue(p.y, m.mapping.y), 2);
  }
  const m = measurement("frequency,Z\n1,8\n2,10", { x: { quantity: "frequency", unit: "kHz" }, y: { quantity: "impedance", unit: "ohm" }, positionAxis: null });
  assert.equal(resolveMeasurement(m).points[0].x, 1000);
  assert.equal(compareMeasurement(m, solveThermal(createProject(), "generic")).compatible, false);
  assert.throws(() => measurement("x,y\n1,2", { x: { quantity: "position", unit: "V" } }), /compatible unit/);
  assert.throws(() => measurement("x,y\n1,2", { y: { quantity: "__proto__", unit: "1" } }));
});

test("invalid selected numbers and invalid mapping reject the complete dataset", () => {
  for (const bad of ["", "NaN", "Infinity", "1e999", "1e101", "0x10", "5 V", "=1+1", "1,2", "-274"])
    assert.throws(() => measurement(`x,y\n0,80\n1,"${bad}"`));
  for (const change of [{ xColumn: 1 }, { xColumn: -1 }, { yColumn: 7 }, { header: "yes" }, { positionAxis: 4 }])
    assert.throws(() => measurement(undefined, change));
  assert.throws(() => measurement("x,y"), /1–5,000/);
  const m = measurement(); m.mapping.y.unit = "K"; m.csv = "x,y\n0,-1";
  assert.throws(() => validateMeasurement(m), /negative/);
});

test("file, column and point limits reject oversized input and accept the boundary", () => {
  assert.throws(() => parseMeasurementTable("x".repeat(MAX_MEASUREMENT_BYTES + 1)), /256 KiB/);
  assert.throws(() => parseMeasurementTable(Array(33).fill("0").join(",")), /32 columns/);
  const csv = "x,y\n" + Array(5000).fill("0,20").join("\n");
  assert.equal(resolveMeasurement(measurement(csv)).points.length, 5000);
  assert.throws(() => measurement(csv + "\n0,20"), /5,000/);
});

test("independent linear benchmark gives exact error statistics, including repeated measurements", () => {
  const p = createProject("comparison"), result = solveThermal(p, "line");
  // Known simulated values 80,50,20,50 °C; errors -1,2,-3,2 K.
  const m = measurement("x,y\n0,81\n30,48\n60,23\n30,48\n-1,100\n61,10");
  const compared = compareMeasurement(m, result);
  assert.equal(compared.count, 4); assert.equal(compared.excluded, 2);
  near(compared.metrics.rmse, Math.sqrt(4.5)); near(compared.metrics.mae, 2);
  near(compared.metrics.bias, 0); near(compared.metrics.max, 3);
  assert.equal(compared.rows[4].predicted, null); assert.equal(compared.rows[5].error, null);
  near(compareMeasurement(measurement(), result).metrics.rmse, 0);
});

test("position bounds and matching model axes are enforced without extrapolation", () => {
  for (const axis of [0, 1, 2]) {
    const p = createProject(), length = [60, 20, 10][axis];
    p.source.physics[0].boundaries.forEach((b, i) => { b.entityId = faceId("body-block", axis, i); });
    const r = solveThermal(p, `axis-${axis}`), m = measurement(`x,y\n0,80\n${length / 2},50\n${length},20`, { positionAxis: axis });
    near(compareMeasurement(m, r).metrics.rmse, 0);
    m.mapping.positionAxis = (axis + 1) % 3;
    assert.equal(compareMeasurement(m, r).compatible, false);
  }
  const c = compareMeasurement(measurement("x,y\n-1,20\n100,30"), solveThermal(createProject(), "out"));
  assert.equal(c.count, 0); assert.equal(c.excluded, 2); assert.equal(c.metrics, null);
});

test("interpolation uses solved fields and exact segment endpoints, including heated coarse grids", () => {
  assert.equal(interpolateProfile([[0, 10], [1, 30], [2, 20]], 0.5), 20);
  assert.equal(interpolateProfile([[0, 10], [1, 30], [2, 20]], 2), 20);
  assert.equal(interpolateProfile([[0, 10], [1, 30]], 1.01), null);
  const p = createProject(); p.source.physics[0].heatGeneration = "1e7 W/m^3"; p.source.meshes[0].cells = [6, 3, 3];
  const r = solveThermal(p, "heated"), profile = summarize(r).profile, x = profile[1][0];
  const m = measurement(`x,y\n${x},0`, { x: { quantity: "position", unit: "m" } });
  near(compareMeasurement(m, r).rows[0].predicted, profile[1][1]);
  const exact = 353.15 - 60 * x / 0.06 + 1e7 * x * (0.06 - x) / (2 * 167);
  assert.ok(Math.abs(compareMeasurement(m, r).rows[0].predicted - exact) > 0.7);
});

test("metrics stay tied to the saved solution after geometry edits and imported results retain their status", () => {
  const p = createProject("saved"), r = solveThermal(p, "retained"), m = measurement();
  p.results = [r]; p.measurements = [m];
  const imported = validateProject(JSON.parse(JSON.stringify(p)), { imported: true });
  assert.equal(imported.results[0].verified, false);
  assert.deepEqual(imported.measurements[0], m);
  imported.source.parameters[0].expression = "120 mm";
  assert.equal(isCurrent(imported, imported.results[0]), false);
  near(compareMeasurement(m, imported.results[0]).metrics.rmse, 0);
  assert.match(measurementComparisonCSV(m, imported.results, imported), /"false","false"/);
});

test("project compatibility and measurement validation preserve raw data and reject tampered mappings", () => {
  const p = createProject(); delete p.measurements;
  assert.deepEqual(validateProject(p).measurements, []);
  p.measurements = [measurement()];
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))).measurements, p.measurements);
  for (const mutate of [(m) => m.mapping.x.unit = "V", (m) => m.id = "bad/id", (m) => m.importedAt = "nonsense", (m) => m.csv = "broken", (m) => m.format = "future"] ) {
    const copy = structuredClone(p); mutate(copy.measurements[0]); assert.throws(() => validateProject(copy));
  }
  assert.throws(() => validateProject({ ...p, measurements: [p.measurements[0], p.measurements[0]] }), /unique/);
  assert.throws(() => validateProject({ ...p, measurements: Array(7).fill(p.measurements[0]) }), /six/);
});

test("adding and removing datasets is undoable across geometry edits without making saved physics stale", () => {
  const p = createProject(), r = solveThermal(p, "history"); p.results = [r];
  const h = new ProjectHistory(p), m = measurement();
  h.setMeasurements([m]); assert.equal(isCurrent(h.project, r), true);
  const changed = structuredClone(h.project.source); changed.parameters[0].expression = "120 mm"; h.update(changed);
  h.setMeasurements([]); h.undo(); assert.equal(h.project.measurements.length, 1); assert.equal(isCurrent(h.project, r), false);
  h.undo(); assert.equal(isCurrent(h.project, r), true); assert.equal(h.project.measurements.length, 1);
  h.undo(); assert.equal(h.project.measurements.length, 0);
  h.redo(); h.redo(); h.redo(); assert.equal(h.project.measurements.length, 0);
  assert.throws(() => h.setMeasurements([{ ...m, csv: "bad" }])); assert.equal(h.project.measurements.length, 0);
});

test("SI exports include provenance, formula-safe text and excluded points without invented predictions", () => {
  const m = measurement("x,y\n0,80\n61,20"); m.name = '=cmd,"quoted"';
  const csv = measurementCSV(m), table = parseMeasurementTable(csv);
  assert.equal(table[1][4], '\'=cmd,"quoted"'); assert.equal(Number(table[1][1]), 353.15);
  const p = createProject("export"); p.results = [solveThermal(p, "r1"), solveThermal(p, "r2")];
  const rows = parseMeasurementTable(measurementComparisonCSV(m, p.results, p));
  assert.equal(rows.length, 5); assert.equal(rows[2][5], ""); assert.equal(rows[2][6], ""); assert.equal(rows[2][7], "outside-solved-domain");
  assert.equal(rows[1][8], "r1"); assert.equal(rows[3][8], "r2");
  assert.throws(() => measurementComparisonCSV(m, [], p), /Select/);
});

test("workers do not receive raw measurement files", () => {
  let posted;
  const worker = { postMessage: (data) => { posted = data; }, terminate() {} };
  const jobs = new JobManager(() => {}, () => worker), p = createProject(); p.measurements = [measurement()];
  jobs.start("solve", p);
  assert.deepEqual(posted.project.measurements, []); assert.equal(p.measurements.length, 1);
  jobs.cancel();
});

test("overlay labels distinguish repeated solves and preserve current and imported status", () => {
  const p = createProject(); p.results = [solveThermal(p, "first"), solveThermal(p, "repeat")];
  assert.match(solutionLabel(p.results[0], p), /^#1 · r0 .*current inputs$/);
  assert.match(solutionLabel(p.results[1], p), /^#2 · r0 .*current inputs$/);
  p.results[0].verified = false;
  assert.match(solutionLabel(p.results[0], p), /imported \/ unverified$/);
  p.source.parameters[0].expression = "120 mm";
  assert.match(solutionLabel(p.results[1], p), /earlier inputs$/);
});
