import { resolveMeasurement, csvCell } from "./measurement-data.mjs";
import { summarize } from "./thermal.mjs";
import { isCurrent } from "./project.mjs";

// Linear interpolation of the actual saved cell-layer means, never an analytical substitute.
export function interpolateProfile(profile, x) {
  if (x < profile[0][0] || x > profile.at(-1)[0]) return null;
  let low = 0, high = profile.length - 1;
  while (high - low > 1) { const mid = (low + high) >> 1; if (profile[mid][0] <= x) low = mid; else high = mid; }
  const a = profile[low], b = profile[high];
  return a[1] + (b[1] - a[1]) * ((x - a[0]) / (b[0] - a[0]));
}
export function compareMeasurement(record, result) {
  const { points, mapping } = resolveMeasurement(record);
  if (mapping.x.quantity !== "position" || mapping.y.quantity !== "temperature")
    return { compatible: false, reason: "A simulation overlay is available for position versus temperature only." };
  const summary = summarize(result);
  if (mapping.positionAxis !== summary.model.axis)
    return { compatible: false, reason: `Dataset uses ${"XYZ"[mapping.positionAxis]}; this solution varies along ${"XYZ"[summary.model.axis]}.` };
  const rows = points.map((p) => {
    const predicted = interpolateProfile(summary.profile, p.x);
    return { ...p, predicted, error: predicted === null ? null : predicted - p.y };
  });
  const used = rows.filter((r) => r.error !== null), n = used.length;
  // Incremental means and a scaled sum of squares keep bounded finite inputs finite.
  let bias = 0, mae = 0, max = 0;
  used.forEach((r, i) => { bias += (r.error - bias) / (i + 1); mae += (Math.abs(r.error) - mae) / (i + 1); max = Math.max(max, Math.abs(r.error)); });
  const rmse = max ? max * Math.sqrt(used.reduce((sum, r) => sum + (r.error / max) ** 2, 0) / n) : 0;
  return { compatible: true, rows, profile: summary.profile, count: n, excluded: rows.length - n,
    metrics: n ? { rmse, mae, bias, max } : null };
}
export function measurementComparisonCSV(record, results, project) {
  const rows = [["measurement_id", "source_file", "source_record", "position_m", "measured_K", "predicted_K", "simulation_minus_measurement_K", "status", "solution_id", "project_id", "revision", "solver", "solved_at", "verified", "current_inputs"]];
  for (const result of results) {
    const comparison = compareMeasurement(record, result);
    if (!comparison.compatible) throw Error(comparison.reason);
    for (const row of comparison.rows) rows.push([record.id, record.fileName, row.record, row.x, row.y, row.predicted ?? "", row.error ?? "",
      row.predicted === null ? "outside-solved-domain" : "compared", result.id, result.provenance.projectId, result.provenance.revision,
      result.provenance.solverId, result.provenance.createdAt, result.verified, isCurrent(project, result)]);
  }
  if (!results.length) throw Error("Select at least one compatible saved solution.");
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
