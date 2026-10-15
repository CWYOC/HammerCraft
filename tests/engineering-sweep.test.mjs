import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { createProject, validateProject, validateSource, fingerprint, isCurrent, ProjectHistory } from "../docs/engineering/project.mjs";
import { evaluate } from "../docs/engineering/units.mjs";
import { createSweep, runSweep } from "../docs/engineering/sweep.mjs";
import { resolveSweep, sweepValue, sweepSource, bestSweepRow, sweepFeasible, siExpression, sweepCSV } from "../docs/engineering/sweep-data.mjs";
import { JobManager } from "../docs/engineering/jobs.mjs";
import { makeResult, solveThermal, summarize } from "../docs/engineering/thermal.mjs";

const example = () => createProject("sweep-project");
const setup = (changes = {}) => ({ parameterId: "p-length", start: "30 mm", end: "120 mm", samples: 7,
  objective: "mass", maxTemperature: "", maxMass: "", ...changes });
const near = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);

test("sweep sampling resolves base expressions, includes both endpoints, and preserves dimensions", () => {
  const p = example(), settings = setup({ start: "length / 2", end: "length * 2" });
  const spec = resolveSweep(p.source, settings);
  near(spec.start, 0.03); near(spec.end, 0.12);
  assert.equal(sweepValue(p.source, settings, 0).value, spec.start);
  assert.equal(sweepValue(p.source, settings, 6).value, spec.end);
  near(validateSource(sweepSource(p.source, settings, 3)).size[0], 0.075);
  assert.equal(p.source.parameters[0].expression, "60 mm");
  for (const expression of ["25 degC", "100 W/(m*K)", "2.3 kg/m^3", "-3", "5 m^0.5"]) {
    const q = evaluate(expression), roundtrip = evaluate(siExpression(q.value, q.dim));
    assert.deepEqual(roundtrip.dim, q.dim);
    near(roundtrip.value, q.value);
  }
});

test("invalid sweep setup rejects units, ranges, sample counts, objectives, and constraints", () => {
  for (const changes of [{ parameterId: "missing" }, { start: "30 kg" }, { end: "20 mm" }, { end: "30 mm" },
    { samples: 1 }, { samples: 22 }, { samples: 2.5 }, { objective: "__proto__" }, { maxMass: "30 mm" },
    { maxMass: "0 kg" }, { maxTemperature: "-1 K" }, { maxTemperature: "2 W" }])
    assert.throws(() => resolveSweep(example().source, setup(changes)));
  assert.throws(() => sweepValue(example().source, setup(), 7), /index/);
  const p = example();
  p.source.features.push({ id: "hole", bodyId: "body-block", type: "through-hole", name: "Hole", axis: 2,
    center: ["length/2", "width/2"], diameter: "3 mm", suppressed: false });
  assert.throws(() => createSweep(p, setup(), "bad-geometry"), /uncut block/);
});

test("all sweep rows agree with independent slab heat flow, mass and energy balance", () => {
  const p = example(), before = structuredClone(p), progress = [], record = runSweep(p, setup(), "analytical", (e) => progress.push(e));
  assert.deepEqual(p, before);
  assert.equal(record.status, "Completed");
  assert.equal(progress.filter((e) => e.row).length, 7);
  assert.equal(record.rows.length, 7);
  for (const row of record.rows) {
    assert.equal(row.status, "Completed");
    const L = (30 + 15 * row.index) / 1000;
    near(row.metrics.mass, L * 0.02 * 0.01 * 2700);
    near(row.metrics.heatOutMax, 167 * 0.02 * 0.01 * 60 / L);
    near(row.metrics.heatOutMin, -row.metrics.heatOutMax);
    near(row.metrics.balanceError, 0);
    near(row.metrics.minTemperature, 293.15);
    near(row.metrics.maxTemperature, 353.15);
    assert.ok(row.residual <= 5e-10);
  }
  assert.equal(bestSweepRow(record).index, 0);
  assert.ok(isCurrent(p, record));
});

