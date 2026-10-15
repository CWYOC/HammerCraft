import { CadClient } from './cad-client.mjs';
import { cadFingerprint, featureInputSource } from './cad-model.mjs';
import { edgeSupport, matchingEdges, normalizeEdgeSelection } from './topology.mjs';

export function renderEdgeEditor(parent, source, feature, kind, ui) {
  const {element,field,button,note,form} = ui;
  const input = feature ? featureInputSource(source,feature.id) : structuredClone(source);
  const inputKey = cadFingerprint(input), support = edgeSupport(input);
  let selection = feature ? structuredClone(feature.selection) : {support,edges:[]};
  let artifact, disposed = false, client;
  const title = kind === 'fillet' ? 'Fillet' : 'Chamfer';
  parent.append(element('h2',`${feature ? 'Edit' : 'New'} ${title.toLowerCase()}`));
  note(parent,kind === 'fillet' ? 'Round selected edges with a constant radius.' : 'Bevel selected edges with equal distances along the two adjacent faces.');
  const f = form(parent,()=>{
    const current = feature ? featureInputSource(ui.getSource(),feature.id) : ui.getSource();
    if(cadFingerprint(current)!==inputKey) throw Error('The input geometry changed. Reopen the edge editor before applying.');
    ui.commit({id:feature?.id||crypto.randomUUID(),bodyId:source.features[0].bodyId,type:kind,name:name.value,
      size:size.value,suppressed:feature?.suppressed||false,selection:normalizeEdgeSelection(selection)});
  },feature ? 'Apply edge treatment' : `Create ${title.toLowerCase()}`);
  const name = field(f.el,'FEATURE NAME',feature?.name||`${title} ${source.features.length}`);
  const initial = ui.currentArtifact();
  const length = initial ? Math.max(.001,Math.min(...initial.bounds[1].map((v,i)=>v-initial.bounds[0][i]))*50) : 1;
  const size = field(f.el,kind==='fillet'?'FILLET RADIUS':'CHAMFER DISTANCE',feature?.size||`${Number(length.toPrecision(6))} mm`);
  const selectionPanel = element('div');f.el.append(selectionPanel);
  const status = element('p',`${selection.edges.length} saved edge reference${selection.edges.length===1?'':'s'}.`,'note');
  selectionPanel.append(status);
  const choices = element('div');selectionPanel.append(choices);
  function preview() {
    if (!artifact || disposed) return;
    const sameSupport = JSON.stringify(selection.support)===JSON.stringify(support);
    const indices = sameSupport ? selection.edges.flatMap(ref=>{const m=matchingEdges(ref.anchor,artifact.edgeCatalog);return m.length===1?[m[0].index]:[];}) : [];
    ui.preview({artifact,selected:indices,onSelect:toggle,title:feature?`Input to ${feature.name}`:`Input to new ${kind}`});
  }
  function toggle(index) {
    if(!artifact) return;
    const edge=artifact.edgeCatalog.find(e=>e.index===index);
    if(!edge) return;
    if(JSON.stringify(selection.support)!==JSON.stringify(support)) return;
    const i=selection.edges.findIndex(ref=>matchingEdges(ref.anchor,artifact.edgeCatalog).some(e=>e.index===index));
    if(i<0) {
      if(selection.edges.length>=64){status.textContent='Select at most 64 edges.';return;}
      selection.edges.push({id:crypto.randomUUID(),anchor:structuredClone(edge.anchor)});
    } else selection.edges.splice(i,1);
    ui.markDraft();renderChoices();preview();
  }
  function renderChoices() {
    choices.replaceChildren();
    const supportValid=JSON.stringify(selection.support)===JSON.stringify(support);
    const matches=new Map(selection.edges.map(ref=>[ref.id,supportValid?matchingEdges(ref.anchor,artifact.edgeCatalog):[]]));
    const unresolved=selection.edges.filter(ref=>matches.get(ref.id).length!==1);
    const selectedIndices=new Set([...matches.values()].filter(m=>m.length===1).map(m=>m[0].index));
    status.textContent=`${selection.edges.length} selected · ${artifact.edgeCatalog.length} available input edges${unresolved.length?` · ${unresolved.length} unresolved`:''}.`;
    if(unresolved.length) {
      note(choices,'An upstream edit changed these references. Review the input solid and explicitly select the intended edges again.','callout');
      choices.append(button('Start a new edge selection',()=>{selection={support,edges:[]};ui.markDraft();renderChoices();preview();},'full'));
    }
    const list=element('div',undefined,'edge-options');choices.append(list);
    for(const edge of artifact.edgeCatalog) {
      const label=element('label',undefined,'check-field');
      const check=element('input');check.type='checkbox';check.disabled=!supportValid;
      check.checked=selectedIndices.has(edge.index);
      const coords=edge.center.map(v=>Math.abs(v)<1e-12?0:Number((v*1000).toPrecision(5))).join(', ');
      check.setAttribute('aria-label',`Edge E${edge.index+1}`);check.onchange=()=>toggle(edge.index);
      label.append(check,element('span',`E${edge.index+1} · ${edge.anchor.curve.toLowerCase()} · bounds center (${coords}) mm · length ${Number((edge.length*1000).toPrecision(5))} mm`));list.append(label);
    }
    note(choices,'Click a visible edge in the input viewport or use this list. Selected edges are amber; their preview labels are temporary.');
    choices.append(button('Show input edges',preview),button('Show finished solid',()=>ui.preview(null)));
  }
  async function load() {
    ui.selectionActive(true);
    choices.replaceChildren();status.textContent='Loading the solid immediately before this feature…';
    try {
      const current=ui.currentArtifact();
      if(current?.fingerprint===inputKey) artifact=current;
      else {client ||= new CadClient(undefined,30000,'input CAD');({artifact}=await client.request('build',{source:input}));}
      if(disposed||!parent.isConnected)return;
      if(artifact.edgeCatalogError)throw Error(artifact.edgeCatalogError);
      renderChoices();preview();
    } catch(error) {if(!disposed){status.textContent=error.message;choices.append(button('Retry input edges',load));}}
  }
  if(feature) choices.append(button('Edit edge selection',load,'full'));
  else load();
  f.finish();
  parent.append(button(feature?'Discard edge edits':'Cancel new edge treatment',ui.cancel,'full'));
  note(parent,'References follow normalized edge geometry while the upstream feature order is unchanged. Missing or ambiguous matches require reselection. The kernel may propagate a fillet through a tangent edge chain; large or incompatible sizes can fail.','note');
  return ()=>{disposed=true;client?.reset();ui.selectionActive(false);ui.preview(null,false);};
}
