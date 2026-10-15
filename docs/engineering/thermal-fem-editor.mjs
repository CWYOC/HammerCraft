import {cadFingerprint} from './cad-model.mjs';
import {faceReference,faceSupport,resolveFaceReference} from './face-references.mjs';
import {FEM_SOLVER} from './thermal-fem-data.mjs';
import {femField,fieldRange} from './thermal-fem-view.mjs';
export function renderFemEditor(panel,model,c,ui){
  const {element,field,select,button,note,pair,form,number}=ui;
  panel.append(element('h2',c.analyze?'CAD thermal results':'CAD thermal study'));
  note(panel,'Steady-state heat conduction · tetrahedral P1 FEM · scikit-fem 12.0.2 / SciPy CG. One solid, constant isotropic conductivity.');
  if(c.analyze){
    if(!c.results.length){note(panel,'Solve a CAD thermal study to inspect its temperature and heat-flux fields.');panel.append(button('Set up CAD thermal study',c.setup,'primary full'));return;}
    const choice=select(panel,'CAD THERMAL SOLUTION',c.results.map((r,i)=>[r.id,`${i+1}. Source r${r.provenance.revision} · ${r.mesh.tetrahedra.length/4} cells`]),c.result.id);choice.onchange=()=>c.chooseResult(choice.value);
    note(panel,`${c.current?'Matches current source':'OUTDATED · earlier inputs'} · ${c.result.verified?'computed locally':'imported result · unverified'}`,c.current&&c.result.verified?'note':'callout');
    const output=select(panel,'FIELD',[['temperature','Temperature'],['flux','Heat-flux magnitude'],['gradient','Temperature-gradient magnitude']],c.field);output.onchange=()=>c.setField(output.value);
    const resolved=femField(c.result,c.field),f=form(panel,()=>c.setRange([Number(low.value)-resolved.offset,Number(high.value)-resolved.offset]),'Apply legend range',true);
    const auto=c.range||fieldRange(resolved.values),low=field(f.el,`LEGEND MINIMUM (${resolved.unit})`,auto[0]+resolved.offset,'number'),high=field(f.el,`LEGEND MAXIMUM (${resolved.unit})`,auto[1]+resolved.offset,'number');f.finish();panel.append(button('Automatic legend range',()=>c.setRange(null),'full'));
    const axis=select(panel,'CUTAWAY AXIS',[[0,'X'],[1,'Y'],[2,'Z']],c.cut.axis),cut=field(panel,'VISIBLE CELL-CENTROID RANGE (%)',c.cut.fraction*100,'range');cut.min=0;cut.max=100;cut.step=5;
    axis.onchange=()=>c.setCut(Number(axis.value),Number(cut.value)/100);cut.oninput=()=>c.setCut(Number(axis.value),Number(cut.value)/100);
    const r=c.result.solution;
    for(const [label,value] of [['Volume mean',`${number(r.volumeMeanTemperature-273.15)} °C`],['CG iterations',r.iterations],['Equation backward error',number(r.residual)],['Internal generation',`${number(r.balance.generated)} W`],['Fixed surfaces · net outward',`${number(r.balance.fixedOutward)} W`],['Convection · outward',`${number(r.balance.convectionOutward)} W`],['Energy imbalance',`${number(r.balance.error)} W`]])pair(panel,label,value);
    note(panel,'Flux and gradients are constant within each linear tetrahedron and can jump between cells. The cutaway exposes whole cells. Fixed-surface heat is a combined reaction, avoiding ambiguous allocation at shared nodes.');
    panel.append(button('Export nodal temperatures CSV',c.exportCSV,'full'),button('Export fields VTK',c.exportVTK,'full'));return;
  }
  if(!c.mesh){note(panel,'Generate a tetrahedral mesh for the current geometry and mesh settings first. Material and thermal-condition edits can reuse that mesh.','callout');panel.append(button('Open tetrahedral mesher',c.mesher,'primary full'));return;}
  pair(panel,'Mesh',`${c.mesh.mesh.tetrahedra.length/4} tetrahedra · source r${c.mesh.provenance.revision}`);
  note(panel,`Assigned material: ${model.material.name} · ${model.material.k===null?'variable conductivity unsupported':number(model.material.k)+' W/(m·K)'}.`);
  const physics=model.source.physics.find(p=>p.type==='heat-conduction-tetra');
  if(!physics){panel.append(button('Create CAD thermal study',()=>ui.commit(s=>{const id=crypto.randomUUID();s.physics.push({id,type:'heat-conduction-tetra',bodyId:s.features[0].bodyId,geometryKey:cadFingerprint(s),support:faceSupport(s),boundaries:[],heatGeneration:'0 W/m^3'});s.studies.push({id:crypto.randomUUID(),name:'CAD steady-state conduction',type:'steady-state',physicsId:id,meshId:s.meshes.find(m=>m.type==='gmsh-tetra').id,solverId:FEM_SOLVER});}),'primary full'));return;}
  let referenceProblem=physics.geometryKey!==cadFingerprint(model.source)||JSON.stringify(physics.support)!==JSON.stringify(faceSupport(model.source));
  for(const b of physics.boundaries)try{resolveFaceReference(b.face,c.mesh.mesh.boundary);}catch{referenceProblem=true;}
  if(referenceProblem){note(panel,'The CAD geometry identity or some surface references no longer match this study. Conditions are retained for review; clear them and select the intended surfaces again.','callout');panel.append(button('Clear and reselect surface conditions',()=>ui.commit(s=>{const p=s.physics.find(p=>p.id===physics.id);p.boundaries=[];p.support=faceSupport(s);p.geometryKey=cadFingerprint(s);}),'full'));}
  const surfaces=c.mesh.mesh.boundary,group=surfaces.find(g=>g.tag===c.selected)||surfaces[0];
  const choice=select(panel,'CAD SURFACE',surfaces.map(g=>[g.tag,`Surface ${g.tag} · ${g.type} · centre ${g.center.map(v=>number(v*1000,3)).join(', ')} mm`]),group.tag);choice.onchange=()=>c.selectSurface(Number(choice.value));
  pair(panel,'CAD surface area',`${number(group.area*1e6)} mm²`);note(panel,'Click a visible surface in the viewport or choose it here. Orange highlights the selected surface. Unassigned surfaces are insulated.');
  const assigned=physics.boundaries.find(b=>{try{return resolveFaceReference(b.face,surfaces).tag===group.tag;}catch{return false;}});
  const f=form(panel,()=>ui.commit(s=>{const p=s.physics.find(p=>p.id===physics.id);p.boundaries=p.boundaries.filter(b=>b.face.id!==assigned?.face.id);if(kind.value!=='insulated')p.boundaries.push({face:assigned?.face||faceReference(group),type:kind.value,...(kind.value==='temperature'?{expression:temperature.value}:{ambient:temperature.value,coefficient:h.value})});p.heatGeneration=source.value;}),'Apply thermal conditions');
  const kind=select(f.el,'SURFACE CONDITION',[['insulated','Insulated'],['temperature','Fixed temperature'],['convection','Convection']],assigned?.type||'insulated');
  const temperature=field(f.el,'TEMPERATURE / CONVECTION AMBIENT',assigned?.expression||assigned?.ambient||'20 degC'),h=field(f.el,'CONVECTION COEFFICIENT',assigned?.coefficient||'10 W/(m^2*K)'),source=field(f.el,'VOLUME HEAT GENERATION',physics.heatGeneration);
  const visibility=()=>{temperature.parentElement.hidden=kind.value==='insulated';h.parentElement.hidden=kind.value!=='convection';};kind.onchange=visibility;visibility();f.finish();
  pair(panel,'Assigned surfaces',physics.boundaries.length);
  const list=element('ul');for(const b of physics.boundaries){let label;try{label='Surface '+resolveFaceReference(b.face,surfaces).tag;}catch{label='Missing surface';}list.append(element('li',`${label}: ${b.type==='temperature'?b.expression:`${b.coefficient} to ${b.ambient}`}`));}panel.append(list);
  const solve=button('Solve CAD thermal study',c.solve,'primary full');solve.id='solveFem';solve.disabled=c.busy||!!c.issue;solve.title=c.issue||'Run CAD thermal FEM';panel.append(solve);
  if(c.issue)note(panel,c.issue,'callout');
  panel.append(button('View CAD thermal results',c.analyzeResults,'full'));
  note(panel,'Runs in the local compute service. Radiation, thermal contact, variable conductivity and transient behavior are not implemented. Different fixed temperatures cannot share mesh nodes.','callout');
}