test("dependent dimensions and parameterized material/physics regenerate for each candidate", () => {
  const p = example();
  p.source.parameters[1].expression = "length/2";
  let record = runSweep(p, setup({ samples: 3 }), "dependent");
  for (const row of record.rows) {
    const L = sweepValue(p.source, record.settings, row.index).value;
    near(row.metrics.mass, L * (L / 2) * 0.01 * 2700);
    near(row.metrics.heatOutMax, 167 * 0.005 * 60);
  }
  p.source.parameters.push({ id: "p-k", name: "conductivity", expression: "100 W/(m*K)" });
  p.source.materials[0].conductivity = "conductivity";
  record = runSweep(p, setup({ parameterId: "p-k", start: "100 W/(m*K)", end: "400 W/(m*K)", samples: 3, objective: "heat-out" }), "material");
  assert.equal(bestSweepRow(record).index, 2);
  near(record.rows[2].metrics.heatOutMax / record.rows[0].metrics.heatOutMax, 4);
  p.source.parameters.push({ id: "p-hot", name: "hot", expression: "80 degC" });
  p.source.physics[0].boundaries[0].expression = "hot";
  record = runSweep(p, setup({ parameterId: "p-hot", start: "20 degC", end: "80 degC", samples: 3, objective: "temperature" }), "temperature");
  assert.equal(bestSweepRow(record).index, 0);
  near(record.rows[0].metrics.maxTemperature, 293.15);
  near(record.rows[2].metrics.maxTemperature, 353.15);
});

test("constraints filter ranked samples, include equality and explicitly represent no feasible design", () => {
  const record = runSweep(example(), setup({ parameterId: "p-width", start: "10 mm", end: "30 mm", samples: 5,
    objective: "heat-out", maxMass: "32.4 g", maxTemperature: "80 degC" }), "constraints");
  assert.deepEqual(record.rows.map((r) => sweepFeasible(record, r)), [true, true, true, false, false]);
  assert.equal(bestSweepRow(record).index, 2);
  record.settings.maxMass = "1 g";
  assert.equal(bestSweepRow(record), null);
  record.settings.maxMass = "";
  record.settings.maxTemperature = "79 degC";
  assert.equal(bestSweepRow(record), null);
});

test("invalid geometry and failed solves become diagnostic rows and do not stop remaining samples", () => {
  const record = runSweep(example(), setup({ start: "-10 mm", end: "10 mm", samples: 3 }), "invalid-shapes");
  assert.deepEqual(record.rows.map((r) => r.status), ["Failed", "Failed", "Completed"]);
  assert.match(record.rows[0].error, /dimensions/i);
  assert.equal(bestSweepRow(record).index, 2);
  const p = example();
  p.source.parameters.push({ id: "p-q", name: "generation", expression: "0 W/m^3" });
  p.source.physics[0].heatGeneration = "generation";
  const sink = runSweep(p, setup({ parameterId: "p-q", start: "-1e12 W/m^3", end: "0 W/m^3", samples: 2 }), "bad-physics");
  assert.equal(sink.rows[0].status, "Failed");
  assert.match(sink.rows[0].error, /negative|absolute/i);
  assert.equal(sink.rows[1].status, "Completed");
  assert.equal(validateProject({ ...p, sweeps: [sink] }).sweeps[0].rows.length, 2);
});

test("apply restores the entire source snapshot, is undoable, and a fresh solve reproduces the selected metrics", () => {
  const p = example(), h = new ProjectHistory(p), record = runSweep(p, setup(), "apply");
  h.addSweep(record);
  const other = structuredClone(p.source);
  other.features[0].materialId = "copper";
  other.physics[0].boundaries[0].expression = "100 degC";
  h.update(other);
  assert.equal(isCurrent(h.project, record), false);
  const selected = sweepSource(record.provenance.source, record.settings, 6);
  h.update(selected);
  const sum = summarize(makeResult(h.project, solveThermal(h.project.source), "resolved"));
  near(sum.mass, record.rows[6].metrics.mass);
  near(sum.heatOut[1], record.rows[6].metrics.heatOutMax);
  assert.equal(h.project.source.features[0].materialId, "aluminum");
  h.undo();
  assert.equal(fingerprint(h.project.source), fingerprint(other));
  h.redo();
  assert.equal(fingerprint(h.project.source), record.rows[6].fingerprint);
  assert.equal(h.project.sweeps.length, 1);
});

