import { validateSource } from './project.mjs';
import { EDGE_KINDS, edgeSupport } from './topology.mjs';

// Resolved geometry only. Names/materials/display edits do not rebuild the solid.
// Original base/holes definitions retain their canonical geometry keys.
const scale = (p) => p.map((v) => v * 1000);
function sketchDefinition(sk, operation) {
  return {
    ...(sk.profile.type === 'constrained' ? { id: sk.source.id } : {}),
    origin: scale(sk.origin), u: sk.u, v: sk.v, normal: sk.normal,
    profile: sk.profile.type === 'constrained' ? sk.profile : sk.profile.points ? { type: sk.profile.type, points: sk.profile.points.map(scale) }
      : { type: sk.profile.type, center: scale(sk.profile.center), radiusU: sk.profile.radiusU * 1000, radiusV: sk.profile.radiusV * 1000 },
    operation: operation.type === 'extrude' ? { type: 'extrude', distance: operation.distance * 1000 }
      : { type: 'revolve', angle: operation.angle * 180 / Math.PI },
  };
}
const holeDefinition = (h) => ({ id: h.id, axis: h.axis, plane: h.plane, center: scale(h.center), diameter: h.diameter * 1000 });
export function cadDefinition(source) {
  const model = validateSource(source);
  const definition = model.imported ? (model.source.features[0].stepAsset ? {stepAsset:model.source.features[0].stepAsset} : { stepText: model.source.features[0].stepText })
    : model.sketchBased ? { sketch: sketchDefinition(model.sketch, model.operation) }
      : { size: scale(model.size), holes: model.holes.filter((h) => !h.suppressed).map(holeDefinition) };
  // In a mixed history, cylinder cuts must stay in their original order too.
  if (model.operations.some((op) => !op.suppressed)) {
    if (definition.holes) definition.holes = [];
    definition.steps = model.source.features.slice(1).filter((f) => !f.suppressed).map((f) => {
      if (f.type === 'through-hole') return { id: f.id, type: 'hole', hole: holeDefinition(model.holes.find((h) => h.id === f.id)) };
      const op = model.operations.find((op) => op.id === f.id);
      if (op.definition) return {id:op.id,type:op.type,...op.definition};
      if (EDGE_KINDS.includes(op.type)) return {id:op.id,type:op.type,size:op.size*1000,selection:op.selection,support:edgeSupport(model.source,op.id)};
      return { id: op.id, type: op.operation, sketch: sketchDefinition(op.sketch, op.solid) };
    });
  }
  return definition;
}
export const cadFingerprint = (source) => JSON.stringify(cadDefinition(source));

// Builds a feature's true input geometry, even when that feature or a later one fails.
export function featureInputSource(source, featureId) {
  const prefix = structuredClone(source), index = prefix.features.findIndex(f=>f.id===featureId);
  if (index < 1) throw Error('Choose a downstream feature.');
  prefix.features = prefix.features.slice(0,index);
  return pruneSketches(prefix);
}

// Remove only sketches that no longer have a feature reference, including suppressed features.
export function pruneSketches(source) {
  const used = new Set(source.features.map((f) => f.sketchId).filter(Boolean));
  const sketches = (source.sketches || []).filter((sk) => used.has(sk.id));
  if (sketches.length) source.sketches = sketches;
  else delete source.sketches;
  return source;
}
