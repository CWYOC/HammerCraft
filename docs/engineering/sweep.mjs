import { requireThermalSource, SOLVER, fingerprint } from "./project.mjs";
import { makeResult, solveThermal, summarize } from "./thermal.mjs";
import { resolveSweep, sweepSource, SWEEP_METHOD } from "./sweep-data.mjs";

export function createSweep(project, settings, id, createdAt = new Date().toISOString()) {
  const source = requireThermalSource(project.source).source;
  return {
    id, method: SWEEP_METHOD, status: "Running", verified: true,
    provenance: { projectId: project.id, revision: project.revision, createdAt,
      solverId: SOLVER, fingerprint: fingerprint(source), source,
      settings: { relativeTolerance: 1e-10, maxIterations: 6000 } },
    settings: resolveSweep(source, settings).settings, rows: [],
  };
}

export function runSweep(project, settings, id, progress = () => {}) {
  const record = createSweep(project, settings, id);
  for (let index = 0; index < record.settings.samples; index++) {
    progress({ index, total: record.settings.samples });
    let row;
    try {
      const source = requireThermalSource(sweepSource(record.provenance.source, record.settings, index)).source;
      const solution = solveThermal(source, (detail) => progress({ index, total: record.settings.samples, ...detail }));
      const result = makeResult({ ...project, source }, solution, `${id}.${index}`);
      const summary = summarize(result);
      row = {
        index, status: "Completed", fingerprint: fingerprint(source),
        iterations: solution.iterations, residual: solution.residual,
        metrics: { mass: summary.mass, minTemperature: summary.min, maxTemperature: summary.max,
          heatOutMin: summary.heatOut[0], heatOutMax: summary.heatOut[1],
          generatedHeat: summary.generatedHeat, balanceError: summary.balanceError },
      };
    } catch (error) {
      row = { index, status: "Failed", error: String(error.message || error).slice(0, 1000) };
    }
    record.rows.push(row);
    progress({ index, total: record.settings.samples, row });
  }
  record.status = "Completed";
  return record;
}
