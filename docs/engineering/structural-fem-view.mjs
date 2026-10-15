import {volumeMeshDisplay} from './volume-mesh.mjs';
import {heatColor} from './viewer.mjs';
import {fieldRange} from './thermal-fem-view.mjs';
export function structuralField(record,field='vonMises'){
  const r=record.solution;
  if(field==='displacement')return {values:Array.from({length:r.displacements.length/3},(_,i)=>Math.hypot(...r.displacements.slice(i*3,i*3+3))),location:'node',unit:'µm',scale:1e6,label:'Displacement magnitude'};
  if(field==='strain')return {values:Array.from({length:r.strains.length/6},(_,i)=>{const e=r.strains.slice(i*6,i*6+6);return Math.sqrt(e.reduce((s,v,j)=>s+v*v*(j<3?1:2),0));}),location:'cell',unit:'1',scale:1,label:'Strain tensor norm'};
  if(field==='principalMax'||field==='principalMin')return {values:Array.from({length:r.principal.length/3},(_,i)=>r.principal[i*3+(field==='principalMax'?0:2)]),location:'cell',unit:'MPa',scale:1e-6,label:field==='principalMax'?'Maximum principal stress':'Minimum principal stress'};
  return {values:r.vonMises,location:'cell',unit:'MPa',scale:1e-6,label:'Von Mises stress'};
}
export function structuralDisplay(record,cut,field='vonMises',range=null,deformation=0){
  if(!Number.isFinite(deformation)||deformation<0||deformation>1e6)throw Error('Deformation display scale must be 0–1,000,000.');
  const {mesh,solution}=record,artifact=volumeMeshDisplay(mesh,cut.axis,cut.fraction),f=structuralField(record,field),colors=[];range=range||fieldRange(f.values);
  if(solution.maxDisplacementRatio*deformation>10)throw Error('Scaled deformation exceeds ten model diagonals. Reduce the display scale.');
  for(let i=0;i<artifact.nodeIndices.length;i++){
    const n=artifact.nodeIndices[i],index=f.location==='node'?n:artifact.cellIndices[i];colors.push(...heatColor((f.values[index]-range[0])/Math.max(1e-12,range[1]-range[0])));
    for(let a=0;a<3;a++)artifact.mesh.vertices[i*3+a]+=deformation*solution.displacements[n*3+a]*1000;
  }
  // Use all deformed nodes for a stable frame when moving the whole-cell cutaway.
  if(deformation){artifact.bounds=[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]];for(let i=0;i<mesh.nodes.length;i++){const v=mesh.nodes[i]+deformation*solution.displacements[i],a=i%3;artifact.bounds[0][a]=Math.min(artifact.bounds[0][a],v);artifact.bounds[1][a]=Math.max(artifact.bounds[1][a],v);}}
  artifact.mesh.colors=colors;return artifact;
}
