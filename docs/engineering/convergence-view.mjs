import { isCurrent, fingerprint } from "./project.mjs";
import { convergenceRows, convergenceAssessment } from "./convergence.mjs";

const number = (value) => value !== 0 && Math.abs(value) < 1e-4 ? value.toExponential(2)
  : Number(value).toLocaleString(undefined, { maximumSignificantDigits: 5 });
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(label, action, disabled = false) {
  const node = element("button", label);
  node.type = "button";
  node.disabled = disabled;
  node.onclick = action;
  return node;
}
export function renderConvergenceComparison(panel, record, project, actions) {
  panel.replaceChildren();
  panel.append(element("span", "SIMULATE / MESH CONVERGENCE", "eyebrow"), element("h1", "Check resolution sensitivity"));
  if (!record) {
    const empty = element("div", undefined, "sweep-empty");
    empty.append(element("h2", "Same study. Finer grids."), element("p", "Solve two to four grids with half the cell spacing at each level. Compare temperature profiles and heat rates, then inspect any saved field in Analyze."),
      element("p", "The current design and mesh stay in place until you choose Use inputs.", "note"));
    panel.append(empty);
    return;
  }
  const rows = convergenceRows(record), assessment = convergenceAssessment(record, rows),
    latest = rows.filter((r) => r.status === "Completed").at(-1), current = fingerprint(project.source);
  panel.append(element("p", `${record.settings.baseCells.join(" × ")} starting cells · 2× refinement per axis · ${record.settings.levels} grids`, "sweep-intro"));
  const cards = element("div", undefined, "sweep-summary");
  for (const [value, label] of [[`${rows.length}/${record.settings.levels}`, record.status],
    [latest ? latest.count.toLocaleString() : "—", "Finest solved cells"],
    [latest?.temperatureChange !== undefined ? `${number(latest.temperatureChange)} K` : "—", "Last profile change"]]) {
    const card = element("div");
    card.append(element("strong", value), element("span", label));
    cards.append(card);
  }
  panel.append(cards);
  const status = element("div", undefined, `convergence-assessment ${assessment.kind}`);
  status.append(element("strong", assessment.label), element("p", assessment.detail));
  panel.append(status, element("p", `Source r${record.provenance.revision} · ${isCurrent(project, record) ? "matches current inputs" : "earlier inputs"} · ${record.verified ? "computed locally" : "imported fields · unverified"}. Limits: profile ≤ ${number(record.settings.temperatureTolerance)} K; heat rate ≤ ${number(record.settings.heatTolerance)} W.`, "note"));
  const scroll = element("div", undefined, "sweep-table-scroll");
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", "Mesh comparison; scroll for all measurements and actions");
  const table = element("table", undefined, "sweep-table"), head = element("thead"), headings = element("tr");
  for (const label of ["Grid", "Cells", "Max T / °C", "Δ profile / K", "Δ heat / W", "Cell error / K", "Field / inputs"])
    headings.append(element("th", label));
  head.append(headings);
  table.append(head);
  const body = element("tbody");
  for (const row of rows) {
    const tr = element("tr");
    if (row === latest) tr.classList.add("convergence-finest");
    for (const value of [`#${row.index + 1}`, row.cells.join("×"),
      row.summary ? number(row.summary.max - 273.15) : "—",
      row.temperatureChange !== undefined ? number(row.temperatureChange) : "—",
      row.heatChange !== undefined ? number(row.heatChange) : "—",
      row.analyticalError !== undefined ? number(row.analyticalError) : "—"])
      tr.append(element("td", value));
    const cell = element("td", undefined, "convergence-row-actions");
    if (row.result) {
      const applied = row.result.provenance.fingerprint === current;
      cell.append(button(`Analyze #${row.index + 1}`, () => actions.onAnalyze(row.result), actions.busy),
        button(applied ? "Applied" : `Use #${row.index + 1}`, () => actions.onApply(row.result), applied || actions.busy));
    } else cell.textContent = "Failed";
    tr.append(cell);
    body.append(tr);
    if (row.error) {
      const diagnostic = element("tr"), error = element("td", row.error, "sweep-error");
      error.colSpan = 7;
      diagnostic.append(error);
      body.append(diagnostic);
    }
  }
  table.append(body);
  scroll.append(table);
  panel.append(scroll);
  const controls = element("div", undefined, "sweep-actions");
  controls.append(button("Export mesh check CSV", () => actions.onExport(record), record.status === "Running" || !rows.length));
  panel.append(controls,
    element("p", "Δ compares adjacent grids: the largest change across the interpolated mean-temperature profile, and across the two boundary heat rates. Cell error compares all solved cells with the analytical solution for this homogeneous block.", "note"),
    element("p", "Analyze opens the retained field. Use restores that grid’s complete geometry, material, physics and mesh inputs as one undoable edit. Export project preserves every field in the three most recent checks.", "note"));
}

export function drawConvergencePlot(parent, record) {
  const rows = convergenceRows(record).filter((r) => r.status === "Completed");
  if (!rows.length) {
    parent.append(element("p", "Each completed grid will add its measured analytical cell error to this chart.", "note"));
    return;
  }
  const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
  svg.classList.add("plot");
  svg.setAttribute("viewBox", "0 0 640 135");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Maximum cell temperature error against the analytical block solution, by refinement level. Each point is a solved grid.");
  const add = (tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, value);
    if (text !== undefined) n.textContent = text;
    svg.append(n);
    return n;
  };
  const max = Math.max(...rows.map((r) => r.analyticalError), 1e-12) * 1.1;
  for (let i = 0; i < 3; i++) {
    const y = 15 + i * 42;
    add("line", { x1: 92, x2: 605, y1: y, y2: y, stroke: "#34434d" });
    add("text", { x: 82, y: y + 4, fill: "#96aab7", "text-anchor": "end", "font-size": 10 }, `${number(max * (1 - i / 2))} K`);
  }
  for (const row of rows) {
    const x = 92 + row.index / (record.settings.levels - 1) * 513;
    const point = add("circle", { cx: x, cy: 99 - row.analyticalError / max * 84, r: 4, fill: "#e6ad6b" });
    const title = document.createElementNS(NS, "title");
    title.textContent = `Grid ${row.index + 1}: ${row.count.toLocaleString()} cells, ${number(row.analyticalError)} K maximum cell error`;
    point.append(title);
    add("text", { x, y: 123, fill: "#96aab7", "text-anchor": "middle", "font-size": 10 }, `${row.count.toLocaleString()} cells`);
  }
  parent.append(svg);
}
