import { CadClient } from './cad-client.mjs';
import { resolveConstraintProfile } from './constraints-data.mjs';
const states=new WeakMap(),NS='http://www.w3.org/2000/svg';
const el=(tag,text,cls)=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;};
function svg(tag,attrs,text){const e=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;return e;}
export function cancelConstraintPreview(parent) {
  const state=states.get(parent);if(!state)return;
  state.token++;clearTimeout(state.timer);state.client.reset();
}
export function renderConstraintPreview(parent,input,values,operation) {
  let state=states.get(parent);
  if(!state){state={token:0,client:new CadClient(()=>new Worker(new URL('./constraints-worker.mjs',import.meta.url),{type:'module'}),15000,'sketch constraint')};states.set(parent,state);}
  const token=++state.token;clearTimeout(state.timer);state.client.reset();
  parent.replaceChildren(el('h2',`${input.name||'Constraint sketch'} · ${input.plane}`),el('p','Solving sketch constraints…','note'));
  let graph;
  try{graph=resolveConstraintProfile(input.profile,values).graph;}
  catch(error){parent.append(el('p',error.message,'sketch-error'));return;}
  state.timer=setTimeout(async()=>{
    try {
      const reply=await state.client.request('build',{sketch:structuredClone(input),values:[...values]});
      if(state.token!==token||!parent.isConnected)return;
      const solved=reply.solved,report=solved?.report||reply.report;
      const status=report?.status==='fully-constrained'?'Fully constrained':report?.status==='under-constrained'?'Under-constrained':report?.status==='over-constrained'?'Over-constrained':'Solve failed';
      parent.replaceChildren(el('h2',`${input.name||'Constraint sketch'} · ${input.plane}`));
      const summary=el('p',`${status}${solved?` · ${report.dof} ${report.dof===1?'degree':'degrees'} of freedom · ${(solved.area*1e6).toLocaleString(undefined,{maximumFractionDigits:3})} mm²`:''}`,solved?'constraint-status':'sketch-error');
      if(report?.status==='under-constrained')summary.classList.add('constraint-under');
      summary.setAttribute('role','status');parent.append(summary);
      if(reply.diagnostic)parent.append(el('p',reply.diagnostic,'sketch-error'));
      draw(parent,solved?.geometry||reply.geometry||graph,solved?.profile,operation);
      if(solved) {
        const details=el('details',''),table=el('table','');
        details.append(el('summary','Solved coordinates & radii / mm'));
        for(const p of solved.geometry.points) {
          const row=el('tr','');row.append(el('th',p.id),el('td',p.position.map(v=>Number((v*1000).toPrecision(9))).join(' / ')));table.append(row);
        }
        for(const c of solved.geometry.entities.filter(e=>e.type==='circle')) {
          const row=el('tr','');row.append(el('th',`${c.id} radius`),el('td',String(Number((c.radius*1000).toPrecision(9)))));table.append(row);
        }
        details.append(table);parent.append(details);
      }
      parent.append(el('p',solved
        ? `${report.dof?'Free dimensions follow the seed geometry; add constraints to define them. ':'All sketch degrees of freedom are constrained. '}Apply changes to store this draft and regenerate dependent solids.`
        : 'The displayed seed or diagnostic geometry is not a valid solved solid. Fix the constraints before using it.','note'));
    }catch(error){if(state.token===token)parent.replaceChildren(el('h2','Constraint solve unavailable'),el('p',error.message,'sketch-error'));}
  },160);
}
function draw(parent,graph,profile,operation) {
  const points=new Map(graph.points.map(p=>[p.id,p.position]));
  const extent=[...points.values()];
  for(const e of graph.entities.filter(e=>e.type==='circle')) {const c=points.get(e.centerId);extent.push(c.map(v=>v-e.radius),c.map(v=>v+e.radius));}
  const low=[0,1].map(i=>Math.min(0,...extent.map(p=>p[i]))),high=[0,1].map(i=>Math.max(0,...extent.map(p=>p[i])));
  const span=Math.max(high[0]-low[0],high[1]-low[1],1e-4),scale=390/span,center=low.map((v,i)=>(v+high[i])/2);
  const xy=p=>[300+(p[0]-center[0])*scale,230-(p[1]-center[1])*scale];
  const image=svg('svg',{viewBox:'0 0 600 460',class:'constraint-geometry',role:'img','aria-label':'Constrained sketch with labeled entities and points. Dashed entities are construction geometry.'});
  const zero=xy([0,0]);
  image.append(svg('line',{x1:30,y1:zero[1],x2:570,y2:zero[1],class:'sketch-axis'}),svg('line',{x1:zero[0],y1:20,x2:zero[0],y2:440,class:operation==='revolve'?'sketch-revolve-axis':'sketch-axis'}));
  if(profile?.points)image.append(svg('polygon',{points:profile.points.map(p=>xy(p).join(',')).join(' '),class:'sketch-profile'}));
  for(const e of graph.entities) {
    const cls=graph.loop.includes(e.id)?'constraint-edge':'constraint-edge constraint-construction';let label;
    if(e.type==='line') {const a=xy(points.get(e.startId)),b=xy(points.get(e.endId));image.append(svg('line',{x1:a[0],y1:a[1],x2:b[0],y2:b[1],class:cls}));label=a.map((v,i)=>(v+b[i])/2);}
    else {const c=xy(points.get(e.centerId)),r=e.radius*scale;image.append(svg('circle',{cx:c[0],cy:c[1],r,class:cls}));label=[c[0]+r,c[1]];}
    image.append(svg('text',{x:label[0]+6,y:label[1]-6,class:'sketch-point-label'},e.id));
  }
  for(const p of graph.points){const q=xy(p.position);image.append(svg('circle',{cx:q[0],cy:q[1],r:4,class:p.fixed?'constraint-fixed':'constraint-point'}),svg('text',{x:q[0]+6,y:q[1]+17,class:'sketch-point-label'},p.id));}
  parent.append(image);
}
