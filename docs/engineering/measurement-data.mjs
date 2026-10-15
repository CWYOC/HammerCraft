import { evaluate } from "./units.mjs";

export const MAX_MEASUREMENT_BYTES = 256 * 1024;
export const MAX_MEASUREMENT_POINTS = 5000;
export const MEASUREMENT_FORMAT = "hc-xy-measurement-1";
// Unit choices use the shared engineering unit engine; Celsius is affine.
export const XY_QUANTITIES = {
  position: { label: "Position / displacement", si: "m", units: ["m", "mm", "cm", "um", "in"] },
  time: { label: "Time", si: "s", units: ["s", "min", "h"] },
  frequency: { label: "Frequency", si: "Hz", units: ["Hz", "kHz"] },
  temperature: { label: "Temperature", si: "K", units: ["degC", "K"] },
  pressure: { label: "Pressure", si: "Pa", units: ["Pa", "kPa", "MPa"] },
  force: { label: "Force", si: "N", units: ["N", "kN"] },
  voltage: { label: "Voltage", si: "V", units: ["V"] },
  current: { label: "Current", si: "A", units: ["A", "mA"] },
  impedance: { label: "Impedance magnitude", si: "ohm", units: ["ohm"] },
  flow: { label: "Volume flow rate", si: "m^3/s", units: ["m^3/s", "cm^3/s", "cm^3/min"] },
  scalar: { label: "Dimensionless", si: "1", units: ["1"] },
};
const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const plainObject = (v) => v && typeof v === "object" && !Array.isArray(v);
function label(value, name) {
  if (typeof value !== "string" || !value.trim() || value.length > 160) throw Error(`${name} must contain 1–160 characters.`);
  return value;
}
export function parseMeasurementTable(input, delimiter = ",") {
  if (typeof input !== "string" || new TextEncoder().encode(input).length > MAX_MEASUREMENT_BYTES)
    throw Error("Measurement files must be UTF-8 text, no larger than 256 KiB.");
  if (!input.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffd]/.test(input)) throw Error("Measurement file is empty or contains invalid text.");
  if (![",", ";", "\t"].includes(delimiter)) throw Error("Choose comma, semicolon or tab as the delimiter.");
  const text = input.replace(/^\ufeff/, ""), rows = [];
  let row = [], field = "", quoted = false, closed = false;
  const pushField = () => {
    row.push(field);
    if (row.length > 32) throw Error("A measurement file supports at most 32 columns.");
    field = ""; closed = false;
  };
  const pushRow = () => {
    pushField();
    if (!(row.length === 1 && !row[0].trim())) rows.push(row);
    row = [];
    if (rows.length > MAX_MEASUREMENT_POINTS + 1) throw Error("A measurement supports at most 5,000 points.");
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += c;
    } else if (c === delimiter) pushField();
    else if (c === "\r" || c === "\n") { pushRow(); if (c === "\r" && text[i + 1] === "\n") i++; }
    else if (c === '"' && !field && !closed) quoted = true;
    else {
      if (closed || c === '"') throw Error("Malformed quoted CSV field.");
      field += c;
    }
  }
  if (quoted) throw Error("Unclosed quoted CSV field.");
  if (row.length || field || closed) pushRow();
  if (!rows.length || rows[0].length < 2) throw Error("Choose a delimiter that produces at least two columns.");
  if (rows.some((r) => r.length !== rows[0].length)) throw Error("Every nonblank row must have the same number of columns.");
  return rows;
}
export function measurementAxis(input) {
  if (!plainObject(input) || !Object.hasOwn(XY_QUANTITIES, input.quantity) || !XY_QUANTITIES[input.quantity].units.includes(input.unit))
    throw Error("Choose a supported quantity and a compatible unit for each axis.");
  return { quantity: input.quantity, unit: input.unit };
}
export function axisScale(axis) {
  measurementAxis(axis);
  return axis.unit === "degC" ? { scale: 1, offset: 273.15 } : { scale: evaluate(axis.unit).value, offset: 0 };
}
export function displayValue(si, axis) {
  const { scale, offset } = axisScale(axis);
  return (si - offset) / scale;
}
export function resolveMeasurement(input) {
  const m = input?.mapping;
  if (!plainObject(m) || typeof m.header !== "boolean") throw Error("Specify whether the measurement file has a header row.");
  const rows = parseMeasurementTable(input.csv, m.delimiter), x = measurementAxis(m.x), y = measurementAxis(m.y);
  if (![m.xColumn, m.yColumn].every((i) => Number.isInteger(i) && i >= 0 && i < rows[0].length) || m.xColumn === m.yColumn)
    throw Error("Map two different existing columns to X and Y.");
  if (x.quantity === "position" ? ![0, 1, 2].includes(m.positionAxis) : m.positionAxis !== null)
    throw Error("Position data needs its X, Y or Z model axis; other quantities use no model axis.");
  const data = m.header ? rows.slice(1) : rows;
  if (!data.length || data.length > MAX_MEASUREMENT_POINTS) throw Error("Include 1–5,000 measurement points.");
  const xs = axisScale(x), ys = axisScale(y);
  const value = (raw, axis, conversion, record, column) => {
    if (!numeric.test(raw.trim())) throw Error(`Record ${record}, column ${column + 1}: enter a finite number with a decimal point, without units or formulas.`);
    const v = Number(raw) * conversion.scale + conversion.offset;
    if (!Number.isFinite(v) || Math.abs(v) > 1e100) throw Error(`Record ${record}: measurement magnitude is outside the supported range.`);
    if (["temperature", "frequency", "impedance"].includes(axis.quantity) && v < 0) throw Error(`Record ${record}: ${axis.quantity} cannot be negative in SI units.`);
    return v;
  };
  const points = data.map((row, index) => {
    const record = index + (m.header ? 2 : 1);
    return { record, x: value(row[m.xColumn], x, xs, record, m.xColumn), y: value(row[m.yColumn], y, ys, record, m.yColumn) };
  });
  return { mapping: { delimiter: m.delimiter, header: m.header, xColumn: m.xColumn, yColumn: m.yColumn, x, y, positionAxis: m.positionAxis }, points, columns: rows[0].length };
}
export function validateMeasurement(input) {
  if (!plainObject(input) || input.format !== MEASUREMENT_FORMAT || typeof input.id !== "string" || !/^[A-Za-z0-9_.-]{1,100}$/.test(input.id)) throw Error("Invalid measurement format or ID.");
  const name = label(input.name, "Measurement name"), fileName = label(input.fileName, "Measurement file name");
  if (typeof input.importedAt !== "string" || input.importedAt.length > 40 || !Number.isFinite(Date.parse(input.importedAt))) throw Error("Invalid measurement import timestamp.");
  const { mapping } = resolveMeasurement(input);
  return { format: MEASUREMENT_FORMAT, id: input.id, name, fileName, importedAt: input.importedAt, mapping, csv: input.csv };
}
export function createMeasurement(csv, mapping, name, fileName, id = crypto.randomUUID(), importedAt = new Date().toISOString()) {
  return validateMeasurement({ format: MEASUREMENT_FORMAT, id, name, fileName, importedAt, mapping, csv });
}
export function csvCell(value) {
  let text = String(value ?? "");
  if (typeof value === "string" && /^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function measurementCSV(record) {
  const { points, mapping } = resolveMeasurement(record);
  return [[`x_${XY_QUANTITIES[mapping.x.quantity].si}`, `y_${XY_QUANTITIES[mapping.y.quantity].si}`, "source_record", "measurement_id", "measurement_name", "source_file", "imported_at"],
    ...points.map((p) => [p.x, p.y, p.record, record.id, record.name, record.fileName, record.importedAt])].map((r) => r.map(csvCell).join(",")).join("\r\n");
}
