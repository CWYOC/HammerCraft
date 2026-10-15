import initGCS from './vendor/planegcs.mjs';
import { GcsWrapper, SolveStatus, Algorithm, DebugMode } from './vendor/planegcs-wrapper.mjs';
import { resolveSketch } from './sketch.mjs';

let ready;
export function loadConstraintKernel() {
  ready ||= initGCS({locateFile:()=>new URL('./vendor/planegcs.wasm',import.meta.url).href});
  return ready;
}
function primitive(c, entities) {
  const [a,b,d]=c.refs, value=c.value*1000;
  const base={id:c.id};
  const line=id=>entities.find(e=>e.id===id);
  const pair=()=>({l1_id:a,l2_id:b});
  switch(c.type){
    case 'horizontal':return {...base,type:'horizontal_l',l_id:a};
    case 'vertical':return {...base,type:'vertical_l',l_id:a};
    case 'parallel':return {...base,type:'parallel',...pair()};
    case 'perpendicular':return {...base,type:'perpendicular_ll',...pair()};
    case 'equal-length':return {...base,type:'equal_length',...pair()};
    case 'coincident':return {...base,type:'p2p_coincident',p1_id:a,p2_id:b};
    case 'concentric':return {...base,type:'p2p_coincident',p1_id:line(a).centerId,p2_id:line(b).centerId};
    case 'equal-radius':return {...base,type:'equal_radius_cc',c1_id:a,c2_id:b};
    case 'tangent':return {...base,type:'tangent_lc',l_id:a,c_id:b};
    case 'tangent-circles':return {...base,type:'tangent_cc',c1_id:a,c2_id:b};
    case 'symmetric':return {...base,type:'p2p_symmetric_ppl',p1_id:a,p2_id:b,l_id:d};
    case 'distance':return {...base,type:'p2p_distance',p1_id:a,p2_id:b,distance:value};
    case 'length':return {...base,type:'p2p_distance',p1_id:line(a).startId,p2_id:line(a).endId,distance:value};
    case 'radius':return {...base,type:'circle_radius',c_id:a,radius:value};
    case 'diameter':return {...base,type:'circle_diameter',c_id:a,diameter:value};
    case 'angle':return {...base,type:'l2l_angle_ll',...pair(),angle:c.value};
    case 'u':return {...base,type:'coordinate_x',p_id:a,x:value};
    case 'v':return {...base,type:'coordinate_y',p_id:a,y:value};
    default:throw Error('Unsupported sketch constraint.');
  }
}
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const norm=v=>Math.hypot(...v);
const dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0);
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const wrap=v=>Math.atan2(Math.sin(v),Math.cos(v));

