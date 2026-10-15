import { fingerprint, isCurrent } from "./project.mjs";
import { dimensionLabel } from "./units.mjs";
import { bestSweepRow, resolveSweep, sweepFeasible, sweepValue, SWEEP_OBJECTIVES } from "./sweep-data.mjs";

const number = (n) => Number(n).toLocaleString(undefined, { maximumSignificantDigits: 5 });
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function button(label, action) {
  const node = el("button", label);
  node.type = "button";
  node.onclick = action;
  return node;
}

export function renderSweepComparison(panel, record, project, { busy, onApply, onExport }) {
  panel.replaceChildren();
  panel.append(el("span", "OPTIMIZE / PARAMETER STUDY", "eyebrow"), el("h1", "Compare design candidates"));
  if (!record) {
    panel.append(el("p", "Choose a global parameter, a range and an objective, then run a sweep.", "sweep-intro"));
    const empty = el("div", undefined, "sweep-empty");
    empty.append(el("span", "01 → 02 → 03", "eyebrow"), el("h2", "One variable. Real thermal solutions."),
      el("p", "Each sample regenerates the block and runs the same thermal study. Compare mass, temperature and heat flow, then apply a candidate to your design."),
      el("p", "The sweep keeps your current design in place until you apply a sample.", "note"));
    panel.append(empty);
    return;
  }
  const source = record.provenance.source, spec = resolveSweep(source, record.settings),
    best = bestSweepRow(record), completed = record.rows.filter((r) => r.status === "Completed"),
    feasible = completed.filter((r) => sweepFeasible(record, r)),
    current = fingerprint(project.source), axis = source.physics[0].boundaries[0].entityId.match(/:face:([xyz])-min$/)[1].toUpperCase();
  panel.append(el("p", `${spec.parameter.name} · ${spec.settings.start} → ${spec.settings.end} · ${spec.settings.samples} samples`, "sweep-intro"));
  const summary = el("div", undefined, "sweep-summary");
  for (const [value, label] of [[`${record.rows.length}/${spec.settings.samples}`, record.status],
    [String(feasible.length), "Feasible"], [best ? `#${best.index + 1}` : "—", "Best tested"]]) {
    const card = el("div");
    card.append(el("strong", value), el("span", label));
    summary.append(card);
  }
  panel.append(summary);
  const provenance = el("p", undefined, "note");
  provenance.textContent = `Source r${record.provenance.revision} · ${isCurrent(project, record) ? "matches current inputs" : "earlier inputs"} · ${record.verified ? "computed locally" : "imported metrics · unverified"}. ${SWEEP_OBJECTIVES[record.settings.objective]}.`;
  panel.append(provenance);
  const referenceMass = typeof source.materials.find(m => m.id === source.features[0].materialId).density !== 'string';
  if (referenceMass) panel.append(el('p', 'Mass and mass constraints use density at each sample’s explicit material reference condition. Thermal expansion and deformation are excluded. The CSV records each reference coordinate.', 'callout'));
  if (record.settings.maxMass || record.settings.maxTemperature)
    panel.append(el("p", `Limits: ${[record.settings.maxMass && `mass ≤ ${record.settings.maxMass}`,
      record.settings.maxTemperature && `temperature ≤ ${record.settings.maxTemperature}`].filter(Boolean).join(" · ")}.`, "note"));
  if (record.status !== "Running" && !best)
    panel.append(el("p", completed.length ? "No tested candidate meets these limits. Adjust the range or limits and run again."
      : "No successful samples. Inspect the diagnostics below and adjust the setup.", "callout"));
  const scroll = el("div", undefined, "sweep-table-scroll");
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", "Sweep candidates; scroll for all measurements");
  const table = el("table", undefined, "sweep-table"), head = el("thead"), header = el("tr");
  for (const title of ["Sample", `${spec.parameter.name} / ${dimensionLabel(spec.dim)}`, referenceMass ? "Reference mass / g" : "Mass / g", "Max T / °C", `${axis}+ heat out / W`, "Status", "Design"])
    header.append(el("th", title));
  head.append(header);
  table.append(head);
  const body = el("tbody");
  for (const row of record.rows) {
    const tr = el("tr");
    if (best?.index === row.index) tr.classList.add("sweep-best");
    const applied = row.fingerprint === current;
    const status = row.status === "Failed" ? "Failed" : !sweepFeasible(record, row) ? "Over limit"
      : best?.index === row.index ? "Best tested" : "Feasible";
    for (const text of [`#${row.index + 1}`, number(sweepValue(source, record.settings, row.index).value),
      row.metrics ? number(row.metrics.mass * 1000) : "—", row.metrics ? number(row.metrics.maxTemperature - 273.15) : "—",
      row.metrics ? number(row.metrics.heatOutMax) : "—", status]) tr.append(el("td", text));
    const action = el("td"), apply = button(applied ? "Applied" : `Apply #${row.index + 1}`, () => onApply(record, row));
    apply.disabled = busy || applied || row.status !== "Completed";
    apply.title = "Restore this sample's complete geometry, material, physics and mesh inputs. Undo restores your current design.";
    action.append(apply);
    tr.append(action);
    body.append(tr);
    if (row.error) {
      const diagnostic = el("tr"), cell = el("td", row.error, "sweep-error");
      cell.colSpan = 7;
      diagnostic.append(cell);
      body.append(diagnostic);
    }
  }
  table.append(body);
  scroll.append(table);
  panel.append(scroll);
  const actions = el("div", undefined, "sweep-actions"), csv = button("Export sweep CSV", () => onExport(record));
  csv.disabled = record.status === "Running" || !record.rows.length;
  actions.append(csv);
  panel.append(actions, el("p", "Apply restores the sample’s full input snapshot as one undoable edit. Use Solve thermal, then Analyze, to inspect its temperature field. CSV contains SI metrics; Export project also preserves the exact source snapshots.", "note"));
}

