import { CONSTRAINT_TYPES } from './constraints-data.mjs';
const selections=new Map();

// The editor only builds source data; solving lives in a worker and never mutates the draft.
export function renderConstraintEditor(parent, initial, ui) {
  const {element,field,select,button,markDraft,changed}=ui;
  let profile=structuredClone(initial),read,selected=selections.get(ui.key)||profile.constraints.at(-1)?.id;
  let expanded=[false,false];
  const nextId=(prefix)=>{const used=new Set([...profile.points,...profile.entities,...profile.constraints].map(o=>o.id));let i=1;while(used.has(`${prefix}${i}`))i++;return `${prefix}${i}`;};
  function rebuild() {
    const oldDetails=[...parent.querySelectorAll('details')];
    if(oldDetails.length)expanded=oldDetails.map(d=>d.open);
    parent.replaceChildren();
    const note=element('p','Point coordinates and circle radii are starting guesses. Fixed points retain their coordinates; driving dimensions belong in constraints. Unused entities are construction geometry.','note');parent.append(note);
    const loop=field(parent,'PROFILE ENTITY ORDER',profile.loop.join(', '));
    parent.append(element('p','One circle ID, or line IDs in head-to-tail order (for example L1, L2, L3, L4). Endpoints must join after solving.','note'));
    const choice=(type,chosen)=>{
      const list=type==='point'?profile.points:profile.entities.filter(e=>e.type===type);
      const options=list.map(e=>[e.id,e.id]);
      if(chosen&&!list.some(e=>e.id===chosen))options.push([chosen,`${chosen} · missing`]);
      return options;
    };
    const pointsDetails=element('details'),entitiesDetails=element('details');
    pointsDetails.open=expanded[0];entitiesDetails.open=expanded[1];
    pointsDetails.append(element('summary',`Points & fixed coordinates (${profile.points.length})`));
    entitiesDetails.append(element('summary',`Lines & circles (${profile.entities.length})`));
    parent.append(pointsDetails,entitiesDetails);
    const pointRows=profile.points.map(p=>{
      const group=element('fieldset',undefined,'sketch-point-row');group.append(element('legend',p.id));pointsDetails.append(group);
      const u=field(group,`${p.id} SEED U`,p.position[0]),v=field(group,`${p.id} SEED V`,p.position[1]),fixed=field(group,`Fix ${p.id}`,'','checkbox');fixed.checked=p.fixed;fixed.parentElement.classList.add('check-field');
      group.append(button(`Remove point ${p.id}`,()=>mutate(pf=>{pf.points=pf.points.filter(point=>point.id!==p.id);})));return {p,u,v,fixed};
    });
    pointsDetails.append(button('Add sketch point',()=>mutate(p=>{if(p.points.length>=64)throw Error('Use at most 64 points.');p.points.push({id:nextId('P'),position:['10 mm','10 mm'],fixed:false});})));
    const entityRows=profile.entities.map(e=>{
      const group=element('fieldset',undefined,'sketch-point-row');group.append(element('legend',`${e.id} · ${e.type}${profile.loop.includes(e.id)?' · profile':' · construction'}`));entitiesDetails.append(group);
      const refs=e.type==='line'?[e.startId,e.endId]:[e.centerId];
      const fields=refs.map((ref,i)=>select(group,`${e.id} ${e.type==='circle'?'CENTER':i?'END':'START'}`,choice('point',ref),ref));
      const radius=e.type==='circle'?field(group,`${e.id} SEED RADIUS`,e.radius):null;
      group.append(button(`Remove entity ${e.id}`,()=>mutate(p=>{p.entities=p.entities.filter(en=>en.id!==e.id);})));return {e,fields,radius};
    });
    for(const type of ['line','circle']) entitiesDetails.append(button(`Add ${type}`,()=>mutate(p=>{
      if(p.entities.length>=64)throw Error('Use at most 64 entities.');
      if(p.points.length<(type==='line'?2:1))throw Error('Add the required points first.');
      p.entities.push(type==='line'?{id:nextId('L'),type,startId:p.points[0].id,endId:p.points[1].id}:{id:nextId('R'),type,centerId:p.points[0].id,radius:'5 mm'});
    })));
    parent.append(element('h3','Geometric constraints'));
    selected=profile.constraints.some(c=>c.id===selected)?selected:profile.constraints.at(-1)?.id;
    if(ui.key)selections.set(ui.key,selected);
    let activeRow;
    if(selected) {
      const current=profile.constraints.find(c=>c.id===selected);
      const picker=select(parent,'CONSTRAINT',profile.constraints.map(c=>[c.id,`${c.id} · ${CONSTRAINT_TYPES[c.type].label}${c.suppressed?' · suppressed':''}`]),selected);
      picker.oninput=(event)=>event.stopPropagation();
      picker.onchange=(event)=>{event.stopPropagation();profile=read();selected=picker.value;rebuild();};
      const kind=select(parent,'CONSTRAINT KIND',Object.entries(CONSTRAINT_TYPES).map(([id,s])=>[id,s.label]),current.type);
      const spec=CONSTRAINT_TYPES[current.type];
      const refs=spec.refs.map((type,i)=>select(parent,`REFERENCE ${i+1} / ${type.toUpperCase()}`,choice(type,current.refs[i]),current.refs[i]));
      const value=spec.value?field(parent,'DRIVING VALUE',current.value):null;
      const suppressed=field(parent,'Suppress constraint','','checkbox');suppressed.checked=current.suppressed;suppressed.parentElement.classList.add('check-field');
      if(current.type==='angle')parent.append(element('p','Directed angle from the first line to the second, counterclockwise in the sketch plane.','note'));
      if(current.type==='tangent-circles')parent.append(element('p','Internal or external tangency follows the local solution nearest the seed geometry.','note'));
      activeRow={current,kind,refs,value,suppressed};
      kind.onchange=()=>{
        profile=read();const c=profile.constraints.find(c=>c.id===selected),spec=CONSTRAINT_TYPES[kind.value],used=new Set();
        c.type=kind.value;c.refs=spec.refs.map((type,i)=>{const valid=choice(type).map(([id])=>id);const ref=valid.includes(current.refs[i])&&!used.has(current.refs[i])?current.refs[i]:valid.find(id=>!used.has(id))||'';used.add(ref);return ref;});
        if(spec.value)c.value=spec.value==='angle'?'90 deg':spec.value==='coordinate'?'0 mm':'10 mm';else delete c.value;
        rebuild();markDraft();changed();
      };
      parent.append(button('Remove constraint',()=>mutate(p=>{p.constraints=p.constraints.filter(c=>c.id!==selected);selected=null;})));
    } else parent.append(element('p','No constraints. Free geometry is determined by its seed coordinates.','note'));
    parent.append(button('Add constraint',()=>mutate(p=>{
      if(p.constraints.length>=128)throw Error('Use at most 128 constraints.');
      const line=p.entities.find(e=>e.type==='line'),circle=p.entities.find(e=>e.type==='circle');
      if(!line&&!circle)throw Error('Add a line or circle first.');
      const c={id:nextId('C'),type:line?'horizontal':'radius',refs:[(line||circle).id],...(!line?{value:'5 mm'}:{}),suppressed:false};p.constraints.push(c);selected=c.id;
    })));
    read=()=>({type:'constrained',points:pointRows.map(({p,u,v,fixed})=>({id:p.id,position:[u.value,v.value],fixed:fixed.checked})),
      entities:entityRows.map(({e,fields,radius})=>e.type==='line'?{id:e.id,type:e.type,startId:fields[0].value,endId:fields[1].value}:{id:e.id,type:e.type,centerId:fields[0].value,radius:radius.value}),
      loop:loop.value.split(',').map(s=>s.trim()).filter(Boolean),
      constraints:profile.constraints.map(c=>c.id===activeRow?.current.id?{id:c.id,type:c.type,refs:activeRow.refs.map(f=>f.value),...(activeRow.value?{value:activeRow.value.value}:{}),suppressed:activeRow.suppressed.checked}:{...c,refs:[...c.refs]}),
    });
  }
  function mutate(fn) {profile=read();fn(profile);rebuild();markDraft();changed();}
  rebuild();return ()=>read();
}
