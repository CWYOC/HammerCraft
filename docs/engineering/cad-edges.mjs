import { resolveEdgeSelection } from './topology.mjs';

export function describeEdges(shape, mesh = false) {
  const box = shape.boundingBox, bounds = box.bounds;box.delete();
  const span = bounds[1].map((v,i)=>v-bounds[0][i]);
  const normalize = p => p.map((v,i)=>(v-bounds[0][i])/span[i]);
  const edges = shape.edges;
  try {
    if (edges.length > 512) throw Error('Edge selection currently supports solids with at most 512 edges.');
    let coordinates = 0;
    return edges.map((edge,index)=>{
      const bbox = edge.boundingBox;let eb;
      try {eb=bbox.bounds;} finally {bbox.delete();}
      const mid = edge.pointAt(.5);let midpoint;
      try {midpoint=mid.toTuple();} finally {mid.delete();}
      const lines = mesh ? edge.meshEdges({tolerance:Math.max(.00001,Math.min(...span)/200),angularTolerance:.15}).lines : [];
      coordinates += lines.length;
      if (coordinates > 900000) throw Error('Edge selection exceeds the preview segment limit.');
      return {index,anchor:{curve:edge.geomType,closed:edge.isClosed,bounds:eb.map(normalize),midpoint:normalize(midpoint)},
        center:eb[0].map((v,i)=>(v+eb[1][i])/2000),length:edge.length/1000,lines};
    });
  } finally {edges.forEach(e=>e.delete());}
}
export function applyEdgeTreatment(shape, step) {
  const catalog = describeEdges(shape);
  const indices = resolveEdgeSelection(step.selection,step.support,catalog);
  const edges = shape.edges, selected = indices.map(i=>edges[i]);
  try {
    return shape[step.type](edge=>selected.some(e=>e.isSame(edge)) ? step.size : null);
  } finally {edges.forEach(e=>e.delete());}
}
