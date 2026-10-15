import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  createProject,
  validateProject,
  validateSource,
  ProjectHistory,
  isCurrent,
  fingerprint,
} from "../docs/engineering/project.mjs";
import {
  solveThermal,
  meshInfo,
  exportSTL,
  makeResult,
} from "../docs/engineering/thermal.mjs";
import {
  cadDefinition,
  cadFingerprint,
} from "../docs/engineering/cad-model.mjs";
import {
  buildSolid,
  describeSolid,
  exportSolid,
  importSTEP,
  measureVolume,
  loadKernel,
} from "../docs/engineering/cad-kernel.mjs";
import { CadClient } from "../docs/engineering/cad-client.mjs";
import { CadImport, stepSource } from "../docs/engineering/cad-import.mjs";
import {
  validateSTEPText,
  MAX_STEP_BYTES,
} from "../docs/engineering/step-input.mjs";
import * as cad from "../docs/engineering/vendor/replicad.mjs";

const near = (a, b, tolerance = 1e-5) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
function hole(axis = 2, id = "hole-1") {
  const values = ["length/2", "width/2", "height/2"];
  return {
    id,
    bodyId: "body-block",
    type: "through-hole",
    name: "Mounting hole",
    axis,
    center: values.filter((_, a) => a !== axis),
    diameter: "6 mm",
    suppressed: false,
  };
}
function example(axis = 2) {
  const p = createProject("cad-test");
  p.source.features.push(hole(axis));
  return p;
}

