import { defaultSketch } from './sketch.mjs';
import { pruneSketches } from './cad-model.mjs';

export const BOOLEAN_OPERATIONS = [['union', 'Union · add material'], ['subtract', 'Subtract · remove material'], ['intersect', 'Intersect · keep overlap']];
const mm = (m) => `${Number((m * 1000).toPrecision(12))} mm`;
// Defaults use the current solid bounds. Expressions remain user-editable; they are not face attachments.
export function addSketchOperation(source, operation, bounds, ids = {}) {
  if (!BOOLEAN_OPERATIONS.some(([id]) => id === operation)) throw Error('Choose union, subtract or intersect.');
  if (source.features.length >= 25) throw Error('Use at most 24 downstream operations.');
  if (!bounds || bounds.length !== 2 || bounds.some((p) => !Array.isArray(p) || p.length !== 3 || p.some((v) => !Number.isFinite(v)))) throw Error('Wait for a valid CAD solid before adding an operation.');
  const [min, max] = bounds, size = max.map((v, i) => v - min[i]);
  if (size.some((v) => v <= 0)) throw Error('A solid must have positive bounding dimensions.');
  const sk = defaultSketch(ids.sketch || crypto.randomUUID(), operation === 'subtract' ? 'circle' : 'rectangle');
  sk.name = `${operation === 'subtract' ? 'Cut' : operation === 'union' ? 'Boss' : 'Intersection'} profile`;
  const padding = Math.max(1e-6, size[2] * .01);
  sk.origin = ['0 mm', '0 mm', mm(operation === 'union' ? min[2] : min[2] - padding)];
  if (operation === 'subtract') sk.profile = { type: 'circle', center: min.slice(0,2).map((v,i) => mm(v + size[i] / 2)), radius: mm(Math.max(1e-6, Math.min(...size.slice(0,2)) / 5)) };
  else sk.profile = { type: 'rectangle', corner: operation === 'union'
    ? [mm(max[0] - .2 * size[0]), mm(min[1] + .3 * size[1])]
    : [mm(min[0] + .25 * size[0]), mm(min[1] - padding)],
    width: mm(size[0] * (operation === 'union' ? .4 : .75) + (operation === 'union' ? 0 : padding)),
    height: mm(operation === 'union' ? .4 * size[1] : size[1] + 2 * padding) };
  source.sketches ||= []; source.sketches.push(sk);
  const feature = { id: ids.feature || crypto.randomUUID(), bodyId: source.features[0].bodyId, type: 'extrude', name: `${operation[0].toUpperCase() + operation.slice(1)} ${source.features.length}`,
    sketchId: sk.id, operation, suppressed: false, distance: mm(size[2] + (operation === 'union' ? 0 : 2 * padding)) };
  source.features.push(feature);
  return feature.id;
}
export function removeFeature(source, id) {
  const index = source.features.findIndex((f) => f.id === id);
  if (index < 1) throw Error('Only downstream operations can be removed here.');
  source.features.splice(index, 1); pruneSketches(source);
}
export function moveFeature(source, id, offset) {
  if (![1, -1].includes(offset)) throw Error('Move one step earlier or later.');
  const index = source.features.findIndex((f) => f.id === id), next = index + offset;
  if (index < 1 || next < 1 || next >= source.features.length) throw Error('Keep downstream operations after the base feature.');
  [source.features[index], source.features[next]] = [source.features[next], source.features[index]];
}
export function rebindSketch(source, featureId, sketchId) {
  const feature = source.features.find((f) => f.id === featureId);
  if (!feature?.sketchId || !(source.sketches || []).some((sk) => sk.id === sketchId)) throw Error('Choose an existing profile sketch.');
  feature.sketchId = sketchId; pruneSketches(source);
}
export function detachSketch(source, featureId, sketchId = crypto.randomUUID()) {
  const feature = source.features.find((f) => f.id === featureId), original = source.sketches?.find((sk) => sk.id === feature?.sketchId);
  if (!original) throw Error('The feature references a missing sketch.');
  source.sketches.push({ ...structuredClone(original), id: sketchId, name: `${original.name.slice(0, 140)} copy` });
  rebindSketch(source, featureId, sketchId);
}
