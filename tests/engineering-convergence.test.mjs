import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { createProject, validateProject, fingerprint, isCurrent, ProjectHistory, faceId } from "../docs/engineering/project.mjs";
import { refinementSettings, refinementSource } from "../docs/engineering/convergence-data.mjs";
import { createConvergence, runConvergence, convergenceRows, convergenceAssessment, convergenceCSV, profileDifference } from "../docs/engineering/convergence.mjs";
import { JobManager } from "../docs/engineering/jobs.mjs";

const example = () => createProject("mesh-check-project");
const setup = (changes = {}) => ({ baseCells: [6, 3, 3], levels: 3, temperatureTolerance: 0.1, heatTolerance: 0.01, ...changes });
const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);

test("refinement plans double every axis and reject impossible or invalid grids before execution", () => {
  const p = example(), before = structuredClone(p);
  assert.deepEqual(refinementSource(p.source, setup(), 2).meshes[0].cells, [24, 12, 12]);
  const changed = refinementSource(p.source, setup(), 2);
  changed.meshes[0].cells = before.source.meshes[0].cells;
  assert.deepEqual(changed, p.source);
  for (const input of [{ baseCells: [1, 3, 3] }, { baseCells: [6.5, 3, 3] }, { baseCells: [6, 3] },
    { baseCells: [24, 12, 12] }, { baseCells: [16, 16, 16] }, { levels: 1 }, { levels: 5 },
    { temperatureTolerance: 0 }, { heatTolerance: NaN }, { heatTolerance: -1 }])
    assert.throws(() => refinementSettings(setup(input)));
  assert.throws(() => refinementSource(p.source, setup(), 3), /level/);
  assert.deepEqual(p, before);
  p.source.features.push({ id: "cut", bodyId: "body-block", type: "through-hole", name: "Hole", axis: 2,
    center: ["length/2", "width/2"], diameter: "2 mm", suppressed: false });
  assert.throws(() => createConvergence(p, setup(), "unsupported"), /uncut block/);
});

test("linear conduction has mesh-independent heat flow and tiny cell error along each axis", () => {
  for (const axis of [0, 1, 2]) {
    const p = example();
    p.source.physics[0].boundaries.forEach((b, i) => { b.entityId = faceId("body-block", axis, i); });
    const before = structuredClone(p), record = runConvergence(p, setup(), `linear-${axis}`);
    assert.deepEqual(p, before);
    const length = [0.06, 0.02, 0.01][axis], area = 0.06 * 0.02 * 0.01 / length;
    for (const row of convergenceRows(record)) {
      near(row.summary.heatOut[1], 167 * area * 60 / length);
      near(row.summary.heatOut[0], -row.summary.heatOut[1]);
      assert.ok(row.analyticalError < 2e-6);
      if (row.temperatureChange !== undefined) assert.ok(row.temperatureChange < 2e-6);
      assert.equal(row.result.provenance.projectId, p.id);
    }
    assert.equal(convergenceAssessment(record).kind, "within");
  }
});

test("uniform generation reproduces independent second-order cell-error formula on all axes", () => {
  for (const axis of [0, 1, 2]) {
    const p = example(), q = 1e7, conductivity = 167;
    p.source.physics[0].heatGeneration = `${q} W/m^3`;
    p.source.physics[0].boundaries.forEach((b, i) => { b.entityId = faceId("body-block", axis, i); });
    const record = runConvergence(p, setup(), `quadratic-${axis}`), rows = convergenceRows(record);
    for (const row of rows) {
      const spacing = [0.06, 0.02, 0.01][axis] / row.cells[axis];
      near(row.analyticalError, q * spacing ** 2 / (8 * conductivity), 2e-6);
      near(row.summary.heatOut[0] + row.summary.heatOut[1], q * 0.06 * 0.02 * 0.01, 2e-6);
    }
    near(rows[0].analyticalError / rows[1].analyticalError, 4, 2e-4);
    near(rows[1].analyticalError / rows[2].analyticalError, 4, 2e-4);
  }
});

test("profile comparison catches maxima between fixed probes using both sets of interpolation knots", () => {
  const a = [[0, 0], [0.25, 1], [0.5, 0], [1, 0]], b = [[0, 0], [1, 0]];
  assert.equal(profileDifference(a, b), 1);
  assert.equal(profileDifference(b, a), 1);
  assert.equal(profileDifference(a, a), 0);
  assert.throws(() => profileDifference(a, [[0, 0], [2, 0]]), /interval/);
});

