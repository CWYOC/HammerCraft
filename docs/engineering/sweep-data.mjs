import { parameters, quantity, dimensions } from "./units.mjs";
import { resolveMaterial } from './materials.mjs';

export const SWEEP_METHOD = "hc-linear-sweep-1";
export const SWEEP_OBJECTIVES = {
  mass: "Minimize mass",
  temperature: "Minimize maximum temperature",
  "heat-out": "Maximize heat out at the maximum face",
};
const massDimension = [0, 1, 0, 0, 0];
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const identity = (s) => typeof s === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(s);
function expression(value) {
  if (typeof value !== "string" || value.length > 512)
    throw Error("Sweep expressions must contain at most 512 characters.");
  return value.trim();
}
export function siExpression(value, dim) {
  if (!finite(value) || dim.some((n) => !finite(n) || Math.abs(n) > 12))
    throw Error("This parameter cannot be represented as a sweep value.");
  return [String(value), ...dim.flatMap((power, i) =>
    power ? [`${["m", "kg", "s", "A", "K"][i]}^(${power})`] : [],
  )].join("*");
}
export function resolveSweep(source, input) {
  if (!input || !Object.hasOwn(SWEEP_OBJECTIVES, input.objective))
    throw Error("Choose a supported sweep objective.");
  const parameter = source.parameters.find((p) => p.id === input.parameterId);
  if (!parameter) throw Error("Choose an existing global parameter to sweep.");
  const values = parameters(source.parameters), { dim } = values.get(parameter.name);
  const settings = {
    parameterId: parameter.id,
    start: expression(input.start),
    end: expression(input.end),
    samples: input.samples,
    objective: input.objective,
    maxTemperature: expression(input.maxTemperature ?? ""),
    maxMass: expression(input.maxMass ?? ""),
  };
  if (!Number.isInteger(settings.samples) || settings.samples < 2 || settings.samples > 21)
    throw Error("Choose 2–21 evenly spaced samples, including both endpoints.");
  const start = quantity(settings.start, dim, values),
    end = quantity(settings.end, dim, values);
  if (!(end > start) || !finite(end - start))
    throw Error("The sweep end must be greater than its start.");
  siExpression(start, dim);
  const maxTemperature = settings.maxTemperature
    ? quantity(settings.maxTemperature, dimensions.temperature, values) : null;
  const maxMass = settings.maxMass
    ? quantity(settings.maxMass, massDimension, values) : null;
  if (maxTemperature !== null && maxTemperature < 0)
    throw Error("Maximum temperature must be at or above absolute zero.");
  if (maxMass !== null && maxMass <= 0)
    throw Error("Maximum mass must be positive.");
  return { settings, parameter, start, end, dim, maxTemperature, maxMass };
}
export function sweepValue(source, settings, index) {
  const spec = resolveSweep(source, settings);
  if (!Number.isInteger(index) || index < 0 || index >= spec.settings.samples)
    throw Error("Invalid sweep sample index.");
  const value = index === spec.settings.samples - 1 ? spec.end
    : spec.start + (spec.end - spec.start) * index / (spec.settings.samples - 1);
  return { value, expression: siExpression(value, spec.dim), dim: spec.dim };
}
export function sweepSource(source, settings, index) {
  const candidate = structuredClone(source);
  candidate.parameters.find((p) => p.id === settings.parameterId).expression =
    sweepValue(source, settings, index).expression;
  return candidate;
}
export function sweepFeasible(record, row) {
  if (row.status !== "Completed") return false;
  const spec = resolveSweep(record.provenance.source, record.settings);
  const within = (value, limit) => limit === null || value <= limit + Math.max(1, Math.abs(limit)) * 1e-12;
  return within(row.metrics.maxTemperature, spec.maxTemperature) && within(row.metrics.mass, spec.maxMass);
}
export function sweepScore(record, row) {
  return record.settings.objective === "mass" ? row.metrics.mass
    : record.settings.objective === "temperature" ? row.metrics.maxTemperature
      : -row.metrics.heatOutMax;
}
export function bestSweepRow(record) {
  return record.rows.filter((row) => sweepFeasible(record, row))
    .reduce((best, row) => !best || sweepScore(record, row) < sweepScore(record, best) ? row : best, null);
}