test("old projects remain compatible; portable sweeps retain inputs and reset imported verification", () => {
  const p = example(), original = fingerprint(p.source);
  delete p.sweeps;
  assert.deepEqual(validateProject(p).sweeps, []);
  p.sweeps = [runSweep(p, setup(), "portable")];
  const saved = validateProject(JSON.parse(JSON.stringify(p)));
  assert.equal(saved.sweeps[0].verified, true);
  assert.equal(fingerprint(saved.source), original);
  const imported = validateProject(JSON.parse(JSON.stringify(p)), { imported: true });
  assert.equal(imported.sweeps[0].verified, false);
  assert.deepEqual(imported.sweeps[0].rows, saved.sweeps[0].rows);
  const h = new ProjectHistory(p);
  for (let i = 0; i < 6; i++) h.addSweep({ ...p.sweeps[0], id: `retained-${i}` });
  assert.deepEqual(h.project.sweeps.map((s) => s.id), [1, 2, 3, 4, 5].map((n) => `retained-${n}`));
});

test("corrupted sweep provenance, ordering, metrics and termination counts are rejected", () => {
  const p = example(); p.sweeps = [runSweep(p, setup({ samples: 3 }), "checked")];
  for (const mutate of [
    (s) => { s.provenance.fingerprint = "wrong"; },
    (s) => { s.provenance.settings.relativeTolerance = 1; },
    (s) => { s.rows[0].fingerprint = s.rows[1].fingerprint; },
    (s) => { s.rows[0].index = 2; },
    (s) => { s.rows[0].metrics.mass = NaN; },
    (s) => { s.rows[0].residual = 1; },
    (s) => { s.rows.pop(); },
  ]) {
    const copy = structuredClone(p); mutate(copy.sweeps[0]);
    assert.throws(() => validateProject(copy));
  }
  const partial = structuredClone(p);
  partial.sweeps[0].status = "Cancelled";
  partial.sweeps[0].rows.splice(1);
  assert.equal(validateProject(partial).sweeps[0].rows.length, 1);
});

test("sweep CSV exports physical units and diagnostics and escapes spreadsheet expressions", () => {
  const record = runSweep(example(), setup({ start: "-10 mm", end: "+10 mm", samples: 3 }), "csv");
  const csv = sweepCSV(record);
  assert.match(csv, /"mass_kg"/); assert.match(csv, /"max_temperature_K"/);
  assert.match(csv, /"relative_residual"/); assert.match(csv, /"sweep_id"/);
  assert.equal(csv.split("\r\n").length, 4);
  assert.match(csv, /"Failed"/); assert.match(csv, /"'-10 mm"/); assert.match(csv, /"'\+10 mm"/);
});

test("job options are immutable, cancellation identifies the sweep and late candidate messages are ignored", () => {
  let worker;
  const events = [], p = example(), settings = setup(), jobs = new JobManager((e) => events.push(e), () =>
    (worker = { postMessage(data) { this.request = data; }, terminate() { this.terminated = true; } }));
  const id = jobs.start("sweep", p, { sweep: settings });
  settings.end = "200 mm"; p.source.parameters[0].expression = "100 mm";
  assert.equal(worker.request.options.sweep.end, "120 mm");
  assert.equal(worker.request.project.source.parameters[0].expression, "60 mm");
  worker.onmessage({ data: { id, state: "Sweeping", row: { index: 0 } } });
  jobs.cancel();
  assert.equal(events.at(-1).action, "sweep");
  const count = events.length;
  worker.onmessage({ data: { id, state: "Completed", sweep: {} } });
  assert.equal(events.length, count);
  assert.equal(worker.terminated, true);
});

test("real module worker emits each candidate and a complete reproducible sweep", { timeout: 10000 }, async () => {
  const url = new URL("../docs/engineering/worker.mjs", import.meta.url).href;
  const worker = new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:data=>parentPort.postMessage(data)};import(${JSON.stringify(url)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`, { eval: true });
  const progress = [];
  try {
    const record = await new Promise((resolve, reject) => {
      worker.on("error", reject);
      worker.on("message", (data) => {
        if (data.state === "Failed") reject(Error(data.error));
        if (data.row) progress.push(data.row);
        if (data.state === "Completed") resolve(data.sweep);
      });
      worker.postMessage({ id: "worker-sweep", action: "sweep", project: example(), options: { sweep: setup() } });
    });
    assert.equal(progress.length, 7);
    assert.deepEqual(progress, record.rows);
    assert.equal(validateProject({ ...example(), sweeps: [record] }).sweeps[0].status, "Completed");
    near(record.rows[0].metrics.heatOutMax, 66.8);
    near(record.rows[6].metrics.heatOutMax, 16.7);
  } finally { await worker.terminate(); }
});