test("change limits use the finest adjacent pair; partial, failed and imported studies never pass", () => {
  const p = example(); p.source.physics[0].heatGeneration = "1e7 W/m^3";
  const record = runConvergence(p, setup({ levels: 4 }), "assessment"), rows = convergenceRows(record);
  assert.ok(rows[1].temperatureChange > 0.1);
  assert.ok(rows.at(-1).temperatureChange < 0.1);
  assert.equal(convergenceAssessment(record).kind, "within");
  record.settings.temperatureTolerance = 0.001;
  assert.equal(convergenceAssessment(record).kind, "above");
  const partial = structuredClone(record);
  partial.status = "Cancelled"; partial.rows.pop();
  assert.equal(convergenceAssessment(partial).kind, "partial");
  record.rows[1] = { index: 1, status: "Failed", error: "Solver failure" };
  assert.equal(convergenceRows(record)[2].temperatureChange, undefined);
  assert.equal(convergenceAssessment(record).kind, "failed");
  record.verified = false;
  assert.equal(convergenceAssessment(record).kind, "unverified");
});

test("solver failures retain diagnostics without fabricated temperature fields", () => {
  const p = example(); p.source.physics[0].heatGeneration = "-1e12 W/m^3";
  const record = runConvergence(p, setup(), "failed-fields");
  for (const row of record.rows) {
    assert.equal(row.status, "Failed");
    assert.equal(row.result, undefined);
    assert.match(row.error, /absolute temperatures/);
  }
  assert.equal(convergenceAssessment(record).kind, "failed");
  assert.equal(validateProject({ ...p, convergenceChecks: [record] }).convergenceChecks[0].rows.length, 3);
});

test("full fields survive project round trips and imported fields lose verification consistently", () => {
  const p = example(), before = fingerprint(p.source);
  delete p.convergenceChecks;
  assert.deepEqual(validateProject(p).convergenceChecks, []);
  p.convergenceChecks = [runConvergence(p, setup(), "portable")];
  p.results = [structuredClone(p.convergenceChecks[0].rows[1].result)];
  const saved = validateProject(JSON.parse(JSON.stringify(p)));
  assert.equal(fingerprint(saved.source), before);
  assert.deepEqual(saved.convergenceChecks[0].rows, p.convergenceChecks[0].rows);
  const imported = validateProject(JSON.parse(JSON.stringify(p)), { imported: true });
  assert.equal(imported.convergenceChecks[0].verified, false);
  assert.ok(imported.convergenceChecks[0].rows.every((r) => !r.result.verified));
  assert.equal(imported.results[0].verified, false);
  assert.deepEqual(imported.results[0], imported.convergenceChecks[0].rows[1].result);
});

test("mesh check schema rejects changed physics, mismatched fields, provenance and duplicate IDs", () => {
  const p = example(); p.convergenceChecks = [runConvergence(p, setup(), "schema")];
  for (const mutate of [
    (s) => { s.provenance.fingerprint = "bad"; },
    (s) => { s.rows[0].result.temperatures.pop(); },
    (s) => { s.rows[0].result.id = "unrelated"; },
    (s) => { s.rows[0].result.provenance.revision++; },
    (s) => { s.rows[0].result.residual = 1; },
    (s) => { s.rows[0].result.provenance.settings.relativeTolerance = 0.1; },
    (s) => { s.rows[0].result.provenance.source.materials[0].conductivity = "168 W/(m*K)";
      s.rows[0].result.provenance.fingerprint = fingerprint(s.rows[0].result.provenance.source); },
    (s) => { s.rows.reverse(); },
    (s) => { s.rows.pop(); },
  ]) {
    const copy = structuredClone(p); mutate(copy.convergenceChecks[0]);
    assert.throws(() => validateProject(copy));
  }
  assert.throws(() => validateProject({ ...p, convergenceChecks: [...p.convergenceChecks, ...p.convergenceChecks] }), /unique/);
  p.results = [structuredClone(p.convergenceChecks[0].rows[0].result)];
  p.results[0].temperatures[0] += 1;
  assert.throws(() => validateProject(p), /conflicts/);
});

