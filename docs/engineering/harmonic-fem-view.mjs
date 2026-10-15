import {volumeMeshDisplay} from './volume-mesh.mjs';
import {heatColor} from './viewer.mjs';
import {harmonicFields} from './harmonic-fem-data.mjs';
import {ModeAnimation} from './modal-fem-view.mjs';
export class HarmonicAnimation extends ModeAnimation{
  constructor(draw,clock){super((cosine,angle)=>draw(angle),clock);}
}
export function createHarmonicDisplay(record,index,q,cut={axis:0,fraction:1},scale=1,field='displacement'){
  if(!Number.isFinite(scale)||scale<0||scale>1e6)throw Error('Deformation display scale must be 0–1,000,000.');
  const response=record.solution.responses[index];if(!response)throw Error('Select a saved harmonic frequency.');
  const artifact=volumeMeshDisplay(record.mesh,cut.axis,cut.fraction),base=[...artifact.mesh.vertices],fields=harmonicFields(record.mesh,response,q),peak=Math.max(...fields.peak),span=Math.hypot(...artifact.bounds[1].map((v,i)=>v-artifact.bounds[0][i]));
  if(scale*peak>10*span)throw Error('Scaled deformation exceeds ten model diagonals. Reduce the display scale.');
  let values=fields.peak,unit='µm',factor=1e6,label='Peak displacement magnitude',location='node';
  if(field==='velocity'){values=values.map(v=>v*2*Math.PI*response.frequency);unit='m/s';factor=1;label='Peak velocity magnitude';}
  else if(field==='vonMises'){values=fields.vonMises;unit='MPa';factor=1e-6;label='Cycle peak elastic von Mises stress';location='cell';}
  const max=values.reduce((a,b)=>Math.max(a,b),0),colors=[];
  for(let i=0;i<artifact.nodeIndices.length;i++)colors.push(...heatColor(max?values[location==='node'?artifact.nodeIndices[i]:artifact.cellIndices[i]]/max:0));artifact.mesh.colors=colors;
  artifact.bounds=[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]];
  record.mesh.nodes.forEach((v,i)=>{const d=scale*Math.hypot(response.real[i],response.imag[i]),a=i%3;artifact.bounds[0][a]=Math.min(artifact.bounds[0][a],v-d);artifact.bounds[1][a]=Math.max(artifact.bounds[1][a],v+d);});
  const displayRadius=Math.hypot(...artifact.bounds[1].map((v,i)=>v-artifact.bounds[0][i]))/2;
  const setPhase=angle=>{if(!Number.isFinite(angle))throw Error('Invalid harmonic display phase.');const c=Math.cos(angle),s=Math.sin(angle);for(let i=0;i<artifact.nodeIndices.length;i++)for(let a=0;a<3;a++){const j=artifact.nodeIndices[i]*3+a;artifact.mesh.vertices[i*3+a]=base[i*3+a]+scale*1000*(response.real[j]*c-response.imag[j]*s);}return artifact;};
  setPhase(0);return {artifact,setPhase,displayRadius,label,unit,max:max*factor,peak,maxStrain:fields.maxStrain,large:peak/span>.05||fields.maxStrain>.01};
}
