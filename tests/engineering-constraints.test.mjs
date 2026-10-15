import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createProject,validateProject,ProjectHistory,fingerprint,isCurrent } from '../docs/engineering/project.mjs';
import { defaultSketch } from '../docs/engineering/sketch.mjs';
import { defaultConstraintProfile,resolveConstraintProfile,CONSTRAINT_TYPES } from '../docs/engineering/constraints-data.mjs';
import { solveConstraintGraph,constraintResiduals } from '../docs/engineering/constraints-solver.mjs';
import { cadFingerprint } from '../docs/engineering/cad-model.mjs';
import { buildSolid,describeSolid,exportSolid,importSTEP,measureVolume } from '../docs/engineering/cad-kernel.mjs';
import { parameters } from '../docs/engineering/units.mjs';
import { solveThermal,makeResult } from '../docs/engineering/thermal.mjs';
const near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);
const point=(id,x,y,fixed=false)=>({id,position:[`${x} mm`,`${y} mm`],fixed});
const line=(id,startId,endId)=>({id,type:'line',startId,endId});
const circle=(id,centerId,radius)=>({id,type:'circle',centerId,radius:`${radius} mm`});
const constraint=(id,type,refs,value)=>({id,type,refs,...(value===undefined?{}:{value}),suppressed:false});
const solve=profile=>solveConstraintGraph(resolveConstraintProfile(profile,new Map()).graph);
function example(){const p=createProject();p.source.sketches=[defaultSketch('sketch','constrained')];p.source.features=[{id:'extrusion',bodyId:'body-block',type:'extrude',name:'Constraint extrusion',sketchId:'sketch',distance:'10 mm',materialId:'aluminum'}];return p;}
async function solid(source,fn){const s=await buildSolid(source);try{await fn(s,describeSolid(s,source));}finally{s.delete();}}
function construction(){return {type:'constrained',points:[point('O',0,30,true)],entities:[circle('profile','O',2)],loop:['profile'],constraints:[constraint('base-radius','radius',['profile'],'2 mm')]};}

