import {COMPUTE_URL,ComputeWorker} from './compute-client.mjs';
import {cadFingerprint,cadDefinition} from './cad-model.mjs';
import {validateSTEPAsset,validateSTEPFileSize} from './step-input.mjs';
const headers={'X-HC-Compute':'1'};
let previewCache=null;
export async function uploadSTEP(file,signal,fetcher=fetch){
  validateSTEPFileSize(file.size);
  let response;
  try{response=await fetcher(`${COMPUTE_URL}/step-assets`,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:file,signal});}
  catch(error){if(signal?.aborted)throw Error('STEP upload cancelled.');throw Error('Large STEP imports need the updated local Rust compute service. Start it, then import again.');}
  const data=await response.json();if(!response.ok)throw Error(data.error||'STEP upload failed.');return validateSTEPAsset(data);
}
export function validateNativeArtifact(a){
  if(a?.solidCount!==undefined&&(!Number.isInteger(a.solidCount)||a.solidCount<1||a.solidCount>64))throw Error('Invalid CAD body count.');
  if(a?.stepAsset)validateSTEPAsset(a.stepAsset);
  if(!a||typeof a.kernel!=='string'||!Number.isFinite(a.volume)||a.volume<=0||!Array.isArray(a.bounds)||a.bounds.length!==2||a.bounds.some(p=>!Array.isArray(p)||p.length!==3||p.some(v=>!Number.isFinite(v)))||a.bounds[1].some((v,i)=>v<=a.bounds[0][i]))throw Error('Invalid native CAD geometry summary.');
  const {vertices,normals,triangles}=a.mesh||{};
  if(!Array.isArray(vertices)||!vertices.length||vertices.length%3||vertices.length>600000||vertices.some(v=>!Number.isFinite(v))||!Array.isArray(normals)||normals.length!==vertices.length||normals.some(v=>!Number.isFinite(v))||!Array.isArray(triangles)||!triangles.length||triangles.length%3||triangles.length>450000||triangles.some(v=>!Number.isInteger(v)||v<0||v>=vertices.length/3)||!Array.isArray(a.edges)||a.edges.length%6||a.edges.length>1200000||a.edges.some(v=>!Number.isFinite(v)))throw Error('Invalid native CAD preview mesh.');
  if(a.triangleCount!==triangles.length/3||!Number.isInteger(a.faceCount)||a.faceCount<1)throw Error('Invalid native CAD preview counts.');
  return a;
}
function stlBlob(artifact){
  const {vertices,triangles}=artifact.mesh,bytes=new ArrayBuffer(84+50*triangles.length/3),view=new DataView(bytes);view.setUint32(80,triangles.length/3,true);
  for(let i=0;i<triangles.length;i+=3){const p=triangles.slice(i,i+3).map(n=>vertices.slice(n*3,n*3+3)),u=p[1].map((v,a)=>v-p[0][a]),v=p[2].map((v,a)=>v-p[0][a]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n);[...n.map(v=>v/length),...p.flat()].forEach((v,j)=>view.setFloat32(84+50*i/3+j*4,v,true));}
  return new Blob([bytes],{type:'model/stl'});
}
export class NativeCadClient{
  constructor(fetcher=fetch){this.fetcher=(...args)=>fetcher(...args);}
  reset(){this.worker?.terminate();this.worker=null;this.reject?.(Error('CAD operation superseded by a newer model.'));this.reject=null;this.state=null;this.controller?.abort();}
  async request(action,data){
    if(action==='build'){
      this.reset();const source=data.source,asset=validateSTEPAsset(data.stepAsset||source.features[0].stepAsset),steps=data.steps||cadDefinition(source).steps||[];
      if(steps.some(s=>!['step-part','transform','linear-pattern'].includes(s.type)))throw Error('After a large STEP import, use STEP part Booleans, move/rotate or linear pattern. Sketch and edge operations must precede the large import.');
      const fingerprint=cadFingerprint(source);
      if(previewCache?.artifact.fingerprint===fingerprint){const artifact={...previewCache.artifact,fingerprint};this.state={asset:previewCache.asset,artifact};return {artifact};}
      const controller=new AbortController();this.controller=controller;
      const operations=[];
      for(const step of steps){
        if(step.type==='step-part'){
          const stepAsset=step.stepAsset||await uploadSTEP(new Blob([step.stepText]),controller.signal,this.fetcher);
          const {stepText,...rest}=step;operations.push({...rest,stepAsset});
        }else operations.push(step);
      }
      if(controller.signal.aborted)throw Error('CAD operation superseded by a newer model.');
      const worker=new ComputeWorker(this.fetcher,300,910000);this.worker=worker;
      const artifact=await new Promise((resolve,reject)=>{this.reject=reject;worker.onmessage=({data:e})=>{if(e.state==='Completed'){this.reject=null;worker.terminate();try{resolve(validateNativeArtifact(e.artifact));}catch(error){reject(error);}}else if(['Failed','Cancelled'].includes(e.state)){this.reject=null;worker.terminate();reject(Error(e.error||'CAD import cancelled.'));}};worker.postMessage({id:'native-cad',action:'cad-step',options:{request:{kind:'cad-step',stepAsset:asset,operations}}});});
      if(this.worker!==worker)throw Error('CAD operation superseded by a newer model.');
      if(operations.length&&(artifact.operationsApplied!==operations.length||!artifact.stepAsset))throw Error('Update and restart the local Rust compute service to edit multiple STEP parts.');
      artifact.stepAsset=artifact.stepAsset||asset;
      artifact.fingerprint=fingerprint;this.state={asset:artifact.stepAsset?validateSTEPAsset(artifact.stepAsset):asset,artifact};previewCache=this.state;return {artifact};
    }
    if(action!=='export'||!this.state||this.state.artifact.fingerprint!==data.fingerprint)throw Error('Regenerate the imported solid before exporting.');
    if(data.format==='stl')return {blob:stlBlob(this.state.artifact)};
    if(data.format!=='step')throw Error('Choose STEP or STL export.');
    this.controller=new AbortController();const response=await this.fetcher(`${COMPUTE_URL}/step-assets/${this.state.asset.sha256}`,{headers,signal:this.controller.signal});
    if(!response.ok)throw Error((await response.json()).error||'STEP download failed.');return {blob:await response.blob()};
  }
}
