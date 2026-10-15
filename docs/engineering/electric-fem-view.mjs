import {volumeMeshDisplay} from './volume-mesh.mjs';
import {heatColor} from './viewer.mjs';
export function electricField(record,field='potential'){
  const r=record.solution;if(field==='potential')return {values:r.potentials,location:'node',unit:'V',label:'Electric potential'};
  if(field==='joule')return {values:r.jouleDensity,location:'cell',unit:'W/m³',label:'Joule heat density'};
  const key=field==='field'?'electricField':'currentDensity',values=Array.from({length:r[key].length/3},(_,i)=>Math.hypot(...r[key].slice(i*3,i*3+3)));return {values,location:'cell',unit:field==='field'?'V/m':'A/m²',label:field==='field'?'Electric field magnitude':'Current density magnitude'};
}
export function electricDisplay(record,cut,field='potential'){
  const artifact=volumeMeshDisplay(record.mesh,cut.axis,cut.fraction),f=electricField(record,field);let min=Infinity,max=-Infinity;for(const v of f.values){min=Math.min(min,v);max=Math.max(max,v);}const colors=[];for(let i=0;i<artifact.nodeIndices.length;i++){const v=f.values[f.location==='node'?artifact.nodeIndices[i]:artifact.cellIndices[i]];colors.push(...heatColor(max===min ? .5 :(v-min)/(max-min)));}artifact.mesh.colors=colors;return {artifact,...f,min,max};
}
