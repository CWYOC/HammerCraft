import {cadFingerprint} from './cad-model.mjs';
import {faceSupport,faceReference,resolveFaceReference} from './face-references.mjs';
import {ELECTRIC_SOLVER,electricResistance} from './electric-fem-data.mjs';
export function renderElectricEditor(panel,model,c,ui){
  const {element,field,select,button,note,pair,form,number}=ui;
  panel.append(element('h2',c.analyze?'Electrical results':'DC conduction'));
  note(panel,'Rust finite elements · steady current in one conducting solid.');
  if(c.analyze){
    if(!c.result){note(panel,'Solve a DC study to inspect potential, current and Joule heat.');panel.append(button('Set up DC conduction',c.setup,'primary full'));return;}
    const r=c.result,s=r.solution,choice=select(panel,'ELECTRICAL SOLUTION',c.results.map((r,i)=>[r.id,`${i+1}. Source r${r.provenance.revision}`]),r.id);choice.onchange=()=>c.chooseResult(choice.value);
    note(panel,`${c.current?'Matches current source':'OUTDATED · earlier inputs'} · ${r.verified?'computed locally':'imported result · unverified'}`,c.current&&r.verified?'note':'callout');
    const output=select(panel,'ELECTRICAL FIELD',[['potential','Electric potential'],['field','Electric field magnitude'],['current','Current density magnitude'],['joule','Joule heat density']],c.field);output.onchange=()=>c.setField(output.value);
    const axis=select(panel,'ELECTRICAL CUTAWAY AXIS',[[0,'X'],[1,'Y'],[2,'Z']],c.cut.axis),cut=field(panel,'VISIBLE ELECTRICAL CELLS (%)',100*c.cut.fraction,'range');cut.min=0;cut.max=100;cut.step=5;axis.onchange=()=>c.setCut(Number(axis.value),Number(cut.value)/100);cut.oninput=()=>c.setCut(Number(axis.value),Number(cut.value)/100);
    pair(panel,'Joule heat / input power',`${number(s.joulePower)} / ${number(s.inputPower)} W`);const resistance=electricResistance(r);if(resistance!==null)pair(panel,'Two-terminal resistance',`${number(resistance)} Ω`);
    for(const t of s.terminals){pair(panel,`Surface ${t.tag} · mean voltage`,`${number(t.meanVoltage)} V`);pair(panel,'Current into solid',`${number(t.inwardCurrent)} A`);}
    pair(panel,'Current imbalance',`${number(s.currentBalance)} A`);pair(panel,'Power imbalance',`${number(s.powerBalance)} W`);pair(panel,'Equation backward error',number(s.residual));pair(panel,'Solver',`${s.solver.library} ${s.solver.version}`);
    panel.append(button('Export electrical potential CSV',c.exportCSV,'full'),button('Export electrical fields VTK',c.exportVTK,'full'));
    note(panel,'Joule heat is an electrical result only. It is not yet transferred into a coupled temperature solve.');return;
  }
  if(!c.mesh){note(panel,'Generate a verified tetrahedral mesh for the current geometry and sizing.','callout');panel.append(button('Open electrical mesher',c.mesher,'primary full'));return;}
  pair(panel,'Mesh',`${c.mesh.mesh.nodes.length/3} nodes · ${c.mesh.mesh.tetrahedra.length/4} tetrahedra`);pair(panel,'Assigned material',model.material.name);panel.append(button('Edit electrical material',c.material,'full'));
  const p=model.source.physics.find(p=>p.type==='dc-conduction');
  if(!p){panel.append(button('Create DC conduction study',()=>ui.commit(s=>{const id=crypto.randomUUID();s.physics.push({id,type:'dc-conduction',bodyId:s.features[0].bodyId,geometryKey:cadFingerprint(s),support:faceSupport(s),boundaries:[]});s.studies.push({id:crypto.randomUUID(),name:'DC conduction',type:'steady-state',physicsId:id,meshId:s.meshes.find(m=>m.type==='gmsh-tetra').id,solverId:ELECTRIC_SOLVER});}),'primary full'));return;}
  const groups=c.mesh.mesh.boundary;let broken=p.geometryKey!==cadFingerprint(model.source)||JSON.stringify(p.support)!==JSON.stringify(faceSupport(model.source));for(const b of p.boundaries)try{resolveFaceReference(b.face,groups);}catch{broken=true;}
  if(broken){note(panel,'Geometry or terminal references changed. Clear and reselect terminals.','callout');panel.append(button('Clear electrical terminals',()=>ui.commit(s=>{const v=s.physics.find(v=>v.id===p.id);v.boundaries=[];v.geometryKey=cadFingerprint(s);v.support=faceSupport(s);}),'full'));}
  const g=groups.find(g=>g.tag===c.selected)||groups[0],surface=select(panel,'ELECTRICAL CAD SURFACE',groups.map(g=>[g.tag,`Surface ${g.tag} · ${g.type} · centre ${g.center.map(v=>number(v*1000,3)).join(', ')} mm`]),g.tag);surface.onchange=()=>c.selectSurface(Number(surface.value));
  const assigned=p.boundaries.find(b=>{try{return resolveFaceReference(b.face,groups).tag===g.tag;}catch{return false;}});
  const bc=form(panel,()=>ui.commit(s=>{const v=s.physics.find(v=>v.id===p.id);v.boundaries=v.boundaries.filter(b=>b.face.id!==assigned?.face.id);if(kind.value!=='insulated')v.boundaries.push({face:assigned?.face||faceReference(g),type:kind.value,expression:value.value});}),'Apply electrical terminal');
  const kind=select(bc.el,'ELECTRICAL SURFACE CONDITION',[['insulated','Insulated'],['voltage','Voltage'],['current','Total inward current']],assigned?.type||'insulated'),value=field(bc.el,'TERMINAL VALUE',assigned?.expression||'0 V');
  kind.onchange=()=>{value.parentElement.hidden=kind.value==='insulated';value.value=kind.value==='current'?'1 A':'0 V';};value.parentElement.hidden=kind.value==='insulated';bc.finish();
  for(const b of p.boundaries){let label='Missing surface';try{label=`Surface ${resolveFaceReference(b.face,groups).tag}`;}catch{}note(panel,`${label}: ${b.type} · ${b.expression}`);}
  if(c.issue)note(panel,c.issue,'callout');const solve=button('Solve DC conduction',c.solve,'primary full');solve.id='solveElectric';solve.disabled=c.busy||!!c.issue;panel.append(solve,button('View electrical results',c.analyzeResults,'full'));
  note(panel,'Set constant electrical conductivity in S/m and at least one voltage reference. Voltage terminal surfaces must not touch. Positive total current enters the solid and is distributed uniformly over its surface. Other surfaces are insulated. Linear isotropic DC conduction only; no circuits, AC, contact resistance or temperature feedback. 50,000 nodes / 100,000 tetrahedra.','callout');
}
