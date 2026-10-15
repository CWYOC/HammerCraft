import { quantity, dimensions } from './units.mjs';
import { resolveConstraintProfile, defaultConstraintProfile } from './constraints-data.mjs';

// Sketch geometry is independent of the CAD kernel and physics. Coordinates are SI.
export const SKETCH_PLANES = {
  XY: { u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] },
  XZ: { u: [1, 0, 0], v: [0, 0, 1], normal: [0, -1, 0] },
  YZ: { u: [0, 1, 0], v: [0, 0, 1], normal: [1, 0, 0] },
};
const identity = (v) => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(v)) throw Error('Invalid sketch or point ID.');
  return v;
};
const expression = (v) => {
  if (typeof v !== 'string' || !v.trim() || v.length > 512) throw Error('Sketch dimensions need expressions of 1–512 characters.');
  return v;
};
const pair = (v) => {
  if (!Array.isArray(v) || v.length !== 2) throw Error('A sketch coordinate needs U and V expressions.');
  return v.map(expression);
};
export function resolveSketch(input, values) {
  if (!input || !Object.hasOwn(SKETCH_PLANES, input.plane)) throw Error('Choose the XY, XZ or YZ sketch plane.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 160) throw Error('Sketch name must contain 1–160 characters.');
  if (!Array.isArray(input.origin) || input.origin.length !== 3) throw Error('A sketch needs an XYZ origin.');
  const source = { id: identity(input.id), name: input.name, plane: input.plane, origin: input.origin.map(expression), profile: null };
  const length = (e) => quantity(e, dimensions.length, values);
  const origin = source.origin.map(length);
  if (origin.some((v) => Math.abs(v) > 10000)) throw Error('Sketch origin must be within 10 km of the global origin.');
  const p = input.profile;
  let profile, bounds, area, centroid;
  if (p?.type === 'constrained') {
    const constrained=resolveConstraintProfile(p,values);
    source.profile=constrained.source;
    // Solving and geometric validation occur in workers. Seeds are never passed off as solved geometry.
    return {source,origin,profile:{type:'constrained',graph:constrained.graph},bounds:null,area:null,centroid:null,...SKETCH_PLANES[source.plane]};
  } else if (p?.type === 'rectangle') {
    source.profile = { type: p.type, corner: pair(p.corner), width: expression(p.width), height: expression(p.height) };
    const corner = source.profile.corner.map(length), width = length(p.width), height = length(p.height);
    if (width < 1e-6 || height < 1e-6) throw Error('Rectangle dimensions must be at least 1 µm.');
    profile = { type: p.type, points: [corner, [corner[0] + width, corner[1]], [corner[0] + width, corner[1] + height], [corner[0], corner[1] + height]] };
    bounds = [corner, [corner[0] + width, corner[1] + height]];
    area = width * height; centroid = [corner[0] + width / 2, corner[1] + height / 2];
  } else if (p?.type === 'circle' || p?.type === 'ellipse') {
    source.profile = { type: p.type, center: pair(p.center), ...(p.type === 'circle' ? { radius: expression(p.radius) } : { radiusU: expression(p.radiusU), radiusV: expression(p.radiusV) }) };
    const center = source.profile.center.map(length), radiusU = length(p.type === 'circle' ? p.radius : p.radiusU), radiusV = length(p.type === 'circle' ? p.radius : p.radiusV);
    if (Math.min(radiusU, radiusV) < 1e-6) throw Error('Profile radii must be at least 1 µm.');
    profile = { type: p.type, center, radiusU, radiusV };
    bounds = [center.map((v, i) => v - [radiusU, radiusV][i]), center.map((v, i) => v + [radiusU, radiusV][i])];
    area = Math.PI * radiusU * radiusV; centroid = center;
  } else if (p?.type === 'polygon') {
    if (!Array.isArray(p.points) || p.points.length < 3 || p.points.length > 64) throw Error('A polygon needs 3–64 ordered points.');
    source.profile = { type: p.type, points: p.points.map((p) => ({ id: identity(p.id), position: pair(p.position) })) };
    if (new Set(source.profile.points.map((p) => p.id)).size !== p.points.length) throw Error('Polygon point IDs must be unique.');
    const points = source.profile.points.map((p) => p.position.map(length));
    bounds = [0, 1].map((side) => [0, 1].map((a) => Math[side ? 'max' : 'min'](...points.map((p) => p[a]))));
    validatePolygon(points, bounds);
    let twiceArea = 0, cx = 0, cy = 0;
    // Translate to the first vertex for numerical stability with off-origin profiles.
    const base = points[0];
    for (let i = 0; i < points.length; i++) {
      const a = points[i].map((v, j) => v - base[j]), b = points[(i + 1) % points.length].map((v, j) => v - base[j]);
      const cross = a[0] * b[1] - b[0] * a[1];
      twiceArea += cross; cx += (a[0] + b[0]) * cross; cy += (a[1] + b[1]) * cross;
    }
    area = Math.abs(twiceArea) / 2;
    if (area < 1e-12) throw Error('The polygon must enclose at least 1 µm².');
    centroid = [base[0] + cx / (3 * twiceArea), base[1] + cy / (3 * twiceArea)];
    profile = { type: p.type, points: twiceArea < 0 ? [...points].reverse() : points };
  } else throw Error('Choose a rectangle, circle, ellipse, closed polygon or constrained profile.');
  const size = bounds[1].map((v, i) => v - bounds[0][i]);
  if (bounds.flat().some((v) => !Number.isFinite(v) || Math.abs(v) > 1000) || size.some((v) => v < 1e-6 || v > 1000) || Math.max(...size) / Math.min(...size) > 10000)
    throw Error('Sketch spans must be 1 µm–1000 m, within ±1000 m and aspect ratio at most 10,000.');
  return { source, origin, profile, bounds, area, centroid, ...SKETCH_PLANES[source.plane] };
}
function validatePolygon(points, bounds) {
  const span = Math.max(...bounds[1].map((v, i) => v - bounds[0][i]));
  if (!Number.isFinite(span) || span <= 0) throw Error('The polygon must enclose an area.');
  const ps = points.map((p) => p.map((v, i) => (v - bounds[0][i]) / span)), n = ps.length, eps = 1e-12;
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const on = (a, b, p) => Math.abs(cross(a, b, p)) < eps && p.every((v, i) => v >= Math.min(a[i], b[i]) - eps && v <= Math.max(a[i], b[i]) + eps);
  for (let i = 0; i < n; i++) {
    const a = ps[i], b = ps[(i + 1) % n];
    if (Math.hypot(...a.map((v, j) => v - b[j])) * span < 1e-6) throw Error('Polygon edges must be at least 1 µm; do not repeat the closing point.');
    if (Math.abs(cross(a, b, ps[(i + 2) % n])) < eps) throw Error('Remove redundant or reversing collinear polygon points.');
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const c = ps[j], d = ps[(j + 1) % n];
      const ab = [cross(a, b, c), cross(a, b, d)], cd = [cross(c, d, a), cross(c, d, b)];
      if ((ab[0] * ab[1] < 0 && cd[0] * cd[1] < 0) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b))
        throw Error('Polygon edges must not intersect or touch except at neighboring endpoints.');
    }
  }
}
export function resolveSketchOperation(feature, sketch, values) {
  if (feature.type === 'extrude') {
    const distance = quantity(expression(feature.distance), dimensions.length, values);
    if (Math.abs(distance) < 1e-6 || Math.abs(distance) > 1000) throw Error('Extrusion distance magnitude must be 1 µm–1000 m.');
    return { type: feature.type, distance };
  }
  const angle = quantity(expression(feature.angle), dimensions.scalar, values);
  if (angle < Math.PI / 18000 || angle > 2 * Math.PI + 1e-12) throw Error('Revolution angle must be 0.01–360 degrees.');
  if (sketch.bounds && sketch.bounds[0][0] < 0) throw Error('A revolved profile must stay on the positive U side of its V axis.');
  if (['circle', 'ellipse'].includes(sketch.profile.type) && sketch.bounds[0][0] < 1e-6) throw Error('Keep a curved revolved profile at least 1 µm from the V axis to avoid a pinched solid.');
  return { type: feature.type, angle: Math.min(angle, 2 * Math.PI) };
}
export function defaultSketch(id = globalThis.crypto.randomUUID(), type = 'rectangle') {
  const profile = {
    constrained: defaultConstraintProfile(),
    rectangle: { type, corner: ['0 mm', '0 mm'], width: '40 mm', height: '25 mm' },
    circle: { type, center: ['20 mm', '15 mm'], radius: '10 mm' },
    ellipse: { type, center: ['20 mm', '15 mm'], radiusU: '12 mm', radiusV: '8 mm' },
    polygon: { type, points: [[0, 0], [40, 0], [40, 10], [15, 10], [15, 30], [0, 30]].map((p, i) => ({ id: `point-${i + 1}`, position: p.map((v) => `${v} mm`) })) },
  }[type];
  if (!profile) throw Error('Unsupported profile.');
  return { id, name: 'Profile sketch', plane: 'XY', origin: ['0 mm', '0 mm', '0 mm'], profile };
}