export function drawSweepPlot(parent, record) {
  const spec = resolveSweep(record.provenance.source, record.settings), best = bestSweepRow(record),
    objective = record.settings.objective,
    metric = (row) => objective === "mass" ? row.metrics.mass * 1000
      : objective === "temperature" ? row.metrics.maxTemperature - 273.15 : row.metrics.heatOutMax,
    unit = objective === "mass" ? "g" : objective === "temperature" ? "°C" : "W",
    rows = record.rows.filter((r) => r.status === "Completed");
  if (!rows.length) {
    parent.append(el("p", "Successful samples will appear here as the study runs.", "note"));
    return;
  }
  const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 640 135");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${SWEEP_OBJECTIVES[objective]} versus ${spec.parameter.name}. Each point is one solved sample; amber marks the best feasible sample.`);
  svg.classList.add("plot");
  const add = (tag, attrs, text) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    svg.append(node);
    return node;
  };
  let min = Math.min(...rows.map(metric)), max = Math.max(...rows.map(metric));
  const padding = (max - min) * 0.1 || Math.max(Math.abs(max) * 0.01, 0.5);
  min -= padding; max += padding;
  for (let i = 0; i < 3; i++) {
    const y = 15 + i * 42;
    add("line", { x1: 72, x2: 610, y1: y, y2: y, stroke: "#34434d" });
    add("text", { x: 63, y: y + 4, fill: "#96aab7", "text-anchor": "end", "font-size": 10 }, `${number(max - i * (max - min) / 2)} ${unit}`);
  }
  for (const row of rows) {
    const value = sweepValue(record.provenance.source, record.settings, row.index).value,
      point = add("circle", { cx: 72 + (value - spec.start) / (spec.end - spec.start) * 538,
        cy: 99 - (metric(row) - min) / (max - min) * 84, r: best?.index === row.index ? 5 : 3.5,
        fill: best?.index === row.index ? "#e6ad6b" : sweepFeasible(record, row) ? "#73c4cd" : "#849098" });
    const title = document.createElementNS(NS, "title");
    title.textContent = `Sample ${row.index + 1}: ${number(value)} ${dimensionLabel(spec.dim)}, ${number(metric(row))} ${unit}`;
    point.append(title);
  }
  add("text", { x: 72, y: 124, fill: "#96aab7", "font-size": 10 }, number(spec.start));
  add("text", { x: 340, y: 124, fill: "#96aab7", "text-anchor": "middle", "font-size": 10 }, `${spec.parameter.name} / ${dimensionLabel(spec.dim)}`);
  add("text", { x: 610, y: 124, fill: "#96aab7", "text-anchor": "end", "font-size": 10 }, number(spec.end));
  parent.append(svg);
}