test('real PlaneGCS solves skewed rectangle seeds, reports zero DOF and builds exact geometry',async()=>{
  const p=example(),profile=p.source.sketches[0].profile;
  profile.points[1].position=['39 mm','1 mm'];profile.points[2].position=['41 mm','24 mm'];profile.points[3].position=['-1 mm','26 mm'];
  const solved=await solve(profile);assert.equal(solved.report.status,'fully-constrained');assert.equal(solved.report.dof,0);near(solved.area,.001);
  for(const [i,expected] of [[0,[0,0]],[1,[.04,0]],[2,[.04,.025]],[3,[0,.025]]])solved.geometry.points[i].position.forEach((v,j)=>near(v,expected[j]));
  await solid(p.source,(_,a)=>{near(a.volume*1e9,10000,1e-5);assert.equal(a.constrainedSketches[0].report.dof,0);});
});
test('under-constrained DOF reflects missing dimensions, free placement and unconstrained points',async()=>{
  const p=defaultConstraintProfile();p.constraints[5].suppressed=true;
  let s=await solve(p);assert.equal(s.report.status,'under-constrained');assert.equal(s.report.dof,1);
  p.points[0].fixed=false;s=await solve(p);assert.equal(s.report.dof,3);
  p.constraints=[];s=await solve(p);assert.equal(s.report.dof,8);
  p.points.forEach(p=>p.fixed=true);s=await solve(p);assert.equal(s.report.dof,0);
});
test('conflicting and redundant constraints identify their IDs and prevent CAD exports',async()=>{
  for(const [type,value] of [['length','50 mm'],['length','40 mm'],['horizontal',undefined]]){
    const p=example();p.source.sketches[0].profile.constraints.push(constraint('extra',type,['L1'],value));
    await assert.rejects(solve(p.source.sketches[0].profile),e=>{assert.equal(e.constraintReport.status,'over-constrained');assert.match(e.message,/C1|C5|extra/);return true;});
    await assert.rejects(buildSolid(p.source),/Over-constrained/);
    p.source.sketches[0].profile.constraints.at(-1).suppressed=true;
    await solid(p.source,(_,a)=>near(a.volume*1e9,10000,1e-5));
  }
});
test('parameter-driven constraints update dependent CAD without rewriting source seeds',async()=>{
  const p=example(),profile=p.source.sketches[0].profile;profile.constraints[4].value='length/2';
  const original=structuredClone(profile.points);
  await solid(p.source,(_,a)=>near(a.volume*1e9,7500,1e-5));
  const key=cadFingerprint(p.source);p.source.parameters[0].expression='100 mm';assert.notEqual(cadFingerprint(p.source),key);
  await solid(p.source,(_,a)=>near(a.volume*1e9,12500,1e-5));assert.deepEqual(profile.points,original);
  const namesKey=cadFingerprint(p.source);p.source.sketches[0].name='Renamed';assert.equal(cadFingerprint(p.source),namesKey);
});
test('parallel, perpendicular, equal length and directed angle constraints form known rectangles',async()=>{
  for(const kind of ['parallel','perpendicular','equal-length','angle']){
    const p=defaultConstraintProfile();p.points[2].position=['42 mm','24 mm'];
    if(kind==='parallel')p.constraints[2]=constraint('C3','parallel',['L1','L3']);
    else p.constraints[1]=constraint('C2',kind==='angle'?'angle':'perpendicular',['L1','L2'],kind==='angle'?'90 deg':undefined);
    if(kind==='equal-length')p.constraints[5]=constraint('C6','equal-length',['L1','L2']);
    const s=await solve(p);assert.equal(s.report.dof,0);near(s.area,kind==='equal-length'?.0016:.001);
  }
});
test('circle radius and diameter solve to the same independently known area and volume',async()=>{
  for(const type of ['radius','diameter']){
    const p=example();p.source.sketches[0].profile={type:'constrained',points:[point('center',20,15,true)],entities:[circle('circle','center',8)],loop:['circle'],constraints:[constraint('size',type,['circle'],type==='radius'?'10 mm':'20 mm')]};
    const solved=await solve(p.source.sketches[0].profile);assert.equal(solved.report.dof,0);near(solved.area,Math.PI*.01**2);
    await solid(p.source,(_,a)=>near(a.volume*1e9,Math.PI*1000,1e-5));
  }
});
test('coincident points join separately referenced lines; coordinate and distance constraints are dimensional',async()=>{
  const p=construction();p.points.push(point('A',0,0,true),point('B',4,3),point('C',4,3));
  p.constraints.push(constraint('u','u',['B'],'3 mm'),constraint('distance','distance',['A','B'],'5 mm'),constraint('coincident','coincident',['B','C']));
  const s=await solve(p);assert.equal(s.report.dof,0);
  for(const id of ['B','C']){const q=s.geometry.points.find(p=>p.id===id).position;near(q[0],.003);near(q[1],.004);}
  const joined=defaultConstraintProfile();joined.points.push(point('P5',.5,.5));joined.entities[3].endId='P5';joined.constraints.push(constraint('join','coincident',['P1','P5']));
  near((await solve(joined)).area,.001);
});
test('concentric and equal-radius circles use stable center and radius references',async()=>{
  const p=construction();p.points.push(point('A',2,3,true),point('B',4,6));p.entities.push(circle('R1','A',5),circle('R2','B',6));
  p.constraints.push(constraint('r1','radius',['R1'],'5 mm'),constraint('same-center','concentric',['R1','R2']),constraint('same-radius','equal-radius',['R1','R2']));
  const s=await solve(p);assert.equal(s.report.dof,0);assert.deepEqual(s.geometry.points.find(p=>p.id==='B').position,[.002,.003]);near(s.geometry.entities.find(e=>e.id==='R2').radius,.005);
});
test('line/circle and circle/circle tangency match independent distances',async()=>{
  const p=construction();p.points.push(point('A',-10,0,true),point('B',10,0,true),point('C',0,6));p.entities.push(line('L','A','B'),circle('R','C',4));
  p.constraints.push(constraint('radius','radius',['R'],'5 mm'),constraint('u','u',['C'],'0 mm'),constraint('touch','tangent',['L','R']));
  let s=await solve(p);assert.equal(s.report.dof,0);near(s.geometry.points.find(p=>p.id==='C').position[1],.005);
  const q=construction();q.points.push(point('A',0,0,true),point('B',12,0));q.entities.push(circle('R1','A',5),circle('R2','B',3));
  q.constraints.push(constraint('r1','radius',['R1'],'5 mm'),constraint('r2','radius',['R2'],'3 mm'),constraint('v','v',['B'],'0 mm'),constraint('touch','tangent-circles',['R1','R2']));
  s=await solve(q);assert.equal(s.report.dof,0);near(s.geometry.points.find(p=>p.id==='B').position[0],.008);
});
test('symmetry across a construction line mirrors a fixed point',async()=>{
  const p=construction();p.points.push(point('A',0,-10,true),point('B',0,10,true),point('P',5,3,true),point('Q',-4,2));p.entities.push(line('mirror','A','B'));
  p.constraints.push(constraint('symmetry','symmetric',['P','Q','mirror']));
  const s=await solve(p);assert.equal(s.report.dof,0);const q=s.geometry.points.find(p=>p.id==='Q').position;near(q[0],-.005);near(q[1],.003);
});
test('all advertised constraints have independent residual checks',async()=>{
  const p=defaultConstraintProfile(),s=await solve(p);s.geometry.points[1].position[1]=.001;
  assert.ok(constraintResiduals(s.geometry).some(r=>r.residual>r.tolerance));
  // Keep this explicit so a new menu entry requires a matching numerical test.
  assert.deepEqual(Object.keys(CONSTRAINT_TYPES),['horizontal','vertical','parallel','perpendicular','coincident','concentric','equal-length','equal-radius','tangent','tangent-circles','symmetric','distance','length','radius','diameter','angle','u','v']);
});
test('source validation rejects foreign references, wrong units, duplicate IDs and unsupported loops transactionally',()=>{
  const p=example(),history=new ProjectHistory(p),before=fingerprint(p.source);
  const edits=[
    s=>s.points[1].position=['2 mm'],s=>s.points[0].fixed='true',s=>s.entities[0].endId='missing',
    s=>s.entities[0].endId='P1',s=>s.entities[0].id='P1',s=>s.constraints[0].id='L1',
    s=>s.constraints[0].refs=['P1'],s=>s.constraints[0].type='garbage',s=>s.constraints[0].suppressed=0,
    s=>s.constraints[4].value='3 V',s=>s.constraints[4].value='0 mm',s=>s.constraints[4].value='1001 m',
    s=>s.constraints[0]=constraint('C1','angle',['L1','L2'],'400 deg'),s=>s.points[0].position[0]='1001 m',
    s=>s.loop=['L1'],s=>s.loop=['L1','L2','L1'],s=>s.loop=['L1','L2','missing'],
    s=>s.points=Array.from({length:65},(_,i)=>point(`new-${i}`,0,0)),
    s=>s.constraints=Array.from({length:129},(_,i)=>constraint(`new-${i}`,'horizontal',['L1'])),
  ];
  for(const edit of edits){const next=structuredClone(p.source);edit(next.sketches[0].profile);assert.throws(()=>history.update(next));assert.equal(fingerprint(history.project.source),before);}
});
test('open, crossed and collapsed solved profiles fail geometric validation rather than fabricating a solid',async()=>{
  const p=defaultConstraintProfile();p.constraints=[];p.points.forEach(p=>p.fixed=true);
  const crossed=structuredClone(p);crossed.points[1].position=['40 mm','25 mm'];crossed.points[2].position=['40 mm','0 mm'];
  await assert.rejects(solve(crossed),/intersect/);
  const open=structuredClone(p);open.points.push(point('P5',2,0,true));open.entities[3].endId='P5';await assert.rejects(solve(open),/open/);
  const collapsed=structuredClone(p);collapsed.points[1].position=['0 mm','0 mm'];await assert.rejects(solve(collapsed),/collapsed/);
});
test('constrained revolution and downstream subtraction use solved geometry on translated planes',async()=>{
  const p=example();p.source.features[0].type='revolve';delete p.source.features[0].distance;p.source.features[0].angle='180 deg';p.source.sketches[0].plane='XZ';
  await solid(p.source,(_,a)=>near(a.volume*1e9,.5*Math.PI*40**2*25,1e-4));
  const q=createProject();q.source.sketches=[defaultSketch('cut','constrained')];
  q.source.sketches[0].profile={type:'constrained',points:[point('P',30,10,true)],entities:[circle('R','P',3)],loop:['R'],constraints:[constraint('radius','radius',['R'],'4 mm')]};
  q.source.features.push({id:'cut-feature',name:'Constrained bore',bodyId:'body-block',type:'extrude',sketchId:'cut',distance:'10 mm',operation:'subtract',suppressed:false});
  await solid(q.source,(_,a)=>near(a.volume*1e9,12000-160*Math.PI,1e-5));
  p.source.sketches[0].profile.points[0].position[0]='-1 mm';await assert.rejects(buildSolid(p.source),/positive U/);
});
test('source history, project JSON and retained thermal provenance preserve constraint graphs',()=>{
  const p=createProject('project');p.results.push(makeResult(p,solveThermal(p.source),'thermal'));const original=fingerprint(p.source),history=new ProjectHistory(p);
  history.update(example().source);history.checkpoint('Constrained extrusion');
  const imported=validateProject(JSON.parse(JSON.stringify(history.project)),{imported:true});assert.deepEqual(imported.source.sketches,history.project.source.sketches);assert.equal(imported.results[0].verified,false);
  assert.equal(fingerprint(imported.results[0].provenance.source),original);assert.equal(isCurrent(history.project,history.project.results[0]),false);assert.throws(()=>solveThermal(history.project.source),/uncut block/);
  history.undo();assert.equal(isCurrent(history.project,history.project.results[0]),true);history.redo();assert.equal(history.project.source.sketches[0].profile.type,'constrained');
});
test('STEP exchange preserves exact constrained-profile volume',async()=>{
  const p=example();p.source.sketches[0].profile.constraints[4].value='length/2';
  await solid(p.source,async(shape,a)=>{const imported=await importSTEP(exportSolid(shape,'step'));try{near(measureVolume(imported),a.volume*1e9,1e-5);}finally{imported.delete();}});
});
test('preview worker diagnoses draft conflicts and solves unit-aware values without accepting source edits',{timeout:15000},async()=>{
  const url=new URL('../docs/engineering/constraints-worker.mjs',import.meta.url).href;
  const worker=new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:data=>parentPort.postMessage(data)};import(${JSON.stringify(url)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`,{eval:true});
  let id=0;const send=data=>new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('message',reply=>{worker.removeListener('error',reject);resolve(reply);});worker.postMessage({id:++id,...data});});
  try {
    const p=example(),sketch=p.source.sketches[0],values=[...parameters(p.source.parameters)];sketch.profile.constraints[4].value='length/2';
    let r=await send({sketch,values});assert.equal(r.solved.report.dof,0);near(r.solved.area,.00075);
    sketch.profile.constraints.push(constraint('conflict','length',['L1'],'40 mm'));r=await send({sketch,values});assert.match(r.diagnostic,/Over-constrained/);assert.equal(r.solved,undefined);
    sketch.profile.constraints.at(-1).suppressed=true;r=await send({sketch,values});assert.equal(r.solved.report.dof,0);
  }finally{await worker.terminate();}
});
