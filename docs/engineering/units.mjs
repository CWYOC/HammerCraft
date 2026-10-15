import {runtime} from './rust-runtime.mjs';
// SI quantities and a deliberately small, non-executable expression language.
// Dimensions: length, mass, time, current, temperature.
const ZERO = [0, 0, 0, 0, 0];
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
export function evaluate(expression,resolve=()=>undefined){
  if(typeof expression!=='string')throw Error('Enter an expression of 1–512 characters.');
  return JSON.parse(runtime.evaluate_expression(expression,resolve));
}
export function parameters(list){
  if(!Array.isArray(list))throw Error('A project supports up to 64 parameters.');
  return new Map(Object.entries(JSON.parse(runtime.resolve_parameters(JSON.stringify(list)))));
}
export function quantity(expression,dim,values=new Map()){
  const result=evaluate(expression,name=>values.get(name));
  if(!sameDimension(result.dim,dim))throw Error(`Expected ${dimensionLabel(dim)}; received ${dimensionLabel(result.dim)}.`);
  return result.value;
}
