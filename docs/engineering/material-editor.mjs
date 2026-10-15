import {MATERIAL_PROPERTIES as PROPS,MATERIAL_AXES as AXES,materialDefinitions,resolveProperty,sampleProperty,resolveMaterial,densityDescription} from './materials.mjs';
import {quantity} from './units.mjs';
const selections=new Map(),NS='http://www.w3.org/2000/svg';
export function renderMaterialEditor(parent,material,values,ui){
  const {element,field,select,button,note,form,markDraft}=ui;
  let definitions=structuredClone(materialDefinitions(material)),active=selections.get(material.id)||'density',readEditor;
  if(!Object.hasOwn(definitions,active))active='density';
  const f=form(parent,()=>ui.commit(readMaterial()));
  const name=field(f.el,'MATERIAL NAME',material.name);
  const metadata=element('details');metadata.append(element('summary','Grade, source & notes'));f.el.append(metadata);
  const grade=field(metadata,'GRADE / CONDITION',material.grade||''),source=field(metadata,'DATA SOURCE / REFERENCE',material.referenceSource||'');
  const notesLabel=element('label','MATERIAL NOTES'),notes=element('textarea');notes.value=material.notes||'';notes.rows=3;notesLabel.append(notes);metadata.append(notesLabel);
  const reference=element('details');reference.append(element('summary','Reference conditions for mass'));f.el.append(reference);
  note(reference,'Variable density needs an explicit reference condition. These values evaluate density for mass; they do not set physics boundaries.');
  const conditions=Object.fromEntries(Object.entries(AXES).map(([key,axis])=>[key,field(reference,`REFERENCE ${axis.label.toUpperCase()}`,material.reference?.[key]||'')]));
  const propertyArea=element('div');f.el.append(propertyArea);
  const preview=element('div',undefined,'material-preview');f.el.append(preview);
  function saveEditor(){if(readEditor)definitions[active]=readEditor();}
  function readMaterial(){saveEditor();const out={id:material.id,name:name.value,conductivity:definitions.conductivity,density:definitions.density};
    const optional=Object.fromEntries(Object.entries(definitions).filter(([k])=>!['density','conductivity'].includes(k)));if(Object.keys(optional).length)out.properties=optional;
    const ref=Object.fromEntries(Object.entries(conditions).filter(([,el])=>el.value.trim()).map(([k,el])=>[k,el.value]));if(Object.keys(ref).length)out.reference=ref;
    for(const [k,v]of[['grade',grade.value],['referenceSource',source.value],['notes',notes.value]])if(v)out[k]=v;return out;
  }
  function choose(){
    readEditor=null;propertyArea.replaceChildren();
    const picker=select(propertyArea,'MATERIAL PROPERTY',Object.keys(definitions).map(k=>[k,`${PROPS[k].group} · ${PROPS[k].label}`]),active);
    picker.oninput=e=>e.stopPropagation();picker.onchange=e=>{e.stopPropagation();try{saveEditor();active=picker.value;selections.set(material.id,active);choose();}catch(error){picker.value=active;preview.replaceChildren();note(preview,error.message,'callout');}};
    const meta=PROPS[active],existing=definitions[active],editor=element('div');propertyArea.append(editor);
    note(editor,`Property units: ${meta.unit}. Use parameter expressions or compatible engineering units.`);
    const mode=select(editor,'PROPERTY DEFINITION',meta.tableOnly?[['table','Piecewise-linear table']]:[['constant','Constant / parameter expression'],['table','Piecewise-linear table']],typeof existing==='string'?'constant':'table');
    const fields=element('div');editor.append(fields);
    function fieldsFor(value){
      fields.replaceChildren();
      if(mode.value==='constant'){
        const val=field(fields,'PROPERTY VALUE',typeof value==='string'?value:'');val.placeholder=`Value in ${meta.unit}`;readEditor=()=>val.value;
      }else{
        const table=typeof value==='object'?value:{type:'table',axis:meta.axes[0],outside:'error',points:AXES[meta.axes[0]].examples.map(x=>({x,y:typeof value==='string'?value:''}))};
        const axis=select(fields,'CURVE INPUT',meta.axes.map(k=>[k,AXES[k].label]),table.axis);
        const outside=select(fields,'OUTSIDE TABLE RANGE',[['error','Reject extrapolation'],['clamp','Use nearest endpoint']],table.outside);
        const rowsLabel=element('label','CURVE POINTS · input ; property value');const rows=element('textarea');rows.rows=6;rows.spellcheck=false;
        rows.value=table.points.map(p=>`${p.x} ; ${p.y}`).join('\n');rowsLabel.append(rows);fields.append(rowsLabel);
        note(fields,'One point per line; separate input and value with a semicolon. Use 2–128 points in increasing input order. Both columns accept units and parameter expressions.');
        readEditor=()=>({type:'table',axis:axis.value,outside:outside.value,points:rows.value.split(/\r?\n/).filter(row=>row.trim()).map((row,i)=>{const parts=row.split(';');if(parts.length!==2)throw Error(`Curve row ${i+1} needs one semicolon.`);return{x:parts[0].trim(),y:parts[1].trim()};})});
        if(active==='density')note(fields,'Enter the corresponding reference condition above before applying variable density.','callout');
      }
      fields.oninput=()=>showPreview();fields.onchange=()=>showPreview();showPreview();
    }
    mode.onchange=()=>{let previous;try{previous=readEditor();}catch{previous=definitions[active];}fieldsFor(mode.value==='table'?previous:(typeof previous==='string'?previous:previous.points?.[0]?.y||''));markDraft();};
    fieldsFor(existing);
    if(!['density','conductivity'].includes(active))propertyArea.append(button('Remove this property',()=>{delete definitions[active];active='density';readEditor=null;markDraft();choose();},'full'));
    const available=Object.keys(PROPS).filter(k=>!Object.hasOwn(definitions,k));
    if(available.length){const add=select(propertyArea,'PROPERTY TO ADD',available.map(k=>[k,`${PROPS[k].group} · ${PROPS[k].label}`]),available[0]);add.oninput=e=>e.stopPropagation();add.onchange=e=>e.stopPropagation();
      propertyArea.append(button('Add material property',()=>{saveEditor();active=add.value;const p=PROPS[active];definitions[active]=p.tableOnly?{type:'table',axis:p.axes[0],outside:'error',points:AXES[p.axes[0]].examples.map(x=>({x,y:''}))}:'';markDraft();choose();},'full'));
    }
  }
  function showPreview(){
    preview.replaceChildren();let p;
    try{p=resolveProperty(active,readEditor(),values);}catch(error){note(preview,error.message,'callout');return;}
    const meta=PROPS[active];preview.append(element('h3',`${meta.label} preview`));
    if(p.type==='constant'){note(preview,`${Number(p.value.toPrecision(8))} ${meta.unit}`);return;}
    const axis=AXES[p.axis];
    const svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 320 220');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${meta.label} versus ${axis.label}`);svg.classList.add('material-curve');
    const add=(tag,attrs,txt)=>{const e=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);if(txt!==undefined)e.textContent=txt;svg.append(e);return e;};
    const minX=p.points[0].x,maxX=p.points.at(-1).x,minY=Math.min(...p.points.map(p=>p.y)),maxY=Math.max(...p.points.map(p=>p.y));
    const spanY=maxY-minY||Math.max(1,Math.abs(maxY)*.1),low=minY-(maxY===minY?spanY/2:0);
    const x=v=>15+285*(v-minX)/(maxX-minX),y=v=>165-130*(v-low)/spanY;
    add('path',{d:'M15 30V165H305',fill:'none',stroke:'#607782'});
    add('polyline',{points:p.points.map(p=>`${x(p.x)},${y(p.y)}`).join(' '),fill:'none',stroke:'#e7b46c','stroke-width':2});
    for(const point of p.points)add('circle',{cx:x(point.x),cy:y(point.y),r:3,fill:'#e7b46c'});
    const short=n=>n!==0&&(Math.abs(n)>=1e5||Math.abs(n)<1e-3)?Number(n.toPrecision(5)).toExponential().replace('e+','e'):Number(n.toPrecision(5)).toString();
    add('text',{x:15,y:187,fill:'#b9c8d0','font-size':14},short(minX));add('text',{x:300,y:187,fill:'#b9c8d0','font-size':14,'text-anchor':'end'},short(maxX));
    add('text',{x:15,y:18,fill:'#b9c8d0','font-size':14},`${short(minY)}–${short(maxY)} ${meta.unit}`);
    add('text',{x:160,y:214,fill:'#b9c8d0','font-size':14,'text-anchor':'middle'},`${axis.label} / ${axis.unit}`);preview.append(svg);
    const probe=field(preview,'EVALUATE AT',material.reference?.[p.axis]||`${(minX+maxX)/2}${axis.unit==='1'?'':` ${axis.unit}`}`),output=element('p',undefined,'note');
    probe.oninput=e=>e.stopPropagation();probe.onchange=e=>e.stopPropagation();
    preview.append(button('Evaluate property',()=>{try{const at=quantity(probe.value,axis.dim,values),sample=sampleProperty(p,at);output.textContent=`${Number(sample.value.toPrecision(10))} ${meta.unit}${sample.clamped?' · clamped to endpoint':''}`;}catch(error){output.textContent=error.message;}}),output);
  }
  choose();f.finish();
  const applied=resolveMaterial(material,values);
  note(parent,`${Object.keys(applied.properties).length} defined properties. ${densityDescription(applied)}`);
  note(parent,'Properties are real-valued scalars with optional single-variable tables. Missing properties are not invented. The current thermal solver consumes constant conductivity; other physics modules must explicitly support their required data.','callout');
}