test("inspecting and applying a retained field preserves full study inputs, undo, and outdated status", () => {
  const p = example(), record = runConvergence(p, setup(), "history"), h = new ProjectHistory(p);
  h.addConvergence(record);
  const original = structuredClone(h.project.source);
  const changed = structuredClone(original); changed.features[0].materialId = "copper";
  h.update(changed);
  assert.equal(isCurrent(h.project, record), false);
  const field = record.rows[2].result;
  h.addResult(field);
  assert.equal(isCurrent(h.project, field), false);
  h.update(field.provenance.source);
  assert.equal(isCurrent(h.project, field), true);
  assert.equal(h.project.source.features[0].materialId, "aluminum");
  h.undo();
  assert.equal(fingerprint(h.project.source), fingerprint(changed));
  h.redo();
  assert.equal(fingerprint(h.project.source), field.provenance.fingerprint);
  assert.equal(h.project.convergenceChecks.length, 1);
});

test("only three checks are retained, independently of input undo and solution retention", () => {
  const h = new ProjectHistory(example());
  for (let i = 0; i < 4; i++) h.addConvergence(runConvergence(h.project, setup({ levels: 2 }), `bounded-${i}`));
  assert.deepEqual(h.project.convergenceChecks.map((c) => c.id), ["bounded-1", "bounded-2", "bounded-3"]);
  assert.equal(h.project.results.length, 0);
  assert.equal(h.project.revision, 0);
});

test("cancellation keeps completed fields, strips historical payloads and ignores late replies", () => {
  const p = example(), record = runConvergence(p, setup(), "initial"), events = [];
  p.convergenceChecks = [record];
  let worker, active = createConvergence(p, setup(), "pending");
  const jobs = new JobManager((event) => {
    events.push(event);
    if (event.state === "Queued") active.id = event.id;
    if (event.row) active.rows.push(event.row);
    if (event.state === "Cancelled") active.status = "Cancelled";
  }, () => (worker = { postMessage(data) { this.request = data; }, terminate() {} }));
  const id = jobs.start("convergence", p, { convergence: setup() });
  assert.deepEqual(worker.request.project.convergenceChecks, []);
  const first = structuredClone(record.rows[0]); first.result.id = `${id}.0`;
  worker.onmessage({ data: { id, state: "Refining", row: first } });
  jobs.cancel();
  const count = events.length;
  worker.onmessage({ data: { id, state: "Completed", convergence: record } });
  assert.equal(events.length, count);
  assert.equal(active.rows.length, 1);
  assert.equal(convergenceAssessment(active).kind, "partial");
  assert.equal(validateProject({ ...p, convergenceChecks: [active] }).convergenceChecks[0].rows.length, 1);
});

test("CSV includes SI differences, analytical error, solver provenance and incomplete status", () => {
  const record = runConvergence(example(), setup(), "csv");
  record.status = "Cancelled"; record.rows.pop();
  const csv = convergenceCSV(record);
  assert.equal(csv.split("\r\n").length, 3);
  assert.match(csv, /"profile_change_K"/);
  assert.match(csv, /"analytical_cell_error_K"/);
  assert.match(csv, /"energy_imbalance_W"/);
  assert.match(csv, /"temperature_change_limit_K"/);
  assert.match(csv, /"Cancelled"/);
  assert.match(csv, /"hc-thermal-fvm-1"/);
});

test("real refinement worker emits each saved field and validates its completed record", { timeout: 10000 }, async () => {
  const url = new URL("../docs/engineering/worker.mjs", import.meta.url).href;
  const worker = new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:data=>parentPort.postMessage(data)};import(${JSON.stringify(url)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`, { eval: true });
  const rows = [];
  try {
    const record = await new Promise((resolve, reject) => {
      worker.on("error", reject);
      worker.on("message", (data) => {
        if (data.state === "Failed") reject(Error(data.error));
        if (data.row) rows.push(data.row);
        if (data.state === "Completed") resolve(data.convergence);
      });
      worker.postMessage({ id: "worker-check", action: "convergence", project: example(), options: { convergence: setup() } });
    });
    assert.deepEqual(rows, record.rows);
    assert.equal(rows.length, 3);
    assert.equal(validateProject({ ...example(), convergenceChecks: [record] }).convergenceChecks[0].status, "Completed");
    assert.equal(convergenceAssessment(record).kind, "within");
  } finally { await worker.terminate(); }
});
