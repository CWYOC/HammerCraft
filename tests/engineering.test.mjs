import test from "node:test";
import assert from "node:assert/strict";
import { Worker as NodeWorker } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import {
  evaluate,
  parameters,
  quantity,
  dimensions,
} from "../docs/engineering/units.mjs";
import {
  createProject,
  validateProject,
  validateSource,
  fingerprint,
  faceId,
  isCurrent,
  ProjectHistory,
} from "../docs/engineering/project.mjs";
import {
  solveThermal,
  meshInfo,
  makeResult,
  summarize,
  sampleTemperature,
  exportSTL,
} from "../docs/engineering/thermal.mjs";
import { JobManager } from "../docs/engineering/jobs.mjs";
const near = (actual, expected, tolerance = 1e-7) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}, tolerance ${tolerance}`,
  );
const example = () => createProject("test-project");
function run(p) {
  return makeResult(
    p,
    solveThermal(p.source),
    "result-1",
    "2026-10-07T12:00:00Z",
  );
}

test("engineering units preserve dimensions, dependencies, precedence and engineering conversions", () => {
  const values = parameters([
    { name: "outer", expression: "inner + 2*wall" },
    { name: "wall", expression: "1.2 mm" },
    { name: "inner", expression: "8 mm" },
  ]);
  near(quantity("outer", dimensions.length, values), 0.0104, 1e-14);
  near(quantity("2 in", dimensions.length), 0.0508);
  near(quantity("1 g/cm^3", dimensions.density), 1000);
  near(quantity("80 degC", dimensions.temperature), 353.15);
  near(quantity("-20 °C", dimensions.temperature), 253.15);
  near(evaluate("5 V * 2 A").value, 10);
  assert.deepEqual(evaluate("5 V * 2 A").dim, evaluate("1 W").dim);
  near(evaluate("-2^2").value, -4);
  near(evaluate("(2+3)^2").value, 25);
  near(evaluate("1e-3 m / (2 s)").value, 0.0005);
});
test("engineering expressions reject incompatible dimensions, cycles and executable syntax", () => {
  for (const value of [
    "1 mm + 2 V",
    "1 / 0",
    "globalThis.alert(1)",
    "1; process.exit()",
    "2 ** 3",
    "1 degC + 2 K",
    "1 m ^ (2 m)",
  ])
    assert.throws(() => evaluate(value));
  assert.throws(
    () =>
      parameters([
        { name: "a", expression: "b" },
        { name: "b", expression: "a" },
      ]),
    /Circular/,
  );
  assert.throws(
    () => parameters([{ name: "a", expression: "missing" }]),
    /Unknown/,
  );
  assert.throws(() => parameters([{ name: "m", expression: "1" }]), /names/);
  assert.throws(() => quantity("5 V", dimensions.length), /Expected/);
  assert.throws(() => evaluate("-274 degC"), /absolute zero/);
});
test("project round trip retains IDs and unit-resolved geometry", () => {
  const p = example(),
    round = validateProject(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(round, p);
  assert.deepEqual(validateSource(p.source).size, [0.06, 0.02, 0.01]);
  assert.equal(
    round.source.physics[0].boundaries[0].entityId,
    faceId("body-block", 0, 0),
  );
});
test("invalid project mutations are rejected without replacing the accepted state", () => {
  const h = new ProjectHistory(example()),
    before = JSON.stringify(h.project);
  const bad = structuredClone(h.project.source);
  bad.parameters[0].expression = "5 V";
  assert.throws(() => h.update(bad), /Expected/);
  assert.equal(JSON.stringify(h.project), before);
  assert.equal(h.past.length, 0);
  for (const mutate of [
    (s) => (s.meshes[0].cells = [64, 64, 64]),
    (s) => (s.features[0].materialId = "missing"),
    (s) => (s.physics[0].boundaries[1].entityId = "body-block:face:y-max"),
    (s) => (s.materials[0].conductivity = "0 W/(m*K)"),
    (s) => (s.studies[0].solverId = "fake"),
    (s) => (s.features[0].dimensions = ["1 mm", "0 mm", "1 mm"]),
  ]) {
    const source = structuredClone(h.project.source);
    mutate(source);
    assert.throws(() => validateSource(source));
  }
});
test("3D finite volume matches the exact homogeneous slab solution in all directions", () => {
  for (const axis of [0, 1, 2]) {
    const p = example();
    p.source.meshes[0].cells = [10, 7, 5];
    p.source.physics[0].boundaries.forEach((b, side) => {
      b.entityId = faceId("body-block", axis, side);
    });
    const r = run(p),
      s = summarize(r),
      { cells, size, material } = s.model,
      stride = [1, cells[0], cells[0] * cells[1]][axis];
    r.temperatures.forEach((t, i) => {
      const x = ((Math.floor(i / stride) % cells[axis]) + 0.5) / cells[axis];
      near(t, 353.15 - 60 * x, 2e-6);
    });
    const area = size.reduce((a, b) => a * b, 1) / size[axis],
      rate = (material.k * area * 60) / size[axis];
    near(s.heatOut[0], -rate, 1e-5);
    near(s.heatOut[1], rate, 1e-5);
    near(s.balanceError, 0, 1e-5);
    near(
      sampleTemperature(
        r,
        size.map((n) => n / 2),
      ),
      323.15,
      2e-6,
    );
    for (const side of [0, 1]) {
      const point = size.map((n) => n / 2);
      point[axis] = side * size[axis];
      near(sampleTemperature(r, point), side ? 293.15 : 353.15, 1e-7);
    }
    assert.ok(r.residual < 5e-10);
  }
});
test("uniform source conserves heat and converges quadratically to the analytical solution", () => {
  const errors = [];
  for (const nx of [6, 12, 24]) {
    const p = example();
    p.source.meshes[0].cells = [nx, 3, 3];
    p.source.physics[0].heatGeneration = "1000000 W/m^3";
    const r = run(p),
      s = summarize(r),
      L = s.model.size[0],
      k = s.model.material.k;
    let maxError = 0;
    for (const [x, t] of s.profile) {
      const exact = 353.15 - (60 * x) / L + (1e6 * x * (L - x)) / (2 * k);
      maxError = Math.max(maxError, Math.abs(t - exact));
    }
    errors.push(maxError);
    near(s.heatOut[0] + s.heatOut[1], 1e6 * s.mesh.volume, 1e-5);
  }
  assert.ok(errors[0] / errors[1] > 3.9);
  assert.ok(errors[1] / errors[2] > 3.9);
});
test("equal face temperatures yield uniform temperatures and zero heat flow", () => {
  const p = example();
  p.source.physics[0].boundaries[1].expression = "80 degC";
  const r = run(p),
    s = summarize(r);
  for (const t of r.temperatures) near(t, 353.15, 1e-8);
  s.heatOut.forEach((q) => near(q, 0, 1e-7));
  assert.equal(r.iterations, 0);
});
test("negative temperature results from an excessive sink are rejected", () => {
  const p = example();
  p.source.physics[0].heatGeneration = "-1e12 W/m^3";
  assert.throws(() => run(p), /absolute temperatures/);
});
test("mesh volume and mass retain SI consistency", () => {
  const p = example(),
    m = meshInfo(p.source);
  near(m.volume, 12e-6, 1e-14);
  near(m.count * m.cellVolume, m.volume, 1e-14);
  assert.equal(m.count, 432);
  const s = summarize(run(p));
  near(s.mass, 0.0324, 1e-12);
});
test("history invalidates upstream results and preserves their original geometry snapshots", () => {
  const h = new ProjectHistory(example()),
    r = run(h.project);
  h.addResult(r);
  assert.ok(isCurrent(h.project, r));
  h.update(h.project.source, "Renamed project");
  assert.ok(
    isCurrent(h.project, r),
    "A display name does not invalidate numerical inputs",
  );
  const next = structuredClone(h.project.source);
  next.parameters[0].expression = "120 mm";
  h.update(next);
  assert.ok(!isCurrent(h.project, r));
  near(validateSource(r.provenance.source).size[0], 0.06);
  near(validateSource(h.project.source).size[0], 0.12);
  assert.equal(
    h.project.source.physics[0].boundaries[0].entityId,
    "body-block:face:x-min",
  );
  h.undo();
  assert.ok(isCurrent(h.project, r));
  h.redo();
  assert.ok(!isCurrent(h.project, r));
  h.checkpoint("Long version", "version-1");
  next.parameters[0].expression = "30 mm";
  h.update(next);
  h.update(h.project.versions[0].source);
  near(validateSource(h.project.source).size[0], 0.12);
  for (const mutate of [
    (s) => (s.materials[0].conductivity = "100 W/(m*K)"),
    (s) => (s.physics[0].boundaries[0].expression = "100 degC"),
    (s) => (s.meshes[0].cells = [6, 3, 3]),
  ]) {
    const p = example(),
      rr = run(p);
    mutate(p.source);
    assert.ok(!isCurrent(p, rr));
  }
});
test("project imports preserve provenance but label imported solutions unverified", () => {
  const p = example();
  p.results.push(run(p));
  const local = validateProject(JSON.parse(JSON.stringify(p))),
    imported = validateProject(p, { imported: true });
  assert.equal(local.results[0].verified, true);
  assert.equal(imported.results[0].verified, false);
  assert.deepEqual(local.results[0].provenance.source, p.source);
  const bad = structuredClone(p);
  bad.results[0].provenance.source.parameters[0].expression = "120 mm";
  assert.throws(() => validateProject(bad), /snapshot/);
  bad.results[0].provenance.fingerprint = fingerprint(
    bad.results[0].provenance.source,
  );
  bad.results[0].temperatures.pop();
  assert.throws(() => validateProject(bad), /snapshot/);
});
test("probe rejects locations outside the result geometry", () => {
  const r = run(example());
  assert.throws(() => sampleTemperature(r, [0.07, 0, 0]), /inside/);
  assert.throws(() => sampleTemperature(r, [NaN, 0, 0]), /inside/);
});
test("STL has twelve outward triangles and the expected millimetre volume", () => {
  const stl = exportSTL(example().source),
    vertices = [...stl.matchAll(/vertex ([^\n]+)/g)].map((m) =>
      m[1].split(" ").map(Number),
    );
  assert.equal(vertices.length, 36);
  let volume = 0;
  const edges = new Map();
  for (let i = 0; i < vertices.length; i += 3) {
    const [a, b, c] = vertices.slice(i, i + 3);
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = [u.join(","), v.join(",")].sort().join("|");
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  near(volume, 12000, 1e-8);
  for (const count of edges.values()) assert.equal(count, 2);
});
test("job cancellation terminates computation and ignores late results", () => {
  let worker;
  const events = [];
  const jobs = new JobManager(
    (e) => events.push(e),
    () =>
      (worker = {
        postMessage(data) {
          this.request = data;
        },
        terminate() {
          this.terminated = true;
        },
      }),
  );
  jobs.start("solve", example());
  assert.equal(events[0].state, "Queued");
  assert.throws(() => jobs.start("solve", example()), /already/);
  const id = worker.request.id;
  jobs.cancel();
  assert.equal(worker.terminated, true);
  assert.equal(events.at(-1).state, "Cancelled");
  assert.equal(jobs.active, null);
  worker.onmessage({ data: { id, state: "Completed", result: {} } });
  assert.equal(events.length, 2);
});
test("job input is an immutable snapshot while edits can continue", () => {
  let worker;
  const events = [];
  const jobs = new JobManager(
      (e) => events.push(e),
      () =>
        (worker = {
          postMessage(data) {
            this.request = data;
          },
          terminate() {},
        }),
    ),
    p = example();
  jobs.start("solve", p);
  p.source.parameters[0].expression = "100 mm";
  assert.equal(worker.request.project.source.parameters[0].expression, "60 mm");
  worker.onmessage({
    data: { id: worker.request.id, state: "Failed", error: "test" },
  });
  assert.equal(jobs.active, null);
  assert.equal(events.at(-1).state, "Failed");
});
test("real module worker emits a complete lifecycle and reproducible solution", async () => {
  const workerURL = new URL("../docs/engineering/worker.mjs", import.meta.url)
    .href;
  const worker = new NodeWorker(
    `const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:data=>parentPort.postMessage(data)};import(${JSON.stringify(workerURL)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`,
    { eval: true },
  );
  const stages = [];
  try {
    const result = await new Promise((resolve, reject) => {
      worker.on("error", reject);
      worker.on("message", (data) => {
        stages.push(data.state);
        if (data.state === "Failed") reject(Error(data.error));
        if (data.state === "Completed") resolve(data.result);
      });
      worker.postMessage({
        id: "worker-result",
        action: "solve",
        project: example(),
      });
    });
    assert.deepEqual(
      [...new Set(stages)],
      ["Preparing", "Meshing", "Solving", "Post-processing", "Completed"],
    );
    assert.ok(isCurrent(example(), result));
    near(summarize(result).heatOut[1], 33.4, 1e-6);
  } finally {
    await worker.terminate();
  }
});
test("engineering page retains admin auth and existing tools gain a navigation link", async () => {
  const html = await readFile(
    new URL("../docs/engineering-studio.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /src="auth.js\?v=40"/);
  const ui = await readFile(
    new URL("../docs/engineering/studio.mjs", import.meta.url),
    "utf8",
  );
  assert.match(ui, /await window.HCAuth.requireAdmin\(\)/);
  for (const file of ["admin.html", "design-studio.html"])
    assert.match(
      await readFile(new URL(`../docs/${file}`, import.meta.url), "utf8"),
      /engineering-studio\.html/,
    );
});