// Source validation is injected to keep project schema and execution independent.
export function validateSweepRecord(input, validateSource, solverId, imported = false) {
  const p = input?.provenance;
  if (!input || !identity(input.id) || input.method !== SWEEP_METHOD ||
      !["Completed", "Cancelled", "Failed"].includes(input.status) ||
      !p || !identity(p.projectId) || p.solverId !== solverId ||
      !Number.isSafeInteger(p.revision) || p.revision < 0 ||
      typeof p.createdAt !== "string" || !finite(Date.parse(p.createdAt)) ||
      p.settings?.relativeTolerance !== 1e-10 || p.settings?.maxIterations !== 6000)
    throw Error("Invalid parameter sweep provenance.");
  const source = validateSource(p.source).source;
  if (p.fingerprint !== JSON.stringify(source))
    throw Error("Sweep inputs do not match their source fingerprint.");
  const { settings } = resolveSweep(source, input.settings);
  if (!Array.isArray(input.rows) || input.rows.length > settings.samples ||
      (input.status === "Completed" && input.rows.length !== settings.samples))
    throw Error("Sweep row count does not match its execution status.");
  const rows = input.rows.map((row, index) => {
    if (!row || row.index !== index) throw Error("Sweep samples must be in execution order.");
    if (row.status === "Failed") {
      if (typeof row.error !== "string" || !row.error.length || row.error.length > 1000)
        throw Error("Invalid sweep failure diagnostic.");
      return { index, status: "Failed", error: row.error };
    }
    if (row.status !== "Completed" ||
        !Number.isInteger(row.iterations) || row.iterations < 0 || row.iterations > 6000 ||
        !finite(row.residual) || row.residual < 0 || row.residual > 5e-10)
      throw Error("Invalid sweep solver diagnostics.");
    const candidate = validateSource(sweepSource(source, settings, index)).source;
    if (row.fingerprint !== JSON.stringify(candidate))
      throw Error("Sweep sample does not match its input fingerprint.");
    const metrics = {};
    for (const key of ["minTemperature", "maxTemperature", "mass", "heatOutMin", "heatOutMax", "generatedHeat", "balanceError"]) {
      if (!finite(row.metrics?.[key])) throw Error("Invalid sweep metric.");
      metrics[key] = row.metrics[key];
    }
    if (metrics.minTemperature < 0 || metrics.maxTemperature < metrics.minTemperature || metrics.mass <= 0)
      throw Error("Invalid sweep temperature or mass.");
    return { index, status: "Completed", fingerprint: row.fingerprint, metrics,
      iterations: row.iterations, residual: row.residual };
  });
  return {
    id: input.id, method: SWEEP_METHOD, status: input.status,
    provenance: { projectId: p.projectId, revision: p.revision, createdAt: p.createdAt,
      solverId, fingerprint: p.fingerprint, source,
      settings: { relativeTolerance: 1e-10, maxIterations: 6000 } },
    settings, rows, verified: imported ? false : input.verified === true,
  };
}

export function sweepCSV(record) {
  const quote = (value) => {
    const raw = typeof value === "string" && /^[=+@\t\r\n-]/.test(value) ? `'${value}` : String(value ?? "");
    return `"${raw.replaceAll('"', '""')}"`;
  };
  const lines = [["sample", "parameter", "value_SI", "SI_dimensions", "status", "feasible",
    "mass_kg", "min_temperature_K", "max_temperature_K", "heat_out_min_W", "heat_out_max_W",
    "generated_heat_W", "balance_error_W", "iterations", "relative_residual", "error",
    "sweep_id", "project_id", "revision", "created_at", "solver_id", "objective", "run_status", "verified",
    "start_expression", "end_expression", "max_temperature_constraint", "max_mass_constraint",
    "density_reference_axis", "density_reference_coordinate_SI", "density_reference_clamped"]];
  const spec = resolveSweep(record.provenance.source, record.settings);
  for (const row of record.rows) {
    const value = sweepValue(record.provenance.source, record.settings, row.index), m = row.metrics || {};
    let at;
    if (row.status === 'Completed') {
      const source = sweepSource(record.provenance.source, record.settings, row.index);
      at = resolveMaterial(source.materials.find(m => m.id === source.features[0].materialId), parameters(source.parameters)).densityAt;
    }
    lines.push([row.index + 1, spec.parameter.name, value.value, value.dim.join(" "), row.status,
      sweepFeasible(record, row), m.mass, m.minTemperature, m.maxTemperature, m.heatOutMin, m.heatOutMax,
      m.generatedHeat, m.balanceError, row.iterations, row.residual, row.error,
      record.id, record.provenance.projectId, record.provenance.revision, record.provenance.createdAt,
      record.provenance.solverId, record.settings.objective, record.status, record.verified,
      record.settings.start, record.settings.end, record.settings.maxTemperature, record.settings.maxMass,
      at?.axis, at?.coordinate, at?.clamped]);
  }
  return lines.map((line) => line.map(quote).join(",")).join("\r\n");
}
