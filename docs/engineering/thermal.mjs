import {runtime,RUST_VERSION} from './rust-runtime.mjs';
// Restricted finite-volume solver: homogeneous orthogonal block, isotropic constant k,
// temperature/convection on opposite faces, other faces insulated, uniform source.
// Cell-centred conservative discretization of -div(k grad T) = q. All inputs are SI.
import { requireThermalSource as validateSource, SOLVER } from "./project.mjs";
import { boundaryTransfers, surfaceTemperature } from "./thermal-boundaries.mjs";
export const SETTINGS = { relativeTolerance: 1e-10, maxIterations: 6000 };
export function meshInfo(source) {
  const model = validateSource(source),
    { size, cells } = model;
  const spacing = size.map((x, i) => x / cells[i]);
  return {
    type: "structured-hex",
    cells: [...cells],
    count: cells.reduce((a, b) => a * b, 1),
    nodes: cells.reduce((a, b) => a * (b + 1), 1),
    spacing,
    volume: size.reduce((a, b) => a * b, 1),
    cellVolume: spacing.reduce((a, b) => a * b, 1),
  };
}
function system(source) {
  const model = validateSource(source),
    mesh = meshInfo(source),
    { cells, axis, temperatures, material, heatGeneration } = model;
  const strides = [1, cells[0], cells[0] * cells[1]],
    conductance = mesh.spacing.map(
      (h) => (material.k * mesh.cellVolume) / (h * h),
    );
  const diagonal = new Float64Array(mesh.count),
    rhs = new Float64Array(mesh.count);
  const transfers = boundaryTransfers(model, mesh.spacing, mesh.cellVolume);
  for (let p = 0; p < mesh.count; p++) {
    rhs[p] = heatGeneration * mesh.cellVolume;
    for (let a = 0; a < 3; a++) {
      const coord = Math.floor(p / strides[a]) % cells[a],
        g = conductance[a];
      for (let side = 0; side < 2; side++) {
        const boundary = side ? coord === cells[a] - 1 : coord === 0;
        if (!boundary) diagonal[p] += g;
        else if (a === axis) {
          diagonal[p] += transfers[side].conductance;
          rhs[p] += transfers[side].conductance * temperatures[side];
        }
      }
    }
  }
  function multiply(x, out) {
    for (let p = 0; p < mesh.count; p++) {
      // Sum face differences directly: a nearly uniform field must not lose its
      // small convective balance by subtracting two large diagonal products.
      let value = 0;
      for (let a = 0; a < 3; a++) {
        const coord = Math.floor(p / strides[a]) % cells[a];
        if (coord > 0) value += conductance[a] * (x[p] - x[p - strides[a]]);
        else if (a === axis) value += transfers[0].conductance * x[p];
        if (coord < cells[a] - 1) value += conductance[a] * (x[p] - x[p + strides[a]]);
        else if (a === axis) value += transfers[1].conductance * x[p];
      }
      out[p] = value;
    }
  }
  return { model, mesh, diagonal, rhs, multiply, conductance, strides, transfers };
}
export function solveThermal(source,progress=()=>{}){
  const model=validateSource(source);
  const request={size:model.size,cells:model.cells,axis:model.axis,conductivity:model.material.k,heatGeneration:model.heatGeneration,boundaries:model.boundaries};
  return JSON.parse(runtime.solve_block(JSON.stringify(request),(iterations,residual)=>progress({iterations,residual})));
}
export function makeResult(
  project,
  data,
  resultId,
  createdAt = new Date().toISOString(),
) {
  const source = validateSource(project.source).source;
  return {
    id: resultId,
    ...data,
    verified: true,
    provenance: {
      projectId: project.id,
      revision: project.revision,
      createdAt,
      solverId: SOLVER,
      settings: { ...SETTINGS, implementation: 'HammerCraft Rust', version: RUST_VERSION },
      source,
      fingerprint: JSON.stringify(source),
    },
  };
}
export function summarize(result) {
  const { model, mesh, strides, transfers } = system(
      result.provenance.source,
    ),
    { axis, cells, heatGeneration } = model;
  const profile = Array(cells[axis]).fill(0),
    counts = Array(cells[axis]).fill(0),
    heatOut = [0, 0], surfaceTotals = [0, 0];
  let min = Infinity, max = -Infinity;
  result.temperatures.forEach((t, i) => {
    const coord = Math.floor(i / strides[axis]) % cells[axis];
    profile[coord] += t;
    counts[coord]++;
    min = Math.min(min, t);
    max = Math.max(max, t);
    for (const side of [0, 1]) if (coord === (side ? cells[axis] - 1 : 0)) {
      const surface = surfaceTemperature(transfers[side], t);
      surfaceTotals[side] += surface;
      min = Math.min(min, surface); max = Math.max(max, surface);
      heatOut[side] += transfers[side].conductance * (t - transfers[side].reference);
    }
  });
  const boundaryTemperatures = surfaceTotals.map((sum, side) => model.boundaries[side].type === "temperature"
    ? transfers[side].reference : sum / counts[side ? cells[axis] - 1 : 0]);
  const generatedHeat = heatGeneration * mesh.volume,
    balanceError = heatOut[0] + heatOut[1] - generatedHeat;
  return {
    min,
    max,
    heatOut,
    generatedHeat,
    balanceError,
    boundaryTemperatures,
    mass: mesh.volume * model.material.rho,
    profile: [
      [0, boundaryTemperatures[0]],
      ...profile.map((t, i) => [(i + 0.5) * mesh.spacing[axis], t / counts[i]]),
      [model.size[axis], boundaryTemperatures[1]],
    ],
    model,
    mesh,
  };
}
export function temperatureSampler(result) {
  const model = validateSource(result.provenance.source), { size, cells, axis } = model,
    spacing = size.map((v, i) => v / cells[i]),
    transfers = boundaryTransfers(model, spacing, spacing.reduce((a, b) => a * b, 1));
  return function sample(point) {
    if (
      !Array.isArray(point) ||
      point.length !== 3 ||
      point.some((v, i) => !Number.isFinite(v) || v < 0 || v > size[i])
    )
      throw Error("Probe must be inside the solved block.");
    const coords = point.map((v, i) => (v / size[i]) * cells[i] - 0.5),
      base = coords.map(Math.floor),
      fractions = coords.map((v, i) => v - base[i]);
    let value = 0;
    for (let z = 0; z < 2; z++)
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < 2; x++) {
          const sides = [x, y, z],
            raw = base.map((v, i) => v + sides[i]),
            indexes = raw.map((v, i) => Math.max(0, Math.min(cells[i] - 1, v)));
          let t =
            result.temperatures[
              indexes[0] + cells[0] * (indexes[1] + cells[1] * indexes[2])
            ];
          if (raw[axis] < 0) t = 2 * surfaceTemperature(transfers[0], t) - t;
          if (raw[axis] >= cells[axis]) t = 2 * surfaceTemperature(transfers[1], t) - t;
          const weight = sides.reduce(
            (w, s, i) => w * (s ? fractions[i] : 1 - fractions[i]),
            1,
          );
          value += weight * t;
        }
    return value;
  };
}
export function sampleTemperature(result, point) {
  return temperatureSampler(result)(point);
}
export function surfaceMesh(size, divisions = [1, 1, 1]) {
  const faces = [];
  for (let axis = 0; axis < 3; axis++)
    for (let side = 0; side < 2; side++) {
      const a = (axis + 1) % 3,
        b = (axis + 2) % 3,
        normal = [0, 0, 0];
      normal[axis] = side ? 1 : -1;
      for (let i = 0; i < divisions[a]; i++)
        for (let j = 0; j < divisions[b]; j++) {
          const points = [
            [i, j],
            [i + 1, j],
            [i + 1, j + 1],
            [i, j + 1],
          ].map(([u, v]) => {
            const p = [0, 0, 0];
            p[axis] = side * size[axis];
            p[a] = (u / divisions[a]) * size[a];
            p[b] = (v / divisions[b]) * size[b];
            return p;
          });
          if (!side) points.reverse();
          faces.push({ points, normal, axis, side });
        }
    }
  return faces;
}
export function exportSTL(source) {
  const { size } = validateSource(source),
    lines = ["solid engineering_block_mm"];
  for (const face of surfaceMesh(size))
    for (const indices of [
      [0, 1, 2],
      [0, 2, 3],
    ]) {
      lines.push(`facet normal ${face.normal.join(" ")}`, "outer loop");
      for (const index of indices)
        lines.push(
          `vertex ${face.points[index].map((v) => v * 1000).join(" ")}`,
        );
      lines.push("endloop", "endfacet");
    }
  lines.push("endsolid engineering_block_mm");
  return lines.join("\n");
}
