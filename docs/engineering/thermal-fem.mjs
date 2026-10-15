import {cadFingerprint} from './cad-model.mjs';
import {validateSource} from './project.mjs';
import {resolveVolumeMesh} from './volume-mesh.mjs';
// A material/condition change invalidates results, but does not require remeshing.
export function reusableFemMesh(project,record){
  if(!record?.verified||record.provenance.projectId!==project.id)return false;
  const a=validateSource(project.source),b=validateSource(record.provenance.source),ma=a.source.meshes.find(m=>m.type==='gmsh-tetra'),mb=b.source.meshes.find(m=>m.type==='gmsh-tetra');
  return !!ma&&!!mb&&ma.id===mb.id&&cadFingerprint(a.source)===cadFingerprint(b.source)&&JSON.stringify(resolveVolumeMesh(ma,a.values,ma.bodyId).settings)===JSON.stringify(resolveVolumeMesh(mb,b.values,mb.bodyId).settings);
}
