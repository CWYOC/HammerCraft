import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { createProject, validateSource, validateProject, faceId, fingerprint, isCurrent, ProjectHistory } from "../docs/engineering/project.mjs";
import { dimensions, quantity } from "../docs/engineering/units.mjs";
import { solveThermal, makeResult, summarize, sampleTemperature } from "../docs/engineering/thermal.mjs";
import { analyticalTemperature } from "../docs/engineering/thermal-boundaries.mjs";
import { runConvergence, convergenceRows } from "../docs/engineering/convergence.mjs";
import { runSweep } from "../docs/engineering/sweep.mjs";
import { createMeasurement } from "../docs/engineering/measurement-data.mjs";
import { compareMeasurement } from "../docs/engineering/measurement.mjs";

const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} ≈ ${b} within ${tolerance}`);
const solve = (p, id = "thermal") => makeResult(p, solveThermal(p.source), id, "2026-10-07T12:00:00Z");
function example(axis = 0, coefficients = [100, 200], q = 0) {
  const p = createProject("convection-project");
  p.source.physics[0].boundaries = coefficients.map((h, side) => ({ entityId: faceId("body-block", axis, side),
    ...(h === null ? { type: "temperature", expression: side ? "20 degC" : "80 degC" }
      : { type: "convection", ambient: side ? "20 degC" : "80 degC", coefficient: `${h} W/(m^2*K)` }) }));
  p.source.physics[0].heatGeneration = `${q} W/m^3`;
  return p;
}

test("convection coefficients use heat-transfer dimensions and reject invalid edits transactionally", () => {
  assert.equal(quantity("100 W/(m^2*K)", dimensions.heatTransfer), 100);
  const p = example(), history = new ProjectHistory(p), before = structuredClone(history.project);
  for (const value of ["0 W/(m^2*K)", "-1 W/(m^2*K)", "1e-7 W/(m^2*K)", "1e9 W/(m^2*K)", "20 W/(m*K)", "5 V", "missing"]) {
    const source = structuredClone(p.source); source.physics[0].boundaries[0].coefficient = value;
    assert.throws(() => history.update(source)); assert.deepEqual(history.project, before);
  }
  for (const value of ["-1 K", "6000 K", "2 mm"]) {
    const source = structuredClone(p.source); source.physics[0].boundaries[0].ambient = value;
    assert.throws(() => validateSource(source));
  }
  p.source.physics[0].boundaries[1].entityId = faceId("body-block", 1, 1);
  assert.throws(() => validateSource(p.source), /same axis/);
});

test("existing fixed-temperature sources keep their canonical serialization and boundary IDs", () => {
  const p = createProject("legacy"), raw = JSON.stringify(p.source);
  assert.equal(fingerprint(p.source), raw);
  assert.deepEqual(Object.keys(validateSource(p.source).source.physics[0].boundaries[0]), ["entityId", "type", "expression"]);
  const r = solve(p); p.results = [r];
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))).results[0], r);
  near(summarize(r).heatOut[1], 33.4);
});

test("one convective film matches an independent resistance-network solution on either side in XYZ", () => {
  for (const axis of [0, 1, 2]) for (const coefficients of [[null, 100], [100, null]]) {
    const p = example(axis, coefficients), r = solve(p), summary = summarize(r), L = [0.06, 0.02, 0.01][axis],
      area = 0.06 * 0.02 * 0.01 / L, flux = 60 / (L / 167 + 1 / 100),
      left = 353.15 - (coefficients[0] === null ? 0 : flux / 100),
      right = 293.15 + (coefficients[1] === null ? 0 : flux / 100);
    near(summary.heatOut[0], -area * flux); near(summary.heatOut[1], area * flux);
    near(summary.boundaryTemperatures[0], left); near(summary.boundaryTemperatures[1], right);
    const { cells } = summary.model, stride = [1, cells[0], cells[0] * cells[1]][axis];
    r.temperatures.forEach((t, i) => near(t, left - flux / 167 * (Math.floor(i / stride) % cells[axis] + 0.5) * L / cells[axis]));
  }
});

test("two films match combined wall resistance and exclude ambient values from solid extrema", () => {
  for (const axis of [0, 1, 2]) {
    const p = example(axis), r = solve(p), s = summarize(r), L = [0.06, 0.02, 0.01][axis], area = 1.2e-5 / L,
      rate = 60 / (1 / (100 * area) + L / (167 * area) + 1 / (200 * area)),
      left = 353.15 - rate / (100 * area), right = 293.15 + rate / (200 * area);
    near(s.max, left); near(s.min, right); near(s.heatOut[1], rate); near(s.balanceError, 0);
    assert.ok(s.min > 293.15 + 10); assert.ok(s.max < 353.15 - 10);
    near(analyticalTemperature(s.model, 0), left); near(analyticalTemperature(s.model, L), right);
    near(analyticalTemperature(s.model, L / 2), (left + right) / 2);
  }
});

test("equal ambient temperatures reach equilibrium independently of film coefficient", () => {
  const p = example(0, [20, 500]);
  p.source.physics[0].boundaries.forEach((b) => b.ambient = "25 degC");
  const r = solve(p), s = summarize(r);
  r.temperatures.forEach((t) => near(t, 298.15, 1e-10));
  s.heatOut.forEach((q) => near(q, 0, 1e-10));
  assert.equal(r.iterations, 0);
});

test("symmetric generated heat leaves both films equally and refines toward the independent quadratic solution", () => {
  for (const axis of [0, 1, 2]) {
    const q = 2e5, h = 500, p = example(axis, [h, h], q), L = [0.06, 0.02, 0.01][axis];
    p.source.physics[0].boundaries.forEach((b) => b.ambient = "20 degC");
    const record = runConvergence(p, { baseCells: [6, 3, 3], levels: 3, temperatureTolerance: 0.1, heatTolerance: 0.01 }, `generated-${axis}`);
    const rows = convergenceRows(record), surface = 293.15 + q * L / (2 * h);
    for (const row of rows) {
      assert.equal(row.status, "Completed");
      row.summary.heatOut.forEach((rate) => near(rate, q * 1.2e-5 / 2));
      row.summary.boundaryTemperatures.forEach((t) => near(t, surface));
      const dx = L / row.cells[axis], error = q * dx * dx / (8 * 167);
      near(row.analyticalError, error, 2e-6);
      const stride = [1, row.cells[0], row.cells[0] * row.cells[1]][axis];
      row.result.temperatures.forEach((t, i) => {
        const x = (Math.floor(i / stride) % row.cells[axis] + 0.5) * dx;
        near(t, surface + q * x * (L - x) / (2 * 167) + error, 2e-6);
      });
    }
    near(rows[0].analyticalError / rows[1].analyticalError, 4, 1e-3);
  }
});

test("asymmetric films and generated heat satisfy the independent endpoint energy equations", () => {
  const p = example(0, [100, 400], 1e5), r = solve(p), s = summarize(r), L = 0.06, k = 167, q = 1e5,
    leftFlux = (-60 + q * L / 400 + q * L * L / (2 * k)) / (1 / 100 + 1 / 400 + L / k), rightFlux = q * L - leftFlux;
  near(s.heatOut[0], leftFlux * 0.0002); near(s.heatOut[1], rightFlux * 0.0002);
  near(s.boundaryTemperatures[0], 353.15 + leftFlux / 100); near(s.boundaryTemperatures[1], 293.15 + rightFlux / 400);
  near(s.heatOut[0] + s.heatOut[1], 1.2);
});

test("face and corner probes use local solved surface temperatures instead of ambient temperatures", () => {
  for (const axis of [0, 1, 2]) {
    const r = solve(example(axis)), s = summarize(r), size = s.model.size;
    for (const side of [0, 1]) for (const transverse of [0, 0.37, 1]) {
      const point = size.map((v, i) => i === axis ? side * v : transverse * v);
      near(sampleTemperature(r, point), s.boundaryTemperatures[side], 1e-6);
    }
    near(sampleTemperature(r, size.map((v) => v / 2)), (s.boundaryTemperatures[0] + s.boundaryTemperatures[1]) / 2);
  }
});

test("high film coefficients approach prescribed-temperature heat flow without treating ambient as a surface", () => {
  const r = solve(example(0, [1e8, 1e8])), s = summarize(r), expected = 60 * 0.0002 / (0.06 / 167 + 2e-8);
  near(s.heatOut[1], expected); assert.ok(s.boundaryTemperatures[1] > 293.15);
  assert.ok(33.4 - expected < 0.002);
});

test("extremely weak cooling and excessive sinks fail explicitly if numerical or physical limits are exceeded", () => {
  assert.throws(() => solve(example(0, [1e-6, 2e-6])), /did not converge/);
  assert.throws(() => solve(example(0, [100, 100], -1e12)), /absolute temperatures/);
});

test("parameter sweeps can vary a dimensional film coefficient through the existing solver", () => {
  const p = example(0, [null, 100]);
  p.source.parameters.push({ id: "cooling", name: "cooling", expression: "100 W/(m^2*K)" });
  p.source.physics[0].boundaries[1].coefficient = "cooling";
  const record = runSweep(p, { parameterId: "cooling", start: "50 W/(m^2*K)", end: "200 W/(m^2*K)", samples: 4, objective: "heat-out" }, "cooling-sweep");
  for (const row of record.rows) {
    assert.equal(row.status, "Completed");
    const h = 50 + row.index * 50;
    near(row.metrics.heatOutMax, 60 * 0.0002 / (0.06 / 167 + 1 / h));
    near(row.metrics.maxTemperature, 353.15);
  }
  assert.equal(validateProject({ ...p, sweeps: [record] }).sweeps.length, 1);
});

test("measurement comparisons include the convective solid surface at the endpoints", () => {
  const p = example(), r = solve(p), flux = 60 / (0.06 / 167 + 0.01 + 0.005), left = 80 - flux / 100, right = 20 + flux / 200;
  const m = createMeasurement(`x,y\n0,${left}\n30,${(left + right) / 2}\n60,${right}`, { delimiter: ",", header: true, xColumn: 0, yColumn: 1,
    x: { quantity: "position", unit: "mm" }, y: { quantity: "temperature", unit: "degC" }, positionAxis: 0 }, "Surface test", "surface.csv", "surface");
  near(compareMeasurement(m, r).metrics.rmse, 0);
});

test("convection settings round trip, preserve imported result status, and invalidate results through undoable edits", () => {
  const p = example(), r = solve(p); p.results = [r];
  const original = validateProject(JSON.parse(JSON.stringify(p))), imported = validateProject(original, { imported: true });
  assert.deepEqual(original.results[0], r); assert.equal(imported.results[0].verified, false);
  const h = new ProjectHistory(original), changed = structuredClone(p.source); changed.physics[0].boundaries[1].coefficient = "300 W/(m^2*K)";
  h.update(changed); assert.equal(isCurrent(h.project, r), false); h.undo(); assert.equal(isCurrent(h.project, r), true);
  assert.equal(h.project.source.physics[0].boundaries[1].coefficient, "200 W/(m^2*K)");
});

test("the real thermal worker solves convection and returns reproducible source provenance", async () => {
  const workerURL = new URL("../docs/engineering/worker.mjs", import.meta.url).href;
  const worker = new Worker(`const {parentPort}=require('node:worker_threads'); global.self={postMessage:(data)=>parentPort.postMessage(data)};
    import(${JSON.stringify(workerURL)}).then(()=>parentPort.on('message',(data)=>self.onmessage({data})));`, { eval: true });
  const p = example();
  try {
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error("Worker timed out")), 15000);
      worker.on("error", (error) => { clearTimeout(timeout); reject(error); });
      worker.on("message", (data) => { if (data.state === "Failed") { clearTimeout(timeout); reject(Error(data.error)); }
        if (data.state === "Completed") { clearTimeout(timeout); resolve(data.result); } });
      worker.postMessage({ id: "convective-worker", action: "solve", project: p });
    });
    near(summarize(result).heatOut[1], 60 * 0.0002 / (0.01 + 0.06 / 167 + 0.005));
    assert.deepEqual(result.provenance.source, validateSource(p.source).source);
    assert.equal(validateProject({ ...p, results: [result] }).results.length, 1);
  } finally { await worker.terminate(); }
});
