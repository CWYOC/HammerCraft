import {resolveElectricPhysics,validateElectricRecord} from './electric-fem-data.mjs';
import {resolveHarmonicPhysics,validateHarmonicRecord,harmonicSweep} from './harmonic-fem-data.mjs';
import {resolveModalPhysics,validateModalRecord,modalCount} from './modal-fem-data.mjs';
import {resolveStructuralPhysics,validateStructuralRecord} from './structural-fem-data.mjs';
import {resolveFemPhysics,validateFemRecord} from './thermal-fem-data.mjs';
import {assertStudy} from './physics-registry.mjs';
import { resolveVolumeMesh, validateVolumeMeshRecord } from './volume-mesh.mjs';
import { parameters, quantity, dimensions } from "./units.mjs";
import { resolveSketch, resolveSketchOperation } from "./sketch.mjs";
import { validateSTEPText } from "./step-input.mjs";
import { validateSweepRecord } from "./sweep-data.mjs";
import { validateConvergenceRecord } from "./convergence-data.mjs";
import { validateMeasurement } from "./measurement-data.mjs";
import { EDGE_KINDS, normalizeEdgeSelection } from "./topology.mjs";
import { resolveMaterial } from './materials.mjs';

export const FORMAT = "hc-engineering-project";
export const SOLVER = "hc-thermal-fvm-1";
export const PRESETS = {
  Draft: [6, 3, 3],
  Normal: [12, 6, 6],
  Fine: [24, 12, 12],
  "Very fine": [32, 16, 16],
  Extreme: [40, 20, 20],
};
const clone = (value) => structuredClone(value);
const id = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(value);
function text(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 160)
    throw Error(`${label} must contain 1–160 characters.`);
  return value;
}
function expression(value) {
  if (typeof value !== "string" || value.length > 512)
    throw Error("Invalid expression.");
  return value;
}
function identity(value) {
  if (!id(value)) throw Error("Invalid object ID.");
  return value;
}
function one(list, label) {
  if (!Array.isArray(list) || list.length !== 1)
    throw Error(`This release supports exactly one ${label}.`);
  return list[0];
}
export function faceId(bodyId, axis, side) {
  return `${bodyId}:face:${"xyz"[axis]}-${side ? "max" : "min"}`;
}
export function createProject(projectId = globalThis.crypto.randomUUID()) {
  return validateProject({
    format: FORMAT,
    schemaVersion: 1,
    id: projectId,
    name: "Thermal block",
    revision: 0,
    source: {
      parameters: [
        { id: "p-length", name: "length", expression: "60 mm" },
        { id: "p-width", name: "width", expression: "20 mm" },
        { id: "p-height", name: "height", expression: "10 mm" },
      ],
      features: [
        {
          id: "feature-block",
          bodyId: "body-block",
          type: "block",
          name: "Parametric block",
          dimensions: ["length", "width", "height"],
          materialId: "aluminum",
        },
      ],
      materials: [
        {
          id: "aluminum",
          name: "Aluminum • illustrative",
          conductivity: "167 W/(m*K)",
          density: "2700 kg/m^3",
        },
        {
          id: "copper",
          name: "Copper • illustrative",
          conductivity: "400 W/(m*K)",
          density: "8960 kg/m^3",
        },
        {
          id: "steel",
          name: "Steel • illustrative",
          conductivity: "50 W/(m*K)",
          density: "7850 kg/m^3",
        },
      ],
      physics: [
        {
          id: "physics-thermal",
          type: "heat-conduction",
          bodyId: "body-block",
          boundaries: [
            {
              entityId: "body-block:face:x-min",
              type: "temperature",
              expression: "80 degC",
            },
            {
              entityId: "body-block:face:x-max",
              type: "temperature",
              expression: "20 degC",
            },
          ],
          heatGeneration: "0 W/m^3",
        },
      ],
      meshes: [
        {
          id: "mesh-block",
          bodyId: "body-block",
          type: "structured-hex",
          cells: [...PRESETS.Normal],
        },
      ],
      studies: [
        {
          id: "study-thermal",
          name: "Steady-state conduction",
          type: "steady-state",
          physicsId: "physics-thermal",
          meshId: "mesh-block",
          solverId: SOLVER,
        },
      ],
    },
    results: [],
    versions: [],
    sweeps: [],
    convergenceChecks: [],
    measurements: [],
  });
}
export function validateSource(input) {
  if (!input || typeof input !== "object")
    throw Error("Project source is missing.");
  const values = parameters(input.parameters);
  if (
    !Array.isArray(input.features) ||
    !input.features.length ||
    input.features.length > 25
  )
    throw Error(
      "Include one base solid and at most 24 downstream operations (up to eight block through-holes).",
    );
  const feature = input.features[0],
    physics = one((input.physics || []).filter(p=>p.type==="heat-conduction"), "block thermal physics definition");
  if(!Array.isArray(input.physics)||input.physics.length>6||input.physics.some(p=>!["heat-conduction","heat-conduction-tetra","linear-elasticity","elastic-vibration","harmonic-elasticity","dc-conduction"].includes(p.type)))throw Error("Use one block study and at most one CAD thermal, static structural, eigenfrequency, harmonic and DC conduction study.");
  if (!Array.isArray(input.meshes) || input.meshes.length > 2 || input.meshes.some(m => !["structured-hex", "gmsh-tetra"].includes(m?.type))) throw Error("Use one structured study mesh and at most one CAD tetrahedral mesh.");
  const mesh = one(input.meshes.filter(m => m.type === "structured-hex"), "structured mesh"),
    study = one((input.studies || []).filter(s=>s.solverId===SOLVER), "block study");
  if(!Array.isArray(input.studies)||input.studies.length>6)throw Error("Use at most six implemented studies.");
  const imported = feature?.type === "imported-step";
  const sketchBased = ["extrude", "revolve"].includes(feature?.type);
  if (
    !feature ||
    (!imported && !sketchBased &&
      (feature.type !== "block" ||
        !Array.isArray(feature.dimensions) ||
        feature.dimensions.length !== 3))
  )
    throw Error(
      "Use a block, sketch extrusion/revolution or imported STEP solid as the base feature.",
    );
  if ((imported || sketchBased) && input.features.slice(1).some((f) => f?.type === "through-hole"))
    throw Error(
      "Imported and sketch-based solids cannot have downstream through-hole features in this release; use a base block.",
    );
  if (
    !Array.isArray(input.materials) ||
    !input.materials.length ||
    input.materials.length > 32
  )
    throw Error("Include 1–32 materials.");
  const source = {
    parameters: input.parameters.map((p) => ({
      id: identity(p.id),
      name: p.name,
      expression: expression(p.expression),
    })),
    features: [
      {
        id: identity(feature.id),
        bodyId: identity(feature.bodyId),
        type: feature.type,
        name: text(feature.name, "Feature name"),
        ...(imported
          ? {
              fileName: text(feature.fileName, "STEP file name"),
              stepText: validateSTEPText(feature.stepText),
            }
          : sketchBased ? { sketchId: identity(feature.sketchId), ...(feature.type === "extrude" ? { distance: expression(feature.distance) } : { angle: expression(feature.angle) }) }
          : { dimensions: feature.dimensions.map(expression) }),
        materialId: identity(feature.materialId),
      },
    ],
    materials: input.materials.map((m) => resolveMaterial(m,values).source),
    physics: [],
    meshes: [],
    studies: [],
  };
  if (
    physics?.type !== "heat-conduction" ||
    physics.bodyId !== feature.bodyId ||
    !Array.isArray(physics.boundaries) ||
    physics.boundaries.length !== 2
  )
    throw Error("Specify thermal conditions on two opposite faces of the block.");
  const axis = [0, 1, 2].find(
    (a) =>
      physics.boundaries[0]?.entityId === faceId(feature.bodyId, a, 0) &&
      physics.boundaries[1]?.entityId === faceId(feature.bodyId, a, 1),
  );
  if (
    axis === undefined ||
    physics.boundaries.some((b) => !["temperature", "convection"].includes(b.type))
  )
    throw Error(
      "Temperature or convection boundaries must reference the minimum and maximum faces of the same axis.",
    );
  source.physics.push({
    id: identity(physics.id),
    type: "heat-conduction",
    bodyId: feature.bodyId,
    boundaries: physics.boundaries.map((b) => ({
      entityId: b.entityId,
      type: b.type,
      ...(b.type === "temperature" ? { expression: expression(b.expression) }
        : { ambient: expression(b.ambient), coefficient: expression(b.coefficient) }),
    })),
    heatGeneration: expression(physics.heatGeneration),
  });
  if (
    mesh?.type !== "structured-hex" ||
    mesh.bodyId !== feature.bodyId ||
    !Array.isArray(mesh.cells) ||
    mesh.cells.length !== 3 ||
    mesh.cells.some((n) => !Number.isInteger(n) || n < 2 || n > 64) ||
    mesh.cells.reduce((a, b) => a * b, 1) > 32768
  )
    throw Error(
      "Use 2–64 cells per axis, with no more than 32,768 cells in total.",
    );
  source.meshes.push({
    id: identity(mesh.id),
    bodyId: feature.bodyId,
    type: "structured-hex",
    cells: [...mesh.cells],
  });
  const volumeMeshInputs = input.meshes.filter(m => m.type === 'gmsh-tetra');
  if (volumeMeshInputs.length) source.meshes.push(resolveVolumeMesh(volumeMeshInputs[0], values, feature.bodyId).source);
  if (
    study?.type !== "steady-state" ||
    study.solverId !== SOLVER ||
    study.physicsId !== physics.id ||
    study.meshId !== mesh.id
  )
    throw Error("Unsupported study, solver, or missing study reference.");
  source.studies.push({
    id: identity(study.id),
    name: text(study.name, "Study name"),
    type: "steady-state",
    physicsId: physics.id,
    meshId: mesh.id,
    solverId: SOLVER,
  });
  const implemented=[['heat-conduction-tetra','hc-thermal-fem-1',resolveFemPhysics],['linear-elasticity','hc-structural-fem-1',resolveStructuralPhysics],['elastic-vibration','hc-modal-fem-1',resolveModalPhysics],['harmonic-elasticity','hc-harmonic-fem-1',resolveHarmonicPhysics],['dc-conduction','hc-electric-fem-1',resolveElectricPhysics]];
  if(input.studies.some(s=>![SOLVER,...implemented.map(i=>i[1])].includes(s.solverId)))throw Error('This solver is not implemented.');
  for(const [physicsType,solverId,resolve]of implemented){
    const definitions=input.physics.filter(p=>p.type===physicsType),studies=input.studies.filter(s=>s.solverId===solverId);
    if(definitions.length>1||studies.length>1||definitions.length!==studies.length)throw Error('Each optional physics module needs exactly one matching study.');
    if(!definitions.length)continue;
    const definition=resolve(definitions[0],values,feature.bodyId).source,study=studies[0],tetra=source.meshes.find(m=>m.type==='gmsh-tetra');
    if(!tetra)throw Error('CAD field studies require a tetrahedral mesh definition.');
    assertStudy(study,definition,tetra);source.physics.push(definition);source.studies.push({id:identity(study.id),name:text(study.name,'Study name'),type:study.type,physicsId:definition.id,meshId:tetra.id,solverId,...(solverId==='hc-modal-fem-1'?{modeCount:modalCount(study.modeCount)}:{}),...(solverId==='hc-harmonic-fem-1'?{sweep:harmonicSweep(study.sweep,values).source}:{})});
  }
  if (!Array.isArray(input.sketches ?? []) || (input.sketches ?? []).length > 25)
    throw Error("Include at most 25 referenced profile sketches.");
  const sketches = (input.sketches || []).map((sk) => resolveSketch(sk, values));
  if (sketches.length) source.sketches = sketches.map((sk) => sk.source);
  const usedSketches = new Set();
  const findSketch = (sketchId) => {
    const found = sketches.find((sk) => sk.source.id === sketchId);
    if (!found) throw Error("The solid references a missing sketch.");
    usedSketches.add(sketchId);
    return found;
  };
  const sketch = sketchBased ? findSketch(feature.sketchId) : null;
  const operation = sketch ? resolveSketchOperation(source.features[0], sketch, values) : null;
  const allIds = [
    ...source.parameters,
    ...(source.sketches || []),
    ...source.features,
    ...source.materials,
    ...source.physics,
    ...source.meshes,
    ...source.studies,
  ]
    .map((o) => o.id)
    .concat(feature.bodyId);
  if (new Set(allIds).size !== allIds.length)
    throw Error("Object IDs must be unique.");
  const size = imported || sketchBased
    ? null
    : feature.dimensions.map((e) => quantity(e, dimensions.length, values));
  if (
    !imported && !sketchBased &&
    (size.some((n) => n < 1e-6 || n > 1000) ||
      Math.max(...size) / Math.min(...size) > 1e4)
  )
    throw Error(
      "Block dimensions must be 1 µm–1000 m, with aspect ratio at most 10,000.",
    );
  const holes = [], operations = [];
  if (input.features.slice(1).filter((f) => f?.type === "through-hole").length > 8)
    throw Error("Use at most eight through-hole features.");
  for (const f of input.features.slice(1)) {
    if (EDGE_KINDS.includes(f?.type)) {
      if (f.bodyId !== feature.bodyId || typeof f.suppressed !== 'boolean')
        throw Error('An edge treatment needs the base body and a suppression state.');
      const normalized = {id:identity(f.id),bodyId:feature.bodyId,type:f.type,name:text(f.name,'Feature name'),
        suppressed:f.suppressed,size:expression(f.size),selection:normalizeEdgeSelection(f.selection)};
      const size = quantity(normalized.size,dimensions.length,values);
      if (size < 1e-6 || size > 1000) throw Error(`${f.name}: radius or chamfer distance must be 1 µm–1000 m.`);
      source.features.push(normalized);operations.push({...normalized,size});continue;
    }
    if (["extrude", "revolve"].includes(f?.type)) {
      if (f.bodyId !== feature.bodyId || !["union", "subtract", "intersect"].includes(f.operation) || typeof f.suppressed !== "boolean")
        throw Error("A sketch operation needs the base body, union/subtract/intersect and a suppression state.");
      const normalized = { id: identity(f.id), bodyId: feature.bodyId, type: f.type, name: text(f.name, "Feature name"),
        sketchId: identity(f.sketchId), operation: f.operation, suppressed: f.suppressed,
        ...(f.type === "extrude" ? { distance: expression(f.distance) } : { angle: expression(f.angle) }) };
      const profile = findSketch(normalized.sketchId);
      const solid = resolveSketchOperation(normalized, profile, values);
      source.features.push(normalized);
      operations.push({ ...normalized, sketch: profile, solid });
      continue;
    }
    if (
      !f ||
      f.type !== "through-hole" ||
      f.bodyId !== feature.bodyId ||
      ![0, 1, 2].includes(f.axis) ||
      !Array.isArray(f.center) ||
      f.center.length !== 2 ||
      typeof f.suppressed !== "boolean"
    )
      throw Error(
        "A through-hole must reference the base body, an axis, two center expressions and a suppression state.",
      );
    const normalized = {
      id: identity(f.id),
      bodyId: feature.bodyId,
      type: "through-hole",
      name: text(f.name, "Hole name"),
      axis: f.axis,
      center: f.center.map(expression),
      diameter: expression(f.diameter),
      suppressed: f.suppressed,
    };
    const center = normalized.center.map((e) =>
      quantity(e, dimensions.length, values),
    );
    const diameter = quantity(normalized.diameter, dimensions.length, values);
    if (diameter < 1e-6 || diameter > 1000)
      throw Error(`${f.name}: diameter must be 1 µm–1000 m.`);
    const plane = [0, 1, 2].filter((a) => a !== f.axis);
    if (
      !f.suppressed &&
      center.some(
        (c, i) =>
          c - diameter / 2 < 1e-6 || c + diameter / 2 > size[plane[i]] - 1e-6,
      )
    )
      throw Error(
        `${f.name}: keep the complete hole inside the block, with at least 1 µm clearance from each side.`,
      );
    source.features.push(normalized);
    holes.push({ ...normalized, center, diameter, plane });
  }
  if (sketches.some((sk) => !usedSketches.has(sk.source.id)))
    throw Error("Sketches must be referenced by an extrusion or revolution feature.");
  const featureIds = source.features.map((f) => f.id);
  if (
    new Set([...allIds, ...featureIds.slice(1)]).size !==
    allIds.length + featureIds.length - 1
  )
    throw Error("Object IDs must be unique.");
  const materials = source.materials.map(m=>resolveMaterial(m,values));
  const material = materials.find((m) => m.id === feature.materialId);
  if (!material) throw Error("The body references a missing material.");
  const boundaries = source.physics[0].boundaries.map((b) => ({
    type: b.type,
    temperature: quantity(b.type === "temperature" ? b.expression : b.ambient, dimensions.temperature, values),
    coefficient: b.type === "convection" ? quantity(b.coefficient, dimensions.heatTransfer, values) : null,
  }));
  if (boundaries.some((b) => b.type === "convection" && (b.coefficient < 1e-6 || b.coefficient > 1e8)))
    throw Error("Convection coefficients must be 0.000001–100,000,000 W/(m²·K), strictly positive.");
  const temperatures = boundaries.map((b) => b.temperature);
  if (temperatures.some((t) => t < 0 || t > 5000))
    throw Error("Face and ambient temperatures must be 0–5000 K.");
  const heatGeneration = quantity(
    physics.heatGeneration,
    dimensions.heatSource,
    values,
  );
  if (Math.abs(heatGeneration) > 1e12)
    throw Error("Heat generation magnitude must not exceed 10¹² W/m³.");
  return {
    source,
    values,
    size,
    material,
    materials,
    axis,
    temperatures,
    boundaries,
    heatGeneration,
    holes,
    imported,
    sketchBased,
    sketches,
    operations,
    sketch,
    operation,
    thermalSupported: !imported && !sketchBased && input.features.slice(1).every((f) => f.suppressed),
    cells: [...mesh.cells],
  };
}
export const THERMAL_GEOMETRY_LIMIT =
  "Thermal meshing and solving support a parametric uncut block only. Imported STEP and sketch-based solids are not supported; suppress or remove all downstream operations on a parametric block to use this study. Use CAD thermal study for a tetrahedral finite-element solution on a general solid.";
