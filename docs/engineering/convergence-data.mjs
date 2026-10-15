export const CONVERGENCE_METHOD = "hc-uniform-refinement-1";
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const identity = (s) => typeof s === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(s);

export function refinementSettings(input) {
  if (!input || !Array.isArray(input.baseCells) || input.baseCells.length !== 3 ||
      input.baseCells.some((n) => !Number.isInteger(n) || n < 2 || n > 64))
    throw Error("Starting grid needs three integer cell counts between 2 and 64.");
  if (!Number.isInteger(input.levels) || input.levels < 2 || input.levels > 4)
    throw Error("Choose 2–4 grids. Each level doubles the cells along every axis.");
  if (!finite(input.temperatureTolerance) || input.temperatureTolerance <= 0 || input.temperatureTolerance > 1e6 ||
      !finite(input.heatTolerance) || input.heatTolerance <= 0 || input.heatTolerance > 1e12)
    throw Error("Enter positive change limits: temperature up to 10⁶ K and heat rate up to 10¹² W.");
  const finest = input.baseCells.map((n) => n * 2 ** (input.levels - 1));
  if (finest.some((n) => n > 64) || finest.reduce((a, b) => a * b, 1) > 32768)
    throw Error("The finest grid exceeds 64 cells per axis or 32,768 total cells. Choose fewer levels or a coarser starting grid.");
  return { baseCells: [...input.baseCells], levels: input.levels,
    temperatureTolerance: input.temperatureTolerance, heatTolerance: input.heatTolerance };
}

export function refinementSource(source, input, index) {
  const settings = refinementSettings(input);
  if (!Number.isInteger(index) || index < 0 || index >= settings.levels)
    throw Error("Invalid refinement level.");
  const candidate = structuredClone(source);
  candidate.meshes[0].cells = settings.baseCells.map((n) => n * 2 ** index);
  return candidate;
}

export function validateConvergenceRecord(input, validateSource, validateResult, solverId, imported = false) {
  const p = input?.provenance;
  if (!input || !identity(input.id) || input.method !== CONVERGENCE_METHOD ||
      !["Completed", "Cancelled", "Failed"].includes(input.status) ||
      !p || !identity(p.projectId) || p.solverId !== solverId ||
      !Number.isSafeInteger(p.revision) || p.revision < 0 ||
      typeof p.createdAt !== "string" || !finite(Date.parse(p.createdAt)) ||
      p.settings?.relativeTolerance !== 1e-10 || p.settings?.maxIterations !== 6000)
    throw Error("Invalid mesh-convergence provenance.");
  const source = validateSource(p.source).source, settings = refinementSettings(input.settings);
  if (p.fingerprint !== JSON.stringify(source))
    throw Error("Mesh check inputs do not match their source fingerprint.");
  if (!Array.isArray(input.rows) || input.rows.length > settings.levels ||
      (input.status === "Completed" && input.rows.length !== settings.levels))
    throw Error("Mesh check row count does not match its execution status.");
  const rows = input.rows.map((row, index) => {
    if (!row || row.index !== index) throw Error("Mesh levels must remain in execution order.");
    if (row.status === "Failed") {
      if (typeof row.error !== "string" || !row.error.length || row.error.length > 1000)
        throw Error("Invalid mesh check failure diagnostic.");
      return { index, status: "Failed", error: row.error };
    }
    const r = row.result;
    if (row.status !== "Completed" || !r || r.id !== `${input.id}.${index}` ||
        r.provenance?.projectId !== p.projectId || r.provenance?.revision !== p.revision ||
        r.provenance?.settings?.relativeTolerance !== 1e-10 || r.provenance?.settings?.maxIterations !== 6000 ||
        !finite(r.residual) || r.residual < 0 || r.residual > 5e-10 || r.iterations > 6000)
      throw Error("Invalid mesh check solution or solver diagnostics.");
    const result = validateResult(r, { imported });
    const candidate = validateSource(refinementSource(source, settings, index)).source;
    if (result.provenance.fingerprint !== JSON.stringify(candidate))
      throw Error("Mesh check solution does not match its prescribed refinement level.");
    return { index, status: "Completed", result };
  });
  return { id: input.id, method: CONVERGENCE_METHOD, status: input.status,
    provenance: { projectId: p.projectId, revision: p.revision, createdAt: p.createdAt,
      solverId, fingerprint: p.fingerprint, source,
      settings: { relativeTolerance: 1e-10, maxIterations: 6000 } },
    settings, rows,
    verified: !imported && input.verified === true && rows.every((r) => !r.result || r.result.verified),
  };
}
