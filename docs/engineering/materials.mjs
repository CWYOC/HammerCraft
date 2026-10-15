import { dimensions as d, quantity } from './units.mjs';
const axes = ['temperature','frequency','pressure','strain'];
const property=(label,group,dim,unit,min,max,exclusiveMin=false,extra={})=>({label,group,dim,unit,min,max,exclusiveMin,axes,...extra});
export const MATERIAL_PROPERTIES = {
  density:property('Density','General',d.density,'kg/m^3',0,1e6,true),
  conductivity:property('Thermal conductivity','Thermal',d.conductivity,'W/(m*K)',1e-6,1e6),
  youngModulus:property("Young’s modulus",'Mechanical',d.pressure,'Pa',0,1e15,true),
  poissonRatio:property('Poisson ratio · isotropic','Mechanical',d.scalar,'1',-1,.5,true,{exclusiveMax:true}),
  yieldStrength:property('Yield strength','Mechanical',d.pressure,'Pa',0,1e15),
  ultimateStrength:property('Ultimate tensile strength','Mechanical',d.pressure,'Pa',0,1e15),
  dampingRatio:property('Damping ratio','Mechanical',d.scalar,'1',0,1e6),
  specificHeat:property('Specific heat capacity','Thermal',d.specificHeat,'J/(kg*K)',0,1e12,true),
  thermalExpansion:property('Linear thermal expansion','Thermal',d.thermalExpansion,'1/K',-1e6,1e6),
  electricalConductivity:property('Electrical conductivity','Electrical',d.electricalConductivity,'S/m',0,1e16),
  resistivity:property('Electrical resistivity','Electrical',d.resistivity,'ohm*m',0,1e30),
  permittivity:property('Absolute permittivity','Electrical',d.permittivity,'F/m',0,1e6,true),
  permeability:property('Absolute permeability','Magnetic',d.permeability,'H/m',0,1e6,true),
  coercivity:property('Coercivity','Magnetic',d.magneticField,'A/m',0,1e12),
  remanence:property('Remanent flux density','Magnetic',d.fluxDensity,'T',0,1e6),
  bhCurve:property('B–H relation · single-valued B(H)','Magnetic',d.fluxDensity,'T',-1e6,1e6,false,{axes:['magneticField'],tableOnly:true,monotonic:true}),
  soundSpeed:property('Speed of sound','Acoustic / fluid',d.speed,'m/s',0,3e8,true),
  dynamicViscosity:property('Dynamic viscosity','Acoustic / fluid',d.viscosity,'Pa*s',0,1e12),
  acousticAttenuation:property('Acoustic attenuation · amplitude','Acoustic / fluid',d.attenuation,'Np/m',0,1e12),
};
export const MATERIAL_AXES = {
  temperature:{label:'Temperature',dim:d.temperature,unit:'K',min:0,max:1e6,examples:['20 degC','120 degC']},
  frequency:{label:'Frequency',dim:d.frequency,unit:'Hz',min:0,max:1e15,examples:['100 Hz','1000 Hz']},
  pressure:{label:'Absolute pressure',dim:d.pressure,unit:'Pa',min:0,max:1e15,examples:['1 bar','2 bar']},
  strain:{label:'Engineering strain',dim:d.scalar,unit:'1',min:-1e3,max:1e3,examples:['0','0.01']},
  magneticField:{label:'Magnetic field H',dim:d.magneticField,unit:'A/m',min:-1e12,max:1e12,examples:['0 A/m','1000 A/m']},
};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
function text(v,label,max=512,empty=false){if(typeof v!=='string'||(!empty&&!v.trim())||v.length>max)throw Error(`${label} must contain ${empty?'0':'1'}–${max} characters.`);return v;}
function checked(value,meta){
  if(!Number.isFinite(value)||value<meta.min||value>meta.max||(meta.exclusiveMin&&value===meta.min)||(meta.exclusiveMax&&value===meta.max))
    throw Error(`${meta.label} must be ${meta.exclusiveMin?'greater than':'at least'} ${meta.min} and ${meta.exclusiveMax?'less than':'at most'} ${meta.max} ${meta.unit}.`);
  return value;
}
export function resolveProperty(key,input,values=new Map()) {
  if(!Object.hasOwn(MATERIAL_PROPERTIES,key))throw Error(`Unsupported material property: ${key}.`);
  const meta=MATERIAL_PROPERTIES[key];
  const read=(v,m)=>checked(quantity(text(v,m.label),m.dim,values),m);
  if(typeof input==='string'){
    if(meta.tableOnly)throw Error(`${meta.label} requires a table.`);
    return {source:input,type:'constant',value:read(input,meta),key};
  }
  if(!object(input)||input.type!=='table'||!meta.axes.includes(input.axis)||!['error','clamp'].includes(input.outside)||
    !Array.isArray(input.points)||input.points.length<2||input.points.length>128)
    throw Error(`${meta.label}: use a table with 2–128 points, a supported axis, and error/clamp outside its range.`);
  const axis=MATERIAL_AXES[input.axis];
  const points=input.points.map((p,i)=>{
    if(!object(p))throw Error(`${meta.label}: invalid point ${i+1}.`);
    return {x:read(p.x,axis),y:read(p.y,meta)};
  });
  for(let i=1;i<points.length;i++){
    if(points[i].x<=points[i-1].x)throw Error(`${meta.label}: input points must be strictly increasing, with no duplicate coordinates.`);
    if(meta.monotonic&&points[i].y<points[i-1].y)throw Error('The single-valued B–H table must have nondecreasing B. Hysteresis loops are not supported.');
  }
  return {source:{type:'table',axis:input.axis,outside:input.outside,points:input.points.map(p=>({x:p.x,y:p.y}))},
    type:'table',axis:input.axis,outside:input.outside,points,key};
}
export function sampleProperty(property,coordinate) {
  if(property.type==='constant')return {value:property.value,clamped:false};
  if(!Number.isFinite(coordinate))throw Error(`Provide ${MATERIAL_AXES[property.axis].label.toLowerCase()} to evaluate this property.`);
  checked(coordinate,MATERIAL_AXES[property.axis]);
  const p=property.points,first=p[0],last=p.at(-1);
  if(coordinate<first.x||coordinate>last.x){
    if(property.outside==='error')throw Error(`Property input is outside ${first.x}–${last.x} ${MATERIAL_AXES[property.axis].unit}; extrapolation is disabled.`);
    return {value:coordinate<first.x?first.y:last.y,clamped:true};
  }
  if(coordinate===last.x)return {value:last.y,clamped:false};
  let lo=0,hi=p.length-1;while(hi-lo>1){const mid=(hi+lo)>>1;if(p[mid].x<=coordinate)lo=mid;else hi=mid;}
  const fraction=(coordinate-p[lo].x)/(p[hi].x-p[lo].x);
  return {value:p[lo].y+(p[hi].y-p[lo].y)*fraction,clamped:false};
}
export function materialDefinitions(material) {return {density:material.density,conductivity:material.conductivity,...(material.properties||{})};}
export function resolveMaterial(input,values=new Map()) {
  if(!object(input)||typeof input.id!=='string'||!/^[A-Za-z0-9_.-]{1,100}$/.test(input.id))throw Error('Invalid material ID.');
  const source={id:input.id,name:text(input.name,'Material name',160),conductivity:null,density:null},properties={};
  if(input.properties!==undefined&&(!object(input.properties)||Object.keys(input.properties).some(k=>!Object.hasOwn(MATERIAL_PROPERTIES,k)||['density','conductivity'].includes(k))))
    throw Error('Optional material properties contain an unknown or duplicate base property.');
  for(const [key,definition] of Object.entries(materialDefinitions(input))){properties[key]=resolveProperty(key,definition,values);}
  source.conductivity=properties.conductivity.source;source.density=properties.density.source;
  const additional=Object.keys(input.properties||{}).sort();
  if(additional.length)source.properties=Object.fromEntries(additional.map(k=>[k,properties[k].source]));
  const reference={};
  if(input.reference!==undefined){
    if(!object(input.reference)||Object.keys(input.reference).some(k=>!Object.hasOwn(MATERIAL_AXES,k)))throw Error('Invalid material reference condition.');
    const entries=Object.keys(input.reference).sort();
    if(entries.length)source.reference={};
    for(const key of entries){const expr=text(input.reference[key],'Reference condition'),axis=MATERIAL_AXES[key];reference[key]=checked(quantity(expr,axis.dim,values),axis);source.reference[key]=expr;}
  }
  for(const [key,max]of[['grade',160],['referenceSource',2048],['notes',4096]])if(input[key]!==undefined&&input[key]!=='')source[key]=text(input[key],key,max);
  const density=properties.density;
  if(density.type==='table'&&!Object.hasOwn(reference,density.axis))throw Error('Variable density requires an explicit material reference condition for the mass calculation.');
  const massDensity=sampleProperty(density,reference[density.axis]);
  return {...source,source,properties,reference,rho:massDensity.value,
    k:properties.conductivity.type==='constant'?properties.conductivity.value:null,
    densityAt:density.type==='table'?{axis:density.axis,coordinate:reference[density.axis],clamped:massDensity.clamped}:null};
}
export function densityDescription(material) {
  const at=material.densityAt;
  return at?`Density evaluated at ${at.coordinate} ${MATERIAL_AXES[at.axis].unit}${at.clamped?' (clamped to the table endpoint)':''}; reference mass does not include thermal expansion or deformation.`:'Constant density';
}
export const MATERIAL_FORMAT='hc-material-1';
export function materialSnapshot(input,values=new Map()) {
  const resolved=resolveMaterial(input,values),source=structuredClone(resolved.source);
  const expression=(n,unit)=>`${Number(n.toPrecision(16))}${unit==='1'?'':` ${unit}`}`;
  const snapshot={};
  for(const [key,p]of Object.entries(resolved.properties)){
    const meta=MATERIAL_PROPERTIES[key];snapshot[key]=p.type==='constant'?expression(p.value,meta.unit):
      {type:'table',axis:p.axis,outside:p.outside,points:p.points.map(point=>({x:expression(point.x,MATERIAL_AXES[p.axis].unit),y:expression(point.y,meta.unit)}))};
  }
  source.density=snapshot.density;source.conductivity=snapshot.conductivity;
  delete snapshot.density;delete snapshot.conductivity;
  if(Object.keys(snapshot).length)source.properties=snapshot;
  if(source.reference)source.reference=Object.fromEntries(Object.entries(resolved.reference).map(([k,v])=>[k,expression(v,MATERIAL_AXES[k].unit)]));
  return {format:MATERIAL_FORMAT,material:resolveMaterial(source).source};
}
export function importMaterialSnapshot(input,id=crypto.randomUUID()) {
  if(!object(input)||input.format!==MATERIAL_FORMAT)throw Error('Choose an Engineering Studio material snapshot.');
  return resolveMaterial({...input.material,id}).source;
}
