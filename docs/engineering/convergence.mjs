import { requireThermalSource, SOLVER, fingerprint } from "./project.mjs";
import { solveThermal, makeResult, summarize, SETTINGS } from "./thermal.mjs";
import { CONVERGENCE_METHOD, refinementSettings, refinementSource } from "./convergence-data.mjs";
import { analyticalTemperature } from "./thermal-boundaries.mjs";

export function createConvergence(project, input, id, createdAt = new Date().toISOString()) {
  const source = requireThermalSource(project.source).source;
  return { id, method: CONVERGENCE_METHOD, status: "Running", verified: true,
    provenance: { projectId: project.id, revision: project.revision, createdAt,
      solverId: SOLVER, source, fingerprint: fingerprint(source), settings: { ...SETTINGS } },
    settings: refinementSettings(input), rows: [],
  };
}

export function runConvergence(project, settings, id, progress = () => {}) {
  const record = createConvergence(project, settings, id);
  for (let index = 0; index < record.settings.levels; index++) {
    const source = refinementSource(record.provenance.source, record.settings, index);
    progress({ index, total: record.settings.levels, cells: source.meshes[0].cells });
    let row;
    try {
      const solution = solveThermal(source, (detail) => progress({ index, total: record.settings.levels, ...detail }));
      row = { index, status: "Completed", result: makeResult({ ...project, source }, solution, `${id}.${index}`) };
    } catch (error) {
      row = { index, status: "Failed", error: String(error.message || error).slice(0, 1000) };
    }
    record.rows.push(row);
    progress({ index, total: record.settings.levels, row });
  }
  record.status = "Completed";
  return record;
}

function profileValue(profile, x) {
  let i = 1;
  while (i < profile.length - 1 && profile[i][0] < x) i++;
  const [x0, y0] = profile[i - 1], [x1, y1] = profile[i];
  return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
}

// A difference of two piecewise-linear profiles reaches its absolute maximum
// at a knot of either profile. No fixed probe grid can hide a between-probe peak.
export function profileDifference(a, b) {
  if (a[0][0] !== b[0][0] || a.at(-1)[0] !== b.at(-1)[0])
    throw Error("Temperature profiles must span the same physical interval.");
  let max = 0;
  for (const [x] of [...a, ...b])
    max = Math.max(max, Math.abs(profileValue(a, x) - profileValue(b, x)));
  return max;
}

// Closed-form solution for this restricted homogeneous block, derived directly
// from -k T'' = q with temperature or convection at the ends. Independent of the
// finite-volume operator and its boundary discretization.
export function analyticalCellError(result, model = requireThermalSource(result.provenance.source)) {
  const { axis, size, cells } = model;
  const length = size[axis], stride = [1, cells[0], cells[0] * cells[1]][axis];
  let max = 0;
  result.temperatures.forEach((value, i) => {
    const x = (Math.floor(i / stride) % cells[axis] + 0.5) * length / cells[axis];
    const exact = analyticalTemperature(model, x);
    max = Math.max(max, Math.abs(value - exact));
  });
  return max;
}

export function convergenceRows(record) {
  const rows = [];
  for (const row of record.rows) {
    const cells = record.settings.baseCells.map((n) => n * 2 ** row.index);
    const output = { ...row, cells, count: cells.reduce((a, b) => a * b, 1) };
    if (row.status === "Completed") {
      output.summary = summarize(row.result);
      output.analyticalError = analyticalCellError(row.result, output.summary.model);
      const previous = rows.at(-1);
      if (previous?.status === "Completed") {
        output.temperatureChange = profileDifference(previous.summary.profile, output.summary.profile);
        output.heatChange = Math.max(...output.summary.heatOut.map((q, i) => Math.abs(q - previous.summary.heatOut[i])));
      }
    }
    rows.push(output);
  }
  return rows;
}

export function convergenceAssessment(record, rows = convergenceRows(record)) {
  if (!record.verified) return { kind: "unverified", label: "Imported fields · unverified", detail: "Run a new check to verify these fields locally." };
  if (record.status !== "Completed" || rows.length !== record.settings.levels)
    return { kind: "partial", label: record.status === "Running" ? "Check in progress" : "Partial check", detail: "All requested grids must finish before assessing the final change." };
  if (rows.some((r) => r.status !== "Completed"))
    return { kind: "failed", label: "Some grids failed", detail: "Review the grid diagnostics before using this comparison." };
  const last = rows.at(-1), within = last.temperatureChange <= record.settings.temperatureTolerance && last.heatChange <= record.settings.heatTolerance;
  return { kind: within ? "within" : "above", label: within ? "Within change limits" : "Change limits exceeded",
    detail: `${within ? "The finest two grids meet both requested change limits." : "At least one requested change limit is exceeded between the finest two grids."} This does not establish physical accuracy or an error bound.` };
}

export function convergenceCSV(record) {
  const lines = [["level", "cells_x", "cells_y", "cells_z", "volume_cells", "status", "min_temperature_K", "max_temperature_K",
    "profile_change_K", "heat_rate_change_W", "analytical_cell_error_K", "heat_out_min_W", "heat_out_max_W",
    "generated_heat_W", "energy_imbalance_W", "iterations", "relative_residual", "error", "check_id", "project_id",
    "revision", "solver_id", "created_at", "run_status", "verified", "temperature_change_limit_K", "heat_rate_change_limit_W"]];
  for (const row of convergenceRows(record)) {
    const s = row.summary;
    lines.push([row.index + 1, ...row.cells, row.count, row.status, s?.min, s?.max,
      row.temperatureChange, row.heatChange, row.analyticalError, s?.heatOut[0], s?.heatOut[1], s?.generatedHeat,
      s?.balanceError, row.result?.iterations, row.result?.residual, row.error, record.id, record.provenance.projectId,
      record.provenance.revision, record.provenance.solverId, record.provenance.createdAt, record.status, record.verified,
      record.settings.temperatureTolerance, record.settings.heatTolerance]);
  }
  const quote = (v) => {
    const raw = typeof v === "string" && /^[=+@\t\r\n-]/.test(v) ? `'${v}` : String(v ?? "");
    return `"${raw.replaceAll('"', '""')}"`;
  };
  return lines.map((line) => line.map(quote).join(",")).join("\r\n");
}
