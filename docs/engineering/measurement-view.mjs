import { resolveMeasurement, displayValue, XY_QUANTITIES } from "./measurement-data.mjs";
import { compareMeasurement } from "./measurement.mjs";
import { isCurrent } from "./project.mjs";

const colors = ["#e6ad6b", "#aaa5f2", "#9fd59a"];
const number = (v) => Number(v).toLocaleString(undefined, { maximumSignificantDigits: 5 });
function element(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
export function solutionLabel(result, project) {
  return `#${project.results.findIndex((r) => r.id === result.id) + 1} · r${result.provenance.revision} · ${result.provenance.source.meshes[0].cells.join("×")} · ${!result.verified ? "imported / unverified" : isCurrent(project, result) ? "current inputs" : "earlier inputs"}`;
}
export function renderMeasurementReport(panel, record, results, project) {
  panel.replaceChildren(element("span", "ANALYZE / MEASUREMENTS", "eyebrow"), element("h1", record?.name || "Compare with measurements"));
  if (!record) {
    const empty = element("div", undefined, "sweep-empty");
    empty.append(element("h2", "Bring experimental data into the project"), element("p", "Import a CSV or TSV file, map its X/Y columns and units, then inspect the data. Position–temperature datasets can be compared with up to three saved thermal solutions."));
    panel.append(empty);
    return;
  }
  const { points, mapping } = resolveMeasurement(record), series = results.map((r, i) => ({ result: r, color: colors[i], comparison: compareMeasurement(record, r) }));
  panel.append(element("p", `${points.length.toLocaleString()} points · ${record.fileName} · imported data`, "sweep-intro"));
  const plot = element("div", undefined, "measurement-plot");
  plot.tabIndex = 0;
  plot.setAttribute("role", "region"); plot.setAttribute("aria-label", "Measurement plot; scroll horizontally on small screens");
  drawMeasurementPlot(plot, points, mapping, series);
  panel.append(plot);
  panel.append(element("p", "Scroll the chart and error table sideways to see all values on small screens.", "measurement-scroll-hint note"));
  const legend = element("div", undefined, "measurement-legend");
  legend.append(element("span", "● Measurements", "measured-legend"));
  for (const s of series) {
    const item = element("span", `━ ${solutionLabel(s.result, project)}${s.comparison.compatible ? "" : " · incompatible"}`);
    item.style.color = s.color;
    legend.append(item);
  }
  panel.append(legend);
  panel.append(element("p", mapping.x.quantity === "position" && mapping.y.quantity === "temperature"
    ? `Positions are distances from the minimum ${"XYZ"[mapping.positionAxis]} face. Curves use saved cell-layer means. Errors use every in-domain measurement with equal weight; points outside each solution's interval are excluded without extrapolation. No fitting or calibration is applied.`
    : "This dataset is viewable and exportable. A matching simulation comparison is not implemented for these quantities.", "note"));
  const details = element("details"), summary = element("summary", "View measurement values and import mapping");
  details.append(summary, element("p", `X: column ${mapping.xColumn + 1}, ${mapping.x.unit}. Y: column ${mapping.yColumn + 1}, ${mapping.y.unit}. ${mapping.header ? "Header row excluded." : "No header row."} Imported ${record.importedAt}.`, "note"));
  const scroll = element("div", undefined, "sweep-table-scroll");
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region"); scroll.setAttribute("aria-label", "Measurement values; first 100 points");
  const table = element("table", undefined, "sweep-table"), header = element("tr");
  for (const title of ["Source record", `X / ${mapping.x.unit}`, `Y / ${mapping.y.unit}`]) header.append(element("th", title));
  const head = element("thead"); head.append(header); table.append(head);
  const body = element("tbody");
  for (const p of points.slice(0, 100)) {
    const row = element("tr");
    for (const v of [p.record, number(displayValue(p.x, mapping.x)), number(displayValue(p.y, mapping.y))]) row.append(element("td", v));
    body.append(row);
  }
  table.append(body); scroll.append(table); details.append(scroll);
  if (points.length > 100) details.append(element("p", "Showing the first 100 points. All points are plotted, included in metrics and available in CSV.", "note"));
  panel.append(details);
}
function drawMeasurementPlot(parent, points, mapping, series) {
  const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 700 280");
  svg.setAttribute("role", "img"); svg.setAttribute("aria-label", `${XY_QUANTITIES[mapping.y.quantity].label} versus ${XY_QUANTITIES[mapping.x.quantity].label}; measured points and selected saved simulation profiles`);
  const add = (tag, attrs, text) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); if (text !== undefined) el.textContent = text; svg.append(el); return el; };
  const measured = points.map((p) => [displayValue(p.x, mapping.x), displayValue(p.y, mapping.y)]);
  const profiles = series.map((s) => s.comparison.compatible ? s.comparison.profile.map(([x, y]) => [displayValue(x, mapping.x), displayValue(y, mapping.y)]) : []);
  const all = [...measured, ...profiles.flat()];
  let xmin = Math.min(...all.map((p) => p[0])), xmax = Math.max(...all.map((p) => p[0])), ymin = Math.min(...all.map((p) => p[1])), ymax = Math.max(...all.map((p) => p[1]));
  if (xmin === xmax) { const pad = Math.max(Math.abs(xmin) * 0.05, 1); xmin -= pad; xmax += pad; }
  const ypad = Math.max((ymax - ymin) * 0.08, Math.abs(ymax) * 1e-12, 1e-9); ymin -= ypad; ymax += ypad;
  const px = (x) => 80 + (x - xmin) / (xmax - xmin) * 595, py = (y) => 220 - (y - ymin) / (ymax - ymin) * 185;
  const tick = (v) => v !== 0 && (Math.abs(v) < 0.001 || Math.abs(v) >= 1e5) ? v.toExponential(2) : Number(v.toPrecision(4)).toString();
  for (let i = 0; i <= 4; i++) {
    const x = xmin + i * (xmax - xmin) / 4, y = ymin + i * (ymax - ymin) / 4;
    add("line", { x1: 80, x2: 675, y1: py(y), y2: py(y), stroke: "#34434d" });
    add("text", { x: 68, y: py(y) + 4, fill: "#a4b2bb", "font-size": 11, "text-anchor": "end" }, tick(y));
    add("text", { x: px(x), y: 240, fill: "#a4b2bb", "font-size": 11, "text-anchor": "middle" }, tick(x));
  }
  add("text", { x: 80, y: 17, fill: "#e5e9eb", "font-size": 12 }, `${XY_QUANTITIES[mapping.y.quantity].label} / ${mapping.y.unit}`);
  add("text", { x: 375, y: 272, fill: "#e5e9eb", "font-size": 12, "text-anchor": "middle" }, `${XY_QUANTITIES[mapping.x.quantity].label} / ${mapping.x.unit}`);
  profiles.forEach((profile, i) => {
    if (profile.length) add("path", { d: profile.map(([x, y], j) => `${j ? "L" : "M"}${px(x)},${py(y)}`).join(" "), fill: "none", stroke: colors[i], "stroke-width": 2 });
  });
  // One path for bounded large datasets keeps the DOM light; every point is shown.
  add("path", { d: measured.map(([x, y]) => `M${px(x) - 2.5},${py(y)}h5M${px(x)},${py(y) - 2.5}v5`).join(" "), stroke: "#73c4cd", "stroke-width": 1.5, fill: "none" });
  parent.append(svg);
}
export function renderMeasurementMetrics(panel, record, results, project) {
  panel.replaceChildren();
  if (!record || !results.length) { panel.append(element("p", "Select saved thermal solutions to compare. Error metrics use simulation minus measurement, in kelvin.", "empty-note")); return; }
  const scroll = element("div", undefined, "measurement-metrics-scroll"); scroll.tabIndex = 0;
  scroll.setAttribute("role", "region"); scroll.setAttribute("aria-label", "Simulation to measurement error metrics");
  const table = element("table", undefined, "sweep-table"), head = element("thead"), header = element("tr");
  for (const t of ["Saved solution", "Compared / excluded", "RMSE / K", "MAE / K", "Bias / K", "Max |error| / K"]) header.append(element("th", t));
  head.append(header); table.append(head);
  const body = element("tbody");
  results.forEach((r, i) => {
    const c = compareMeasurement(record, r), row = element("tr"), label = element("td", solutionLabel(r, project)); label.style.color = colors[i]; row.append(label);
    if (!c.compatible || !c.metrics) {
      const cell = element("td", c.compatible ? `No points in the solved domain; ${c.excluded} excluded.` : c.reason, "sweep-error"); cell.colSpan = 5; row.append(cell);
    } else for (const v of [`${c.count} / ${c.excluded}`, number(c.metrics.rmse), number(c.metrics.mae), number(c.metrics.bias), number(c.metrics.max)]) row.append(element("td", v));
    body.append(row);
  });
  table.append(body); scroll.append(table); panel.append(scroll);
}