// Independent post-solve checks prevent a solver status alone from certifying bad geometry.
export function constraintResiduals(graph) {
  const points=new Map(graph.points.map(p=>[p.id,p.position]));
  const entities=new Map(graph.entities.map(e=>[e.id,e]));
  const pt=id=>points.get(id), en=id=>entities.get(id);
  const vector=id=>sub(pt(en(id).endId),pt(en(id).startId));
  const unit=id=>{const v=vector(id),n=norm(v);return v.map(x=>x/n);};
  const center=id=>pt(en(id).centerId);
  const toLine=(point,id)=>cross(sub(point,pt(en(id).startId)),unit(id));
  return graph.constraints.filter(c=>!c.suppressed).map(c=>{
    const [a,b,d]=c.refs;let residual,angular=false;
    switch(c.type){
      case 'horizontal':residual=vector(a)[1];break;
      case 'vertical':residual=vector(a)[0];break;
      case 'parallel':residual=cross(unit(a),unit(b));angular=true;break;
      case 'perpendicular':residual=dot(unit(a),unit(b));angular=true;break;
      case 'equal-length':residual=norm(vector(a))-norm(vector(b));break;
      case 'coincident':residual=norm(sub(pt(a),pt(b)));break;
      case 'concentric':residual=norm(sub(center(a),center(b)));break;
      case 'equal-radius':residual=en(a).radius-en(b).radius;break;
      case 'tangent':residual=Math.abs(toLine(center(b),a))-en(b).radius;break;
      case 'tangent-circles':{const dist=norm(sub(center(a),center(b))),r1=en(a).radius,r2=en(b).radius;residual=Math.min(Math.abs(dist-r1-r2),Math.abs(dist-Math.abs(r1-r2)));break;}
      case 'symmetric':{const midpoint=pt(a).map((v,i)=>(v+pt(b)[i])/2);residual=Math.max(Math.abs(toLine(midpoint,d)),Math.abs(dot(sub(pt(a),pt(b)),unit(d))));break;}
      case 'distance':residual=norm(sub(pt(a),pt(b)))-c.value;break;
      case 'length':residual=norm(vector(a))-c.value;break;
      case 'radius':residual=en(a).radius-c.value;break;
      case 'diameter':residual=2*en(a).radius-c.value;break;
      case 'angle':residual=wrap(Math.atan2(cross(vector(a),vector(b)),dot(vector(a),vector(b)))-c.value);angular=true;break;
      case 'u':residual=pt(a)[0]-c.value;break;
      case 'v':residual=pt(a)[1]-c.value;break;
    }
    return {id:c.id,residual:Math.abs(residual),tolerance:angular?1e-7:1e-8};
  });
}
function failure(message,report,geometry=null) {
  const error=Error(message);error.constraintReport=report;error.constraintGeometry=geometry;return error;
}
export async function solveConstraintGraph(graph) {
  const mod=await loadConstraintKernel(),wrapper=new GcsWrapper(new mod.GcsSystem(),mod);
  try {
    wrapper.debug_mode=DebugMode.NoDebug;
    wrapper.set_max_iterations(200);wrapper.set_convergence_threshold(1e-10);
    const input=[
      ...graph.points.map(p=>({id:p.id,type:'point',x:p.position[0]*1000,y:p.position[1]*1000,fixed:p.fixed})),
      ...graph.entities.map(e=>e.type==='line'?{id:e.id,type:'line',p1_id:e.startId,p2_id:e.endId}:{id:e.id,type:'circle',c_id:e.centerId,radius:e.radius*1000}),
      ...graph.constraints.filter(c=>!c.suppressed).map(c=>primitive(c,graph.entities)),
    ];
    wrapper.push_primitives_and_params(input);
    const code=wrapper.solve(Algorithm.DogLeg);
    const report={engine:'PlaneGCS 1.3.0 / DogLeg',status:'failed',dof:wrapper.gcs.dof(),
      conflicting:wrapper.get_gcs_conflicting_constraints(),redundant:wrapper.get_gcs_redundant_constraints(),
      partiallyRedundant:wrapper.get_gcs_partially_redundant_constraints(),code};
    const problems=[...new Set([...report.conflicting,...report.redundant,...report.partiallyRedundant])];
    if(problems.length||report.dof<0) {
      report.status='over-constrained';
      throw failure(`Over-constrained sketch. Review ${problems.join(', ')||'the constraint set'}; remove or suppress conflicting/redundant constraints.`,report);
    }
    if(![SolveStatus.Success,SolveStatus.Converged].includes(code)) throw failure('Sketch constraints did not converge. Adjust seed coordinates or revise the constraints.',report);
    wrapper.apply_solution();
    const solved=new Map(wrapper.sketch_index.get_primitives().map(p=>[p.id,p]));
    const geometry={...graph,points:graph.points.map(p=>({...p,position:[solved.get(p.id).x/1000,solved.get(p.id).y/1000]})),
      entities:graph.entities.map(e=>e.type==='line'?{...e}:{...e,radius:solved.get(e.id).radius/1000})};
    if(geometry.points.some(p=>p.position.some(n=>!Number.isFinite(n)||Math.abs(n)>1000))||geometry.entities.some(e=>e.type==='circle'&&(!Number.isFinite(e.radius)||e.radius<1e-6||e.radius>1000)))
      throw failure('The constraint solution is outside the supported sketch bounds.',report);
    const pts=new Map(geometry.points.map(p=>[p.id,p.position]));
    if(geometry.entities.some(e=>e.type==='line'&&norm(sub(pts.get(e.startId),pts.get(e.endId)))<1e-6)) throw failure('The constraint solution contains a collapsed line shorter than 1 µm.',report,geometry);
    const residuals=constraintResiduals(geometry),bad=residuals.filter(r=>!Number.isFinite(r.residual)||r.residual>r.tolerance);
    if(bad.length) throw failure(`Constraint residual check failed for ${bad.map(r=>r.id).join(', ')}. Revise the constraints or seed geometry.`,{...report,residuals},geometry);
    for(const p of graph.points.filter(p=>p.fixed)) if(norm(sub(pts.get(p.id),p.position))>1e-10) throw failure('The constraint solution moved a fixed point.',report);
    report.status=report.dof===0?'fully-constrained':'under-constrained';report.residuals=residuals;
    const entities=new Map(geometry.entities.map(e=>[e.id,e]));
    let profile;
    const expr=n=>`${n} m`;
    if(graph.loop.length===1) {
      const circle=entities.get(graph.loop[0]);profile={type:'circle',center:pts.get(circle.centerId).map(expr),radius:expr(circle.radius)};
    } else {
      const lines=graph.loop.map(id=>entities.get(id));
      // Loop order/direction is explicit; coincident endpoint IDs may differ.
      for(let i=0;i<lines.length;i++) if(norm(sub(pts.get(lines[i].endId),pts.get(lines[(i+1)%lines.length].startId)))>1e-8)
        throw failure('The solved profile is open. Order the directed lines head-to-tail and join their endpoints.',report,geometry);
      profile={type:'polygon',points:lines.map((e,i)=>({id:`V${i+1}`,position:pts.get(e.startId).map(expr)}))};
    }
    let sketch;
    try {sketch=resolveSketch({id:'solved',name:'Solved sketch',plane:'XY',origin:['0 m','0 m','0 m'],profile},new Map());}
    catch(e){throw failure(`Constraints solved, but the solid profile is invalid: ${e.message}`,report,geometry);}
    return {report,geometry,profile:sketch.profile,bounds:sketch.bounds,area:sketch.area,centroid:sketch.centroid};
  } finally {wrapper.destroy_gcs_module();}
}
