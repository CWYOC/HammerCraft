// Portable geometric references. Kernel edge indices are only transient display handles.
export const EDGE_KINDS = ['fillet', 'chamfer'];
export const EDGE_MATCH_TOLERANCE = 2e-6; // Relative to the input solid's axis-aligned bounds.
const curves = ['LINE','CIRCLE','ELLIPSE','HYPERBOLA','PARABOLA','BEZIER_CURVE','BSPLINE_CURVE','OFFSET_CURVE','OTHER_CURVE'];
const id = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(value);
export function edgeSupport(source, beforeId = null) {
  const stop = beforeId === null ? source.features.length : source.features.findIndex(f => f.id === beforeId);
  if (stop < 1) throw Error('Edge treatment must follow a base solid.');
  return source.features.slice(0,stop).filter(f => !f.suppressed).map(f => `${f.id}:${f.type}`);
}
export function normalizeEdgeSelection(input) {
  if (!input || !Array.isArray(input.support) || input.support.length < 1 || input.support.length > 25 ||
      input.support.some(s => typeof s !== 'string' || !/^[A-Za-z0-9_.-]{1,100}:[A-Za-z-]{1,32}$/.test(s)) || new Set(input.support).size !== input.support.length)
    throw Error('Edge references need their ordered upstream feature support.');
  if (!Array.isArray(input.edges) || input.edges.length < 1 || input.edges.length > 64)
    throw Error('Select between 1 and 64 edges.');
  const vector = v => Array.isArray(v) && v.length === 3 && v.every(x => Number.isFinite(x) && x >= -1e-3 && x <= 1.001);
  const edges = input.edges.map(ref => {
    const a = ref?.anchor;
    if (!id(ref?.id) || !a || !curves.includes(a.curve) || typeof a.closed !== 'boolean' ||
        !Array.isArray(a.bounds) || a.bounds.length !== 2 || !a.bounds.every(vector) ||
        a.bounds[0].some((v,i)=>v>a.bounds[1][i]) || !vector(a.midpoint))
      throw Error('An edge reference needs a stable ID and finite normalized geometry.');
    return {id:ref.id,anchor:{curve:a.curve,closed:a.closed,bounds:a.bounds.map(p=>[...p]),midpoint:[...a.midpoint]}};
  });
  if (new Set(edges.map(e=>e.id)).size !== edges.length) throw Error('Edge reference IDs must be unique within the feature.');
  if (new Set(edges.map(e=>JSON.stringify(e.anchor))).size !== edges.length) throw Error('An edge can be selected only once.');
  return {support:[...input.support],edges};
}
export function matchingEdges(anchor, catalog) {
  const numbers = a => [...a.bounds.flat(),...a.midpoint];
  return catalog.filter(edge => edge.anchor.curve === anchor.curve && edge.anchor.closed === anchor.closed &&
    numbers(anchor).every((n,i)=>Math.abs(n-numbers(edge.anchor)[i]) <= EDGE_MATCH_TOLERANCE));
}
export function resolveEdgeSelection(selection, support, catalog) {
  if (JSON.stringify(selection.support) !== JSON.stringify(support))
    throw Error('The upstream feature order changed. Reselect the input edges.');
  const used = new Set();
  return selection.edges.map(ref => {
    const matches = matchingEdges(ref.anchor,catalog);
    if (matches.length !== 1) throw Error(`Edge reference ${ref.id} is ${matches.length ? 'ambiguous' : 'missing'}. Reselect the input edges.`);
    const index = matches[0].index;
    if (used.has(index)) throw Error('Several references resolve to the same edge. Reselect the input edges.');
    used.add(index);return index;
  });
}