export const THERMAL_MATERIAL_LIMIT = 'This thermal solver requires constant, isotropic conductivity. The material curve is retained, but variable-conductivity solving is not implemented. Choose a constant conductivity to run this study.';
export const thermalSourceIssue = model => !model.thermalSupported ? THERMAL_GEOMETRY_LIMIT : model.material.k===null ? THERMAL_MATERIAL_LIMIT : '';
export function requireThermalSource(source) {
  const model = validateSource(source);
  const issue=thermalSourceIssue(model);if(issue)throw Error(issue);
  return model;
}
// Exact canonical serialization is used for equality, avoiding hash collisions.
export function fingerprint(source) {
  return JSON.stringify(validateSource(source).source);
}
export function isCurrent(project, result) {
  return (
    result.provenance.projectId === project.id &&
    result.provenance.fingerprint === fingerprint(project.source)
  );
}
export function validateResult(r, { imported = false } = {}) {
  if (
    !r ||
    !id(r.id) ||
    !r.provenance ||
    r.provenance.solverId !== SOLVER ||
    typeof r.provenance.fingerprint !== "string"
  )
    throw Error("Invalid solution provenance.");
  identity(r.provenance.projectId);
  if (
    !Number.isSafeInteger(r.provenance.revision) ||
    r.provenance.revision < 0 ||
    !Number.isFinite(Date.parse(r.provenance.createdAt))
  )
    throw Error("Invalid solution revision or date.");
  const resolved = requireThermalSource(r.provenance.source),
    count = resolved.cells.reduce((a, b) => a * b, 1);
  if (
    r.provenance.fingerprint !== JSON.stringify(resolved.source) ||
    !Array.isArray(r.temperatures) ||
    r.temperatures.length !== count ||
    r.temperatures.some((t) => !Number.isFinite(t) || t < 0 || t > 1e30)
  )
    throw Error("Solution data does not match its source snapshot.");
  if (
    !Number.isInteger(r.iterations) ||
    r.iterations < 0 ||
    !Number.isFinite(r.residual) ||
    r.residual < 0
  )
    throw Error("Invalid solver diagnostics.");
  return {
    id: r.id,
    provenance: {
      projectId: r.provenance.projectId,
      revision: r.provenance.revision,
      createdAt: r.provenance.createdAt,
      solverId: SOLVER,
      fingerprint: r.provenance.fingerprint,
      source: resolved.source,
      settings: { relativeTolerance: 1e-10, maxIterations: 6000, ...(r.provenance.settings?.implementation==='HammerCraft Rust'&&r.provenance.settings.version==='0.1.0'?{implementation:'HammerCraft Rust',version:'0.1.0'}:{}) },
    },
    temperatures: [...r.temperatures],
    iterations: r.iterations,
    residual: r.residual,
    verified: imported ? false : r.verified === true,
  };
}
export function validateProject(input, { imported = false } = {}) {
  if (!input || input.format !== FORMAT || input.schemaVersion !== 1)
    throw Error("Open a version 1 .hcengineering.json project.");
  const source = validateSource(input.source).source;
  const project = {
    format: FORMAT,
    schemaVersion: 1,
    id: identity(input.id),
    name: text(input.name, "Project name"),
    revision: input.revision,
    source,
    results: [],
    versions: [],
    sweeps: [],
    convergenceChecks: [],
    measurements: [],
  };
  if (!Number.isSafeInteger(input.revision) || input.revision < 0)
    throw Error("Invalid project revision.");
  if (
    !Array.isArray(input.results) ||
    input.results.length > 8 ||
    !Array.isArray(input.versions) ||
    input.versions.length > 20
  )
    throw Error("Project limits: 8 results and 20 named versions.");
  project.results = input.results.map((r) => validateResult(r, { imported }));
  for (const v of input.versions)
    project.versions.push({
      id: identity(v.id),
      name: text(v.name, "Version name"),
      source: validateSource(v.source).source,
    });
  if (!Array.isArray(input.sweeps ?? []) || (input.sweeps ?? []).length > 5)
    throw Error("A project can retain up to five parameter sweeps.");
  project.sweeps = (input.sweeps ?? []).map((sweep) =>
    validateSweepRecord(sweep, requireThermalSource, SOLVER, imported),
  );
  if (!Array.isArray(input.convergenceChecks ?? []) || (input.convergenceChecks ?? []).length > 3)
    throw Error("A project can retain up to three mesh-convergence checks.");
  project.convergenceChecks = (input.convergenceChecks ?? []).map((record) =>
    validateConvergenceRecord(record, requireThermalSource, validateResult, SOLVER, imported),
  );
  if (!Array.isArray(input.measurements ?? []) || (input.measurements ?? []).length > 6)
    throw Error("A project can retain up to six measurement datasets. Remove a dataset before adding another.");
  project.measurements = (input.measurements ?? []).map(validateMeasurement);
  if (new Set(project.measurements.map((m) => m.id)).size !== project.measurements.length)
    throw Error("Measurement IDs must be unique.");
  if (!Array.isArray(input.volumeMeshes ?? []) || (input.volumeMeshes ?? []).length > 3) throw Error('A project can retain up to three CAD volume meshes.');
  project.volumeMeshes = (input.volumeMeshes ?? []).map(record => validateVolumeMeshRecord(record, validateSource, imported));
  if (new Set(project.volumeMeshes.map(m => m.id)).size !== project.volumeMeshes.length) throw Error('Volume mesh IDs must be unique.');
  if(!Array.isArray(input.femResults ?? []) || (input.femResults ?? []).length>3)throw Error('Retain at most three CAD thermal solutions.');
  project.femResults=(input.femResults ?? []).map(r=>validateFemRecord(r,validateSource,imported));
  if(new Set(project.femResults.map(r=>r.id)).size!==project.femResults.length)throw Error('CAD solution IDs must be unique.');
  if(!Array.isArray(input.electricResults??[])||(input.electricResults??[]).length>3)throw Error('Retain at most three electrical solutions.');
  project.electricResults=(input.electricResults??[]).map(r=>validateElectricRecord(r,validateSource,imported));
  if(new Set(project.electricResults.map(r=>r.id)).size!==project.electricResults.length)throw Error('Electrical solution IDs must be unique.');
  if(!Array.isArray(input.harmonicResults??[])||(input.harmonicResults??[]).length>2)throw Error('Retain at most two harmonic sweeps.');
  project.harmonicResults=(input.harmonicResults??[]).map(r=>validateHarmonicRecord(r,validateSource,imported));
  if(new Set(project.harmonicResults.map(r=>r.id)).size!==project.harmonicResults.length)throw Error('Harmonic solution IDs must be unique.');
  if(!Array.isArray(input.modalResults??[])||(input.modalResults??[]).length>3)throw Error('Retain at most three eigenfrequency solutions.');
  project.modalResults=(input.modalResults??[]).map(r=>validateModalRecord(r,validateSource,imported));
  if(new Set(project.modalResults.map(r=>r.id)).size!==project.modalResults.length)throw Error('Modal solution IDs must be unique.');
  if(!Array.isArray(input.structuralResults??[])||(input.structuralResults??[]).length>3)throw Error('Retain at most three structural solutions.');
  project.structuralResults=(input.structuralResults??[]).map(r=>validateStructuralRecord(r,validateSource,imported));
  if(new Set(project.structuralResults.map(r=>r.id)).size!==project.structuralResults.length)throw Error('Structural solution IDs must be unique.');
  const savedFields = new Map(project.results.map((r) => [r.id, r]));
  for (const check of project.convergenceChecks) for (const row of check.rows) {
    if (!row.result) continue;
    const saved = savedFields.get(row.result.id);
    if (saved && JSON.stringify(saved) !== JSON.stringify(row.result))
      throw Error("A mesh check field conflicts with a saved solution using the same ID.");
  }
  if (
    new Set(project.results.map((r) => r.id)).size !== project.results.length ||
    new Set(project.versions.map((v) => v.id)).size !== project.versions.length ||
    new Set(project.sweeps.map((s) => s.id)).size !== project.sweeps.length ||
    new Set(project.convergenceChecks.map((s) => s.id)).size !== project.convergenceChecks.length
  )
    throw Error("Result, version, sweep and mesh check IDs must be unique within each collection.");
  return project;
}
export class ProjectHistory {
  constructor(project) {
    this.project = validateProject(project);
    this.past = [];
    this.future = [];
  }
  update(source, name = this.project.name) {
    const next = validateSource(source).source;
    text(name, "Project name");
    if (
      JSON.stringify(next) === JSON.stringify(this.project.source) &&
      name === this.project.name
    )
      return false;
    this.past.push(this.snapshot());
    if (this.past.length > 40) this.past.shift();
    this.future = [];
    this.project = {
      ...this.project,
      source: next,
      name,
      revision: this.project.revision + 1,
    };
    return true;
  }
  move(from, to) {
    const next = from.pop();
    if (!next) return false;
    to.push(this.snapshot());
    this.project = {
      ...this.project,
      ...next,
      revision: this.project.revision + 1,
    };
    return true;
  }
  undo() {
    return this.move(this.past, this.future);
  }
  redo() {
    return this.move(this.future, this.past);
  }
  snapshot() {
    return { source: this.project.source, name: this.project.name, measurements: this.project.measurements };
  }
  setMeasurements(measurements) {
    const candidate = validateProject({ ...this.project, measurements, revision: this.project.revision + 1 });
    this.past.push(this.snapshot());
    if (this.past.length > 40) this.past.shift();
    this.future = [];
    this.project = candidate;
  }
  addResult(result) {
    const candidate = validateProject({
      ...this.project,
      results: [...this.project.results.slice(-7), result],
    });
    this.project = candidate;
  }
  addElectricResult(record){this.project=validateProject({...this.project,electricResults:[...this.project.electricResults.slice(-2),record]});}
  addHarmonicResult(record){this.project=validateProject({...this.project,harmonicResults:[...this.project.harmonicResults.slice(-1),record]});}
  addModalResult(record){this.project=validateProject({...this.project,modalResults:[...this.project.modalResults.slice(-2),record]});}
  addStructuralResult(record){this.project=validateProject({...this.project,structuralResults:[...this.project.structuralResults.slice(-2),record]});}
  addFemResult(record) {
    this.project=validateProject({...this.project,femResults:[...this.project.femResults.slice(-2),record]});
  }
  addVolumeMesh(record) {
    this.project = validateProject({ ...this.project, volumeMeshes: [...this.project.volumeMeshes.slice(-2), record] });
  }
  addSweep(sweep) {
    this.project = validateProject({
      ...this.project,
      sweeps: [...this.project.sweeps.slice(-4), sweep],
    });
  }
  addConvergence(record) {
    this.project = validateProject({
      ...this.project,
      convergenceChecks: [...this.project.convergenceChecks.slice(-2), record],
    });
  }
  checkpoint(name, versionId = globalThis.crypto.randomUUID()) {
    this.project.versions = [
      ...this.project.versions.slice(-19),
      {
        id: versionId,
        name: text(name, "Version name"),
        source: clone(this.project.source),
      },
    ];
  }
}
