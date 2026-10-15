import {volumeMeshDisplay} from './volume-mesh.mjs';
import {heatColor} from './viewer.mjs';
export function createModalDisplay(record,index,cut={axis:0,fraction:1},amplitude=.05){
  const mode=record.solution.modes[index];if(!mode)throw Error('Select a saved mode.');
  if(!Number.isFinite(amplitude)||amplitude<0||amplitude>.25)throw Error('Display amplitude must be 0–25% of the model diagonal.');
  const artifact=volumeMeshDisplay(record.mesh,cut.axis,cut.fraction),base=[...artifact.mesh.vertices],span=Math.hypot(...artifact.bounds[1].map((v,i)=>v-artifact.bounds[0][i])),distance=amplitude*span;
  const colors=[];for(const n of artifact.nodeIndices)colors.push(...heatColor(Math.hypot(...mode.shape.slice(n*3,n*3+3))));artifact.mesh.colors=colors;
  // Fixed full-cycle bounds prevent apparent camera motion during animation/cutaways.
  artifact.bounds=[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]];
  record.mesh.nodes.forEach((v,i)=>{const d=distance*Math.abs(mode.shape[i]),a=i%3;artifact.bounds[0][a]=Math.min(artifact.bounds[0][a],v-d);artifact.bounds[1][a]=Math.max(artifact.bounds[1][a],v+d);});
  const displayRadius=Math.hypot(...artifact.bounds[1].map((v,i)=>v-artifact.bounds[0][i]))/2;
  const setPhase=phase=>{if(!Number.isFinite(phase)||Math.abs(phase)>1)throw Error('Modal display phase must be −1 to 1.');for(let i=0;i<artifact.nodeIndices.length;i++)for(let a=0;a<3;a++)artifact.mesh.vertices[i*3+a]=base[i*3+a]+distance*1000*phase*mode.shape[artifact.nodeIndices[i]*3+a];return artifact;};
  setPhase(1);return {artifact,setPhase,displayRadius,distance};
}
export class ModeAnimation{
  constructor(draw,{request=callback=>requestAnimationFrame(callback),cancel=id=>cancelAnimationFrame(id)}={}){this.draw=draw;this.request=request;this.cancel=cancel;this.handle=null;this.running=false;}
  start(rate=1){
    if(!Number.isFinite(rate)||rate<.1||rate>3)throw Error('Animation speed must be 0.1–3 cycles per second.');
    this.stop();this.running=true;let start=null,last=-Infinity;
    const frame=time=>{if(!this.running)return;start??=time;if(time-last>=50){const angle=(time-start)/1000*rate*2*Math.PI;this.draw(Math.cos(angle),angle);last=time;}if(this.running)this.handle=this.request(frame);};this.handle=this.request(frame);
  }
  stop(){this.running=false;if(this.handle!==null)this.cancel(this.handle);this.handle=null;}
}
