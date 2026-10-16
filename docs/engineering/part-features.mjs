import {quantity,dimensions} from './units.mjs';
import {validateSTEPText,validateSTEPAsset} from './step-input.mjs';
export const PART_OPERATIONS = [['add','Keep separate bodies'],['union','Union · join material'],['subtract','Subtract · use as cutting tool'],['intersect','Intersect · keep overlap']];
export const ADVANCED_FEATURES = ['step-part','transform','linear-pattern'];
export const zeroPlacement = () => ({translation:['0 mm','0 mm','0 mm'],rotation:['0 deg','0 deg','0 deg']});
function vector(input,dimension,values,limit,label){
  if(!Array.isArray(input)||input.length!==3||input.some(v=>typeof v!=='string'||!v.trim()||v.length>512))throw Error(`${label} needs three dimension expressions.`);
  const resolved=input.map(v=>quantity(v,dimension,values));
  if(resolved.some(v=>!Number.isFinite(v)||Math.abs(v)>limit))throw Error(`${label} exceeds the supported range.`);
  return {source:[...input],resolved};
}
export function resolveAdvancedFeature(f,values){
  if(f.type==='linear-pattern'){
    if(!Number.isInteger(f.count)||f.count<2||f.count>20)throw Error('A linear pattern needs 2–20 instances, including the original.');
    const spacing=vector(f.spacing,dimensions.length,values,1000,'Pattern spacing');
    if(Math.hypot(...spacing.resolved)<1e-6)throw Error('Pattern spacing must be at least 1 µm.');
    return {source:{count:f.count,spacing:spacing.source},definition:{count:f.count,spacing:spacing.resolved.map(v=>v*1000)}};
  }
  const translation=vector(f.placement?.translation,dimensions.length,values,10000,'Translation');
  const rotation=vector(f.placement?.rotation,dimensions.scalar,values,Math.PI*200,'Rotation');
  const source={placement:{translation:translation.source,rotation:rotation.source}},definition={translation:translation.resolved.map(v=>v*1000),rotation:rotation.resolved.map(v=>v*180/Math.PI)};
  if(f.type==='step-part'){
    if(!PART_OPERATIONS.some(([id])=>id===f.operation))throw Error('Choose separate bodies, union, subtract or intersect.');
    if(typeof f.fileName!=='string'||!f.fileName.trim()||f.fileName.length>160)throw Error('A STEP part needs a file name.');
    if(f.stepAsset&&f.stepText!==undefined)throw Error('A STEP part must use either embedded text or a stored asset.');
    const payload=f.stepAsset?{stepAsset:validateSTEPAsset(f.stepAsset)}:{stepText:validateSTEPText(f.stepText)};
    Object.assign(source,{fileName:f.fileName,operation:f.operation,...payload});Object.assign(definition,{operation:f.operation,...payload});
  }
  return {source,definition};
}
export const usesNativeCAD = source => !!source?.features?.some(f=>!f.suppressed&&f.stepAsset);
export function appendSTEP(source,data,fileName,id=crypto.randomUUID()){
  if(source.features.length>=25)throw Error('Use at most 24 downstream operations.');
  source.features.push({id,bodyId:source.features[0].bodyId,type:'step-part',name:fileName.slice(0,160),fileName:fileName.slice(0,160),suppressed:false,operation:'add',placement:zeroPlacement(),...(typeof data==='string'?{stepText:validateSTEPText(data)}:{stepAsset:validateSTEPAsset(data)})});
  return id;
}
export function addTransform(source,type,bounds,id=crypto.randomUUID()){
  const feature={id,bodyId:source.features[0].bodyId,type,name:type==='transform'?'Move / rotate':'Linear pattern',suppressed:false};
  if(type==='transform')feature.placement=zeroPlacement();
  else if(type==='linear-pattern')Object.assign(feature,{count:2,spacing:[`${((bounds[1][0]-bounds[0][0])*1200).toPrecision(8)} mm`,'0 mm','0 mm']});
  else throw Error('Choose move/rotate or linear pattern.');
  source.features.push(feature);return id;
}
