import {volumeMeshDisplay} from './volume-mesh.mjs';
import {heatColor} from './viewer.mjs';
export function fieldRange(values){let lo=Infinity,hi=-Infinity;for(const v of values){lo=Math.min(lo,v);hi=Math.max(hi,v);}return [lo,hi];}
export function femField(record,field='temperature'){
  if(field==='temperature')return {values:record.solution.temperatures,location:'node',unit:'°C',offset:-273.15};
  const key=field==='flux'?'heatFlux':'gradients',raw=record.solution[key];
  return {values:Array.from({length:raw.length/3},(_,i)=>Math.hypot(...raw.slice(i*3,i*3+3))),location:'cell',unit:field==='flux'?'W/m²':'K/m',offset:0};
}
export function femDisplay(mesh,cut,record=null,field='temperature',range=null,selected=null){
  const artifact=volumeMeshDisplay(mesh,cut.axis,cut.fraction),colors=[];
  if(record){const f=femField(record,field);range=range||fieldRange(f.values);
    for(let i=0;i<artifact.nodeIndices.length;i++){const index=f.location==='node'?artifact.nodeIndices[i]:artifact.cellIndices[i];colors.push(...heatColor((f.values[index]-range[0])/Math.max(1e-12,range[1]-range[0])));}
  }else for(let i=0;i<artifact.nodeIndices.length;i++)colors.push(...(artifact.surfaceTags[Math.floor(i/3)]===selected?[1,.65,.2]:[.65,.73,.79]));
  artifact.mesh.colors=colors;return artifact;
}
