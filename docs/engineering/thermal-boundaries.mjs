// Local half-cell conduction and film resistances in series. Inputs are resolved SI.
export function boundaryTransfers(model, spacing, cellVolume) {
  const distance = spacing[model.axis], area = cellVolume / distance;
  const halfResistance = distance / (2 * model.material.k);
  return model.boundaries.map((b) => {
    if (b.type === "temperature") return { conductance: 2 * model.material.k * cellVolume / distance ** 2, surfaceWeight: 0, reference: b.temperature };
    const filmResistance = 1 / b.coefficient, total = halfResistance + filmResistance;
    return { conductance: area / total, surfaceWeight: filmResistance / total, reference: b.temperature };
  });
}
export function surfaceTemperature(transfer, cellTemperature) {
  return transfer.reference + transfer.surfaceWeight * (cellTemperature - transfer.reference);
}

// Independent continuum benchmark, from -k T'' = q and the two endpoint conditions.
// r = 0 for prescribed temperature, or 1/h for a convective film (per-unit-area resistance).
// This expression is used only for error reporting, never to generate numerical fields.
export function analyticalTemperature(model, x) {
  const L = model.size[model.axis], k = model.material.k, q = model.heatGeneration;
  const [b0, b1] = model.boundaries, r0 = b0.coefficient === null ? 0 : 1 / b0.coefficient,
    r1 = b1.coefficient === null ? 0 : 1 / b1.coefficient;
  const outwardMin = (b1.temperature - b0.temperature + q * L * (r1 + L / (2 * k))) / (r0 + L / k + r1);
  return b0.temperature + outwardMin * (r0 + x / k) - q * x * x / (2 * k);
}
