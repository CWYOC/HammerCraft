// SI quantities and a deliberately small, non-executable expression language.
// Dimensions: length, mass, time, current, temperature.
const ZERO = [0, 0, 0, 0, 0];
const q = (value, dim = ZERO) => ({ value, dim: [...dim] });
export const dimensions = {
  scalar: ZERO,
  length: [1, 0, 0, 0, 0],
  temperature: [0, 0, 0, 0, 1],
  density: [-3, 1, 0, 0, 0],
  conductivity: [1, 1, -3, 0, -1],
  heatTransfer: [0, 1, -3, 0, -1],
  heatSource: [-1, 1, -3, 0, 0],
  pressure: [-1, 1, -2, 0, 0],
  frequency: [0, 0, -1, 0, 0],
  specificHeat: [2, 0, -2, 0, -1],
  thermalExpansion: [0, 0, 0, 0, -1],
  electricalConductivity: [-3, -1, 3, 2, 0],
  resistivity: [3, 1, -3, -2, 0],
  permittivity: [-3, -1, 4, 2, 0],
  permeability: [1, 1, -2, -2, 0],
  magneticField: [-1, 0, 0, 1, 0],
  fluxDensity: [0, 1, -2, -1, 0],
  speed: [1, 0, -1, 0, 0],
  viscosity: [-1, 1, -1, 0, 0],
  attenuation: [-1, 0, 0, 0, 0],
};
const units = Object.create(null);
// New aliases must not invalidate names in saved projects from earlier releases.
const materialUnitNames = new Set('S kS MS T mT Wb MHz bar psi uF µF nF pF percent Np'.split(' '));
function unit(names, scale, dim) {
  for (const name of names.split(" ")) units[name] = q(scale, dim);
}
unit("m", 1, dimensions.length);
unit("mm", 0.001, dimensions.length);
unit("cm", 0.01, dimensions.length);
unit("um µm", 1e-6, dimensions.length);
unit("in", 0.0254, dimensions.length);
unit("ft", 0.3048, dimensions.length);
unit("kg", 1, [0, 1, 0, 0, 0]);
unit("g", 0.001, [0, 1, 0, 0, 0]);
unit("s", 1, [0, 0, 1, 0, 0]);
unit("min", 60, [0, 0, 1, 0, 0]);
unit("h", 3600, [0, 0, 1, 0, 0]);
unit("A", 1, [0, 0, 0, 1, 0]);
unit("mA", 0.001, [0, 0, 0, 1, 0]);
unit("K", 1, dimensions.temperature);
unit("N", 1, [1, 1, -2, 0, 0]);
unit("kN", 1000, [1, 1, -2, 0, 0]);
unit("Pa", 1, [-1, 1, -2, 0, 0]);
unit("kPa", 1e3, [-1, 1, -2, 0, 0]);
unit("MPa", 1e6, [-1, 1, -2, 0, 0]);
unit("GPa", 1e9, [-1, 1, -2, 0, 0]);
unit("J", 1, [2, 1, -2, 0, 0]);
unit("W", 1, [2, 1, -3, 0, 0]);
unit("kW", 1000, [2, 1, -3, 0, 0]);
unit("V", 1, [2, 1, -3, -1, 0]);
unit("ohm", 1, [2, 1, -3, -2, 0]);
unit("Hz", 1, [0, 0, -1, 0, 0]);
unit("kHz", 1000, [0, 0, -1, 0, 0]);
unit("F", 1, [-2, -1, 4, 2, 0]);
unit("H", 1, [2, 1, -2, -2, 0]);
unit("S", 1, [-2, -1, 3, 2, 0]);
unit("kS", 1e3, [-2, -1, 3, 2, 0]);
unit("MS", 1e6, [-2, -1, 3, 2, 0]);
unit("T", 1, dimensions.fluxDensity);
unit("mT", 1e-3, dimensions.fluxDensity);
unit("Wb", 1, [2, 1, -2, -1, 0]);
unit("MHz", 1e6, dimensions.frequency);
unit("bar", 1e5, dimensions.pressure);
unit("psi", 6894.757293168, dimensions.pressure);
unit("uF µF", 1e-6, [-2, -1, 4, 2, 0]);
unit("nF", 1e-9, [-2, -1, 4, 2, 0]);
unit("pF", 1e-12, [-2, -1, 4, 2, 0]);
unit("percent", .01, ZERO);
unit("Np", 1, ZERO);
unit("rad", 1, ZERO);
unit("deg", Math.PI / 180, ZERO);
unit("pi", Math.PI, ZERO);
export const sameDimension = (a, b) =>
  a.every((v, i) => Math.abs(v - b[i]) < 1e-10);