test("CAD features preserve equations, stable IDs and canonical project round trips", () => {
  const p = example();
  p.source.parameters.push({
    id: "diameter",
    name: "diameter",
    expression: "0.25 in",
  });
  p.source.features[1].diameter = "diameter";
  const normalized = validateProject(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(normalized.source, p.source);
  const definition = cadDefinition(p.source);
  near(definition.holes[0].diameter, 6.35);
  assert.deepEqual(definition.holes[0].center, [30, 10]);
  const originalKey = cadFingerprint(p.source);
  p.source.materials[0].density = "1000 kg/m^3";
  assert.equal(cadFingerprint(p.source), originalKey);
  p.source.parameters[0].expression = "120 mm";
  assert.notEqual(cadFingerprint(p.source), originalKey);
  assert.deepEqual(cadDefinition(p.source).holes[0].center, [60, 10]);
});
test("invalid hole edits reject atomically, including foreign references and feature limits", () => {
  const history = new ProjectHistory(example());
  const before = fingerprint(history.project.source);
  for (const mutate of [
    (s) => {
      s.features[1].diameter = "50 mm";
    },
    (s) => {
      s.features[1].diameter = "3 V";
    },
    (s) => {
      s.features[1].center = ["0 mm", "width/2"];
    },
    (s) => {
      s.features[1].bodyId = "missing";
    },
    (s) => {
      s.features[1].axis = 3;
    },
    (s) => {
      s.features[1].id = "aluminum";
    },
    (s) => {
      s.features[1].suppressed = "false";
    },
    (s) => {
      for (let i = 0; i < 8; i++) s.features.push(hole(2, `extra-${i}`));
    },
  ]) {
    const source = structuredClone(history.project.source);
    mutate(source);
    assert.throws(() => history.update(source));
    assert.equal(fingerprint(history.project.source), before);
  }
});
test("holes invalidate thermal results; undo and suppression retain original face references", () => {
  const p = createProject("thermal-before-cad");
  p.results.push(makeResult(p, solveThermal(p.source), "r1"));
  const history = new ProjectHistory(p),
    before = fingerprint(p.source);
  const source = structuredClone(p.source);
  source.features.push(hole());
  history.update(source);
  assert.equal(isCurrent(history.project, history.project.results[0]), false);
  assert.equal(
    fingerprint(history.project.results[0].provenance.source),
    before,
  );
  for (const fn of [solveThermal, meshInfo, exportSTL])
    assert.throws(() => fn(source), /uncut block/);
  const forged = structuredClone(history.project);
  forged.results[0].provenance.source = source;
  forged.results[0].provenance.fingerprint = fingerprint(source);
  assert.throws(() => validateProject(forged), /uncut block/);
  history.undo();
  assert.equal(isCurrent(history.project, history.project.results[0]), true);
  history.redo();
  const suppressed = structuredClone(history.project.source);
  suppressed.features[1].suppressed = true;
  history.update(suppressed);
  assert.equal(validateSource(suppressed).thermalSupported, true);
  assert.deepEqual(suppressed.physics, p.source.physics);
  const solved = solveThermal(suppressed);
  assert.deepEqual(solved.temperatures, p.results[0].temperatures);
});
test("real CAD kernel matches drilled volume along all three axes and after parameter regeneration", async () => {
  for (let axis = 0; axis < 3; axis++) {
    const p = example(axis);
    const shape = await buildSolid(p.source);
    try {
      const artifact = describeSolid(shape, p.source);
      near(artifact.volume * 1e9, 12000 - Math.PI * 9 * [60, 20, 10][axis]);
      assert.equal(artifact.faceCount, 7);
      assert.ok(artifact.triangleCount > 100);
      assert.ok(artifact.mesh.vertices.every(Number.isFinite));
      assert.ok(
        artifact.mesh.triangles.every(
          (i) =>
            Number.isInteger(i) &&
            i >= 0 &&
            i * 3 < artifact.mesh.vertices.length,
        ),
      );
    } finally {
      shape.delete();
    }
  }
  const p = example();
  p.source.parameters[0].expression = "120 mm";
  const shape = await buildSolid(p.source);
  try {
    near(measureVolume(shape), 24000 - Math.PI * 9 * 10);
  } finally {
    shape.delete();
  }
});
test("intersecting perpendicular holes use Boolean volume, not double subtraction", async () => {
  const p = example(2);
  p.source.features.push(hole(0, "cross-hole"));
  const shape = await buildSolid(p.source);
  try {
    // Two equal perpendicular cylinders: intersection volume = 16 r^3 / 3.
    near(measureVolume(shape), 12000 - Math.PI * 9 * 70 + (16 * 27) / 3, 0.001);
  } finally {
    shape.delete();
  }
});
test("suppressed CAD features leave the exact base solid", async () => {
  const p = example();
  p.source.features[1].suppressed = true;
  const shape = await buildSolid(p.source);
  try {
    near(measureVolume(shape), 12000);
    assert.equal(describeSolid(shape, p.source).faceCount, 6);
  } finally {
    shape.delete();
  }
});
test("STEP round trip preserves drilled solid volume and binary STL has consistent outward volume", async () => {
  const p = example(),
    shape = await buildSolid(p.source);
  try {
    const step = exportSolid(shape, "step", "Mounting block");
    assert.match(await step.text(), /^ISO-10303-21;/);
    const imported = await importSTEP(step);
    try {
      near(measureVolume(imported), measureVolume(shape));
    } finally {
      imported.delete();
    }
    const data = new DataView(await exportSolid(shape, "stl").arrayBuffer());
    const count = data.getUint32(80, true);
    assert.equal(data.byteLength, 84 + count * 50);
    let volume = 0;
    for (let i = 0; i < count; i++) {
      const offset = 84 + i * 50 + 12;
      const [a, b, c] = [0, 1, 2].map((v) =>
        [0, 1, 2].map((k) => data.getFloat32(offset + v * 12 + k * 4, true)),
      );
      volume +=
        (a[0] * (b[1] * c[2] - b[2] * c[1]) +
          a[1] * (b[2] * c[0] - b[0] * c[2]) +
          a[2] * (b[0] * c[1] - b[1] * c[0])) /
        6;
    }
    near(volume, measureVolume(shape), 2);
  } finally {
    shape.delete();
  }
});
test("CAD transport cancels superseded builds and ignores their late replies", async () => {
  const workers = [];
  const client = new CadClient(() => {
    const worker = {
      postMessage(data) {
        this.request = data;
      },
      terminate() {
        this.terminated = true;
      },
    };
    workers.push(worker);
    return worker;
  });
  const first = client.request("build", { source: example().source });
  const rejection = assert.rejects(first, /superseded/);
  const second = client.request("build", { source: example(0).source });
  await rejection;
  assert.ok(workers[0].terminated);
  workers[0].onmessage({
    data: { id: workers[0].request.id, artifact: "obsolete" },
  });
  workers[1].onmessage({
    data: { id: workers[1].request.id, artifact: "current" },
  });
  assert.equal((await second).artifact, "current");
  client.reset();
});
test("CAD transport terminates a stalled worker and allows retry", async () => {
  let terminated = false;
  const client = new CadClient(
    () => ({
      postMessage() {},
      terminate() {
        terminated = true;
      },
    }),
    10,
  );
  await assert.rejects(client.request("build", {}), /timed out/);
  assert.equal(terminated, true);
  assert.equal(client.pending, null);
});
test(
  "real CAD module worker builds, exports and rejects a mismatched geometry export",
  { timeout: 20000 },
  async () => {
    const workerURL = new URL(
      "../docs/engineering/cad-worker.mjs",
      import.meta.url,
    ).href;
    const worker = new Worker(
      `const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:data=>parentPort.postMessage(data)};import(${JSON.stringify(workerURL)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`,
      { eval: true },
    );
    let id = 0;
    const send = (data) =>
      new Promise((resolve, reject) => {
        worker.once("error", reject);
        worker.once("message", (reply) => {
          worker.removeListener("error", reject);
          resolve(reply);
        });
        worker.postMessage({ id: ++id, ...data });
      });
    try {
      const built = await send({ action: "build", source: example().source });
      assert.equal(built.error, undefined);
      near(built.artifact.volume * 1e9, 12000 - Math.PI * 90);
      const result = await send({
        action: "export",
        fingerprint: built.artifact.fingerprint,
        format: "step",
      });
      assert.ok(result.blob.size > 10000);
      const invalid = await send({
        action: "export",
        fingerprint: "wrong",
        format: "step",
      });
      assert.match(invalid.error, /Regenerate/);
    } finally {
      await worker.terminate();
    }
  },
);
test("vendored CAD browser assets match their pinned integrity manifest", async () => {
  const root = new URL("../docs/engineering/vendor/", import.meta.url);
  const manifest = JSON.parse(
    await readFile(new URL("manifest.json", root), "utf8"),
  );
  for (const [name, expected] of Object.entries(manifest.sha256)) {
    const actual = createHash("sha256")
      .update(await readFile(new URL(name, root)))
      .digest("hex");
    assert.equal(actual, expected, name);
  }
});

test("text STEP screening rejects oversized, binary and truncated data", () => {
  for (const text of [
    null,
    "solid stl\nendsolid stl",
    "ISO-10303-21;\nHEADER;",
    "ISO-10303-21;\u0000END-ISO-10303-21;",
    "x".repeat(MAX_STEP_BYTES + 1),
  ])
    assert.throws(() => validateSTEPText(text), /STEP/);
  assert.equal(
    validateSTEPText("ISO-10303-21;\nEND-ISO-10303-21;"),
    "ISO-10303-21;\nEND-ISO-10303-21;",
  );
});
test("STEP import preserves off-origin geometry and declared millimetre, metre and inch units", async () => {
  await loadKernel();
  const original = cad.makeCylinder(12, 8, [45, -30, 12]);
  try {
    for (const unit of ["MM", "M", "INCH"]) {
      const text = await cad
        .exportSTEP([{ shape: original }], { unit, modelUnit: "MM" })
        .text();
      const source = stepSource(
        createProject().source,
        text,
        `cylinder-${unit}.step`,
        "step-feature",
      );
      assert.equal(validateSource(source).imported, true);
      assert.equal(validateSource(source).size, null);
      const shape = await buildSolid(source);
      try {
        const artifact = describeSolid(shape, source);
        near(artifact.volume * 1e9, Math.PI * 144 * 8);
        for (const [i, expected] of [33, -42, 12, 57, -18, 20].entries())
          near(artifact.bounds.flat()[i] * 1000, expected);
        const again = await importSTEP(exportSolid(shape, "step"));
        try {
          near(measureVolume(again), measureVolume(original));
        } finally {
          again.delete();
        }
      } finally {
        shape.delete();
      }
    }
  } finally {
    original.delete();
  }
});
test("STEP solid is self-contained in project versions, history, duplicate and portable files", async () => {
  const p = createProject("before-import");
  const r = makeResult(p, solveThermal(p.source), "before-result");
  p.results.push(r);
  const history = new ProjectHistory(p),
    shape = await buildSolid(example().source);
  try {
    const text = await exportSolid(shape, "step").text();
    const source = stepSource(p.source, text, "drilled.step", "step-feature");
    history.update(source);
    history.checkpoint("Imported solid", "step-version");
    assert.equal(isCurrent(history.project, r), false);
    for (const fn of [solveThermal, meshInfo, exportSTL])
      assert.throws(() => fn(source), /Imported STEP/);
    history.undo();
    assert.equal(isCurrent(history.project, r), true);
    history.redo();
    const reopened = validateProject(
      JSON.parse(JSON.stringify(history.project)),
      { imported: true },
    );
    assert.equal(reopened.source.features[0].stepText, text);
    assert.equal(reopened.versions[0].source.features[0].stepText, text);
    assert.equal(reopened.results[0].verified, false);
    const copy = validateProject({
      ...reopened,
      id: "copy",
      results: [],
      versions: [],
    });
    const rebuilt = await buildSolid(copy.source);
    try {
      near(measureVolume(rebuilt), measureVolume(shape));
    } finally {
      rebuilt.delete();
    }
    const invalid = structuredClone(source);
    invalid.features.push(hole());
    assert.throws(() => validateSource(invalid), /cannot have/);
  } finally {
    shape.delete();
  }
});
test("STEP parser rejects malformed content, multi-solid assemblies and open surfaces", async () => {
  await loadKernel();
  const first = cad.makeBox([0, 0, 0], [10, 10, 10]),
    second = cad.makeBox([20, 0, 0], [30, 10, 10]);
  const faces = [...first.faces, ...second.faces];
  try {
    const multi = await cad
      .exportSTEP([{ shape: first }, { shape: second }])
      .text();
    const surface = await cad.exportSTEP([{ shape: faces[0] }]).text();
    const mixed = await cad
      .exportSTEP([{ shape: first }, { shape: faces[6] }])
      .text();
    for (const [text, message] of [
      [multi, /exactly one closed solid/],
      [surface, /exactly one closed solid/],
      [mixed, /loose surfaces/],
    ])
      await assert.rejects(
        buildSolid(stepSource(createProject().source, text, "invalid.step")),
        message,
      );
    await assert.rejects(
      buildSolid(
        stepSource(
          createProject().source,
          "ISO-10303-21;\nINVALID;\nEND-ISO-10303-21;",
          "broken.step",
        ),
      ),
    );
  } finally {
    faces.forEach((f) => f.delete());
    first.delete();
    second.delete();
  }
});
test("CAD import commits only after geometry validation and rejects edits made while loading", async () => {
  let finish,
    commits = 0,
    current = true;
  const client = {
    reset() {},
    request() {
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  };
  const importer = new CadImport(client);
  const candidate = example().source;
  const first = importer.run(
    candidate,
    () => current,
    () => {
      commits++;
    },
  );
  assert.equal(commits, 0);
  current = false;
  finish({ artifact: {} });
  await assert.rejects(first, /project changed/);
  assert.equal(commits, 0);
  current = true;
  const second = importer.run(
    candidate,
    () => current,
    (source) => {
      assert.deepEqual(source, candidate);
      commits++;
    },
  );
  finish({ artifact: { volume: 1 } });
  assert.equal((await second).volume, 1);
  assert.equal(commits, 1);
});
test("CAD import cancellation and kernel failure preserve the accepted project", async () => {
  let worker,
    commits = 0;
  const importer = new CadImport(
    new CadClient(
      () =>
        (worker = {
          postMessage(data) {
            this.request = data;
          },
          terminate() {
            this.terminated = true;
          },
        }),
    ),
  );
  const pending = importer.run(
    example().source,
    () => true,
    () => {
      commits++;
    },
  );
  const old = worker;
  importer.cancel();
  assert.equal(await pending, null);
  old.onmessage({ data: { id: old.request.id, artifact: {} } });
  assert.ok(old.terminated);
  const failed = importer.run(
    example().source,
    () => true,
    () => {
      commits++;
    },
  );
  worker.onmessage({
    data: { id: worker.request.id, error: "Invalid STEP topology" },
  });
  await assert.rejects(failed, /Invalid STEP/);
  assert.equal(commits, 0);
});
test("cancellation stays effective while an import commit awaits storage", async () => {
  let release,
    entered,
    committed = false;
  const storage = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const importer = new CadImport({
    reset() {},
    async request() {
      return { artifact: {} };
    },
  });
  const pending = importer.run(
    example().source,
    () => true,
    async (_source, _artifact, isCurrent) => {
      entered();
      await storage;
      if (isCurrent()) committed = true;
    },
  );
  await started;
  importer.cancel();
  release();
  await pending;
  assert.equal(committed, false);
});
