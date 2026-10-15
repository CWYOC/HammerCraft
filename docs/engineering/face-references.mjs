// Conditions reference CAD surface geometry. Gmsh tags are resolved per mesh snapshot.
const identity=v=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(v);
export const faceSupport=source=>source.features.filter(f=>!f.suppressed).map(f=>`${f.id}:${f.type}`);
export function faceReference(group,id=crypto.randomUUID()){
  return normalizeFaceReference({id,anchor:{type:group.type,center:group.center,area:group.area}});
}
export function normalizeFaceReference(ref){
  const a=ref?.anchor;
  if(!identity(ref?.id)||!a||typeof a.type!=='string'||!a.type||a.type.length>80||!Number.isFinite(a.area)||a.area<=0||a.area>1e8||!Array.isArray(a.center)||a.center.length!==3||a.center.some(v=>!Number.isFinite(v)||Math.abs(v)>10000))throw Error('Invalid CAD surface reference.');
  return {id:ref.id,anchor:{type:a.type,center:[...a.center],area:a.area}};
}
export function resolveFaceReference(ref,groups){
  const {anchor:a}=normalizeFaceReference(ref),length=Math.sqrt(a.area);
  const matches=groups.filter(g=>g.type===a.type&&Math.abs(g.area-a.area)<=1e-6*a.area&&g.center.every((v,i)=>Math.abs(v-a.center[i])<=Math.max(1e-10,length*1e-6)));
  if(matches.length!==1)throw Error(`Surface reference ${ref.id} is ${matches.length?'ambiguous':'missing'}. Reselect the CAD surface.`);
  return matches[0];
}
