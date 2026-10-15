import { quantity, dimensions } from './units.mjs';

// Stable application schema; no raw solver objects or executable expressions in projects.
export const CONSTRAINT_TYPES = {
  horizontal: { label: 'Horizontal', refs: ['line'] },
  vertical: { label: 'Vertical', refs: ['line'] },
  parallel: { label: 'Parallel', refs: ['line','line'] },
  perpendicular: { label: 'Perpendicular', refs: ['line','line'] },
  coincident: { label: 'Coincident points', refs: ['point','point'] },
  concentric: { label: 'Concentric circles', refs: ['circle','circle'] },
  'equal-length': { label: 'Equal lengths', refs: ['line','line'] },
  'equal-radius': { label: 'Equal radii', refs: ['circle','circle'] },
  tangent: { label: 'Tangent line / circle', refs: ['line','circle'] },
  'tangent-circles': { label: 'Tangent circles', refs: ['circle','circle'] },
  symmetric: { label: 'Symmetric about line', refs: ['point','point','line'] },
  distance: { label: 'Point distance', refs: ['point','point'], value: 'length' },
  length: { label: 'Line length', refs: ['line'], value: 'length' },
  radius: { label: 'Circle radius', refs: ['circle'], value: 'length' },
  diameter: { label: 'Circle diameter', refs: ['circle'], value: 'length' },
  angle: { label: 'Directed line angle', refs: ['line','line'], value: 'angle' },
  u: { label: 'Point U coordinate', refs: ['point'], value: 'coordinate' },
  v: { label: 'Point V coordinate', refs: ['point'], value: 'coordinate' },
};
function id(v) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(v)) throw Error('Constraint geometry needs stable alphanumeric IDs.');
  return v;
}
function expr(v) {
  if (typeof v !== 'string' || !v.trim() || v.length > 512) throw Error('Constraint dimensions need expressions of 1–512 characters.');
  return v;
}
function list(v, max, label, min=0) {
  if (!Array.isArray(v) || v.length < min || v.length > max) throw Error(`Use ${min}–${max} ${label}.`);
  return v;
}
function coordinate(v, values) {
  const n=quantity(v,dimensions.length,values);
  if (Math.abs(n)>1000) throw Error('Sketch coordinates must be within ±1000 m.');
  return n;
}
export function resolveConstraintProfile(input, values) {
  if (input?.type !== 'constrained') throw Error('Expected a constrained sketch profile.');
  const points=list(input.points,64,'sketch points',1).map(p=>{
    if (typeof p?.fixed !== 'boolean' || !Array.isArray(p.position) || p.position.length!==2) throw Error('A point needs U/V seed coordinates and an explicit fixed state.');
    return {id:id(p.id),position:p.position.map(expr),fixed:p.fixed};
  });
  const entities=list(input.entities,64,'line/circle entities',1).map(e=>{
    if (e?.type==='line') {
      if(e.startId===e.endId) throw Error('Line endpoints must reference different points.');
      return {id:id(e.id),type:'line',startId:id(e.startId),endId:id(e.endId)};
    }
    if(e?.type==='circle') return {id:id(e.id),type:'circle',centerId:id(e.centerId),radius:expr(e.radius)};
    throw Error('Constraint sketches currently support line and circle entities.');
  });
  const constraints=list(input.constraints,128,'constraints').map(c=>{
    const spec=Object.hasOwn(CONSTRAINT_TYPES,c?.type)?CONSTRAINT_TYPES[c.type]:null;
    if(!spec || !Array.isArray(c.refs) || c.refs.length!==spec.refs.length) throw Error('Choose a supported constraint and its required references.');
    if(typeof c.suppressed!=='boolean') throw Error('Every constraint needs a suppression state.');
    if(new Set(c.refs).size!==c.refs.length) throw Error('A constraint must reference distinct objects.');
    return {id:id(c.id),type:c.type,refs:c.refs.map(id),...(spec.value?{value:expr(c.value)}:{}),suppressed:c.suppressed};
  });
  const objects=new Map([...points.map(p=>[p.id,{...p,type:'point'}]),...entities.map(e=>[e.id,e])]);
  if(new Set([...points,...entities,...constraints].map(o=>o.id)).size!==points.length+entities.length+constraints.length) throw Error('Point, entity and constraint IDs must be unique within a sketch.');
  const reference=(ref,type)=>{if(objects.get(ref)?.type!==type) throw Error(`Reference ${ref} must identify a ${type} in this sketch.`);};
  for(const e of entities) for(const ref of e.type==='line'?[e.startId,e.endId]:[e.centerId]) reference(ref,'point');
  for(const c of constraints) c.refs.forEach((ref,i)=>reference(ref,CONSTRAINT_TYPES[c.type].refs[i]));
  const loop=list(input.loop,64,'ordered profile entities',1).map(id);
  if(new Set(loop).size!==loop.length) throw Error('Do not repeat an entity in the solid profile loop.');
  for(const ref of loop) if(!entities.some(e=>e.id===ref)) throw Error('The profile references a missing sketch entity.');
  if(loop.length===1) reference(loop[0],'circle');
  else {
    if(loop.length<3) throw Error('A line profile needs at least three ordered edges.');
    loop.forEach(ref=>reference(ref,'line'));
  }
  const source={type:'constrained',points,entities,loop,constraints};
  const graph={
    points:points.map(p=>({...p,position:p.position.map(v=>coordinate(v,values))})),
    entities:entities.map(e=>e.type==='line'?{...e}:{...e,radius:quantity(e.radius,dimensions.length,values)}),
    loop:[...loop],
    constraints:constraints.map(c=>({...c,...(CONSTRAINT_TYPES[c.type].value?{value:quantity(c.value,CONSTRAINT_TYPES[c.type].value==='angle'?dimensions.scalar:dimensions.length,values)}:{})})),
  };
  if(graph.entities.some(e=>e.type==='circle'&&(e.radius<1e-6||e.radius>1000))) throw Error('Circle seed radius must be 1 µm–1000 m.');
  for(const c of graph.constraints) {
    const type=CONSTRAINT_TYPES[c.type].value;
    if(type==='length'&&(c.value<1e-6||c.value>1000)) throw Error('Constraint lengths must be 1 µm–1000 m; use Coincident for zero distance.');
    if(type==='coordinate'&&Math.abs(c.value)>1000) throw Error('Coordinate constraints must be within ±1000 m.');
    if(type==='angle'&&Math.abs(c.value)>2*Math.PI+1e-12) throw Error('Directed angles must be between −360° and 360°.');
  }
  return {source,graph};
}
export function defaultConstraintProfile() {
  return {
    type:'constrained',
    points:[[0,0],[40,0],[40,25],[0,25]].map((p,i)=>({id:`P${i+1}`,position:p.map(v=>`${v} mm`),fixed:i===0})),
    entities:[0,1,2,3].map(i=>({id:`L${i+1}`,type:'line',startId:`P${i+1}`,endId:`P${(i+1)%4+1}`})),
    loop:['L1','L2','L3','L4'],
    constraints:[
      ...['horizontal','vertical','horizontal','vertical'].map((type,i)=>({id:`C${i+1}`,type,refs:[`L${i+1}`],suppressed:false})),
      {id:'C5',type:'length',refs:['L1'],value:'40 mm',suppressed:false},
      {id:'C6',type:'length',refs:['L2'],value:'25 mm',suppressed:false},
    ],
  };
}