export function dimensionLabel(dim) {
  const label = dim
    .map((v, i) =>
      v ? `${["m", "kg", "s", "A", "K"][i]}${v === 1 ? "" : "^" + v}` : "",
    )
    .filter(Boolean)
    .join(" · ");
  return label || "dimensionless";
}
export function evaluate(expression, resolve = () => undefined) {
  if (
    typeof expression !== "string" ||
    !expression.trim() ||
    expression.length > 512
  )
    throw Error("Enter an expression of 1–512 characters.");
  // Affine Celsius is accepted only as a complete literal. Compound expressions use K.
  const celsius = expression
    .trim()
    .match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(?:degC|°C)$/i);
  if (celsius) {
    const value = Number(celsius[1]) + 273.15;
    if (!Number.isFinite(value) || value < 0)
      throw Error("Temperature must be at or above absolute zero.");
    return q(value, dimensions.temperature);
  }
  const tokens = [];
  let offset = 0;
  while (offset < expression.length) {
    const rest = expression.slice(offset),
      space = rest.match(/^\s+/);
    if (space) {
      offset += space[0].length;
      continue;
    }
    const match = rest.match(
      /^(?:(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_µ][A-Za-z0-9_µ]*|[()+\-*/^])/,
    );
    if (!match)
      throw Error(
        `Unexpected character at position ${offset + 1}. Use K in compound temperature expressions.`,
      );
    tokens.push(match[0]);
    offset += match[0].length;
  }
  if (tokens.length > 160) throw Error("Expression is too complex.");
  let pos = 0;
  const peek = () => tokens[pos];
  function checked(result) {
    if (!Number.isFinite(result.value))
      throw Error(
        "Expression produced an invalid number (check division by zero).",
      );
    return result;
  }
  function atom() {
    const token = tokens[pos++];
    if (token === "(") {
      const value = sum();
      if (tokens[pos++] !== ")") throw Error("Missing closing parenthesis.");
      return value;
    }
    if (/^(?:\d|\.)/.test(token || "")) return checked(q(Number(token)));
    if (/^[A-Za-z_µ]/.test(token || "")) {
      const value = materialUnitNames.has(token) ? resolve(token) || units[token] : units[token] || resolve(token);
      if (!value) throw Error(`Unknown parameter or unit: ${token}.`);
      return q(value.value, value.dim);
    }
    throw Error("Expected a number, parameter, unit, or parenthesis.");
  }
  function power() {
    let left = atom();
    if (peek() === "^") {
      pos++;
      const right = unary();
      if (!sameDimension(right.dim, ZERO) || Math.abs(right.value) > 12)
        throw Error("Exponents must be dimensionless and between −12 and 12.");
      left = checked(
        q(
          left.value ** right.value,
          left.dim.map((d) => d * right.value),
        ),
      );
    }
    return left;
  }
  function unary() {
    if (peek() === "+" || peek() === "-") {
      const sign = tokens[pos++] === "-" ? -1 : 1,
        value = unary();
      return q(sign * value.value, value.dim);
    }
    return power();
  }
  function product() {
    let left = unary();
    while (
      peek() === "*" ||
      peek() === "/" ||
      peek() === "(" ||
      /^[A-Za-z_µ]/.test(peek() || "")
    ) {
      const divide = peek() === "/";
      if (peek() === "*" || divide) pos++;
      const right = unary(),
        sign = divide ? -1 : 1;
      left = checked(
        q(
          divide ? left.value / right.value : left.value * right.value,
          left.dim.map((d, i) => d + sign * right.dim[i]),
        ),
      );
    }
    return left;
  }
  function sum() {
    let left = product();
    while (peek() === "+" || peek() === "-") {
      const sign = tokens[pos++] === "+" ? 1 : -1,
        right = product();
      if (!sameDimension(left.dim, right.dim))
        throw Error(
          `Incompatible dimensions: ${dimensionLabel(left.dim)} and ${dimensionLabel(right.dim)}.`,
        );
      left = checked(q(left.value + sign * right.value, left.dim));
    }
    return left;
  }
  const result = sum();
  if (pos !== tokens.length) throw Error(`Unexpected token: ${peek()}.`);
  return result;
}
export function parameters(list) {
  if (!Array.isArray(list) || list.length > 64)
    throw Error("A project supports up to 64 parameters.");
  const definitions = new Map(),
    values = new Map(),
    visiting = new Set();
  for (const item of list) {
    if (
      !item ||
      !/^[A-Za-z_][A-Za-z0-9_]{0,47}$/.test(item.name) ||
      (units[item.name] && !materialUnitNames.has(item.name)) ||
      ["degC", "__proto__", "constructor", "prototype"].includes(item.name)
    )
      throw Error(
        "Parameter names must be unique identifiers and cannot be unit names.",
      );
    if (definitions.has(item.name))
      throw Error(`Duplicate parameter: ${item.name}.`);
    definitions.set(item.name, item.expression);
  }
  const resolve = (name) => {
    if (values.has(name)) return values.get(name);
    if (!definitions.has(name)) return undefined;
    if (visiting.has(name))
      throw Error(`Circular parameter dependency at ${name}.`);
    visiting.add(name);
    let value;
    try {
      value = evaluate(definitions.get(name), resolve);
    } catch (error) {
      throw Error(`${name}: ${error.message}`);
    }
    visiting.delete(name);
    values.set(name, value);
    return value;
  };
  for (const name of definitions.keys()) resolve(name);
  return values;
}
export function quantity(expression, dim, values = new Map()) {
  const result = evaluate(expression, (name) => values.get(name));
  if (!sameDimension(result.dim, dim))
    throw Error(
      `Expected ${dimensionLabel(dim)}; received ${dimensionLabel(result.dim)}.`,
    );
  return result.value;
}
