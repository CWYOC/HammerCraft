import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createProject, validateSource, validateProject, ProjectHistory, fingerprint, isCurrent } from '../docs/engineering/project.mjs';
import { defaultSketch } from '../docs/engineering/sketch.mjs';
import { cadDefinition, cadFingerprint } from '../docs/engineering/cad-model.mjs';
import { addSketchOperation, removeFeature, moveFeature, rebindSketch, detachSketch } from '../docs/engineering/features.mjs';
import { buildSolid, describeSolid, exportSolid, importSTEP, measureVolume } from '../docs/engineering/cad-kernel.mjs';
import { stepSource } from '../docs/engineering/cad-import.mjs';
import { solveThermal, makeResult } from '../docs/engineering/thermal.mjs';

const near = (a,b,eps=1e-5) => assert.ok(Math.abs(a-b)<=eps, `${a} != ${b}`);
const bounds = [[0,0,0],[.06,.02,.01]];
function rectangle(source, operation='union', id='tool', corner=['50 mm','5 mm'], width='20 mm', height='10 mm') {
  source.sketches ||= [];
  source.sketches.push({...defaultSketch(`sketch-${id}`), profile:{type:'rectangle',corner,width,height}});
  source.features.push({id,bodyId:source.features[0].bodyId,name:id,type:'extrude',sketchId:`sketch-${id}`,operation,suppressed:false,distance:'10 mm'});
  return source.features.at(-1);
}
async function solid(source, fn) {
  const shape=await buildSolid(source);
  try {await fn(shape,describeSolid(shape,source));} finally {shape.delete();}
}

test('union, subtraction and intersection match independent overlap volumes and final bounds',async()=>{
  for (const [operation,volume,xmin,xmax] of [['union',13000,0,70],['subtract',11000,0,60],['intersect',1000,50,60]]) {
    const p=createProject();rectangle(p.source,operation);
    await solid(p.source,(_,a)=>{near(a.volume*1e9,volume);near(a.bounds[0][0]*1000,xmin);near(a.bounds[1][0]*1000,xmax);assert.ok(a.mesh.vertices.every(Number.isFinite));});
  }
});

test('default tools make a through cut, attached boss or clipped block from actual bounds',async()=>{
  for(const [operation,expected] of [['subtract',12000-160*Math.PI],['union',12960],['intersect',9000]]){
    const p=createProject();addSketchOperation(p.source,operation,bounds,{sketch:'profile',feature:'operation'});
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))).source,p.source);
    await solid(p.source,(_,a)=>near(a.volume*1e9,expected));
  }
});

test('blind pocket and parameter edits regenerate the actual cut volume',async()=>{
  const p=createProject();addSketchOperation(p.source,'subtract',bounds,{sketch:'profile',feature:'pocket'});
  p.source.sketches[0].origin[2]='height';p.source.features[1].distance='-height/2';
  await solid(p.source,(_,a)=>near(a.volume*1e9,12000-80*Math.PI));
  p.source.parameters[2].expression='20 mm';
  await solid(p.source,(_,a)=>near(a.volume*1e9,24000-160*Math.PI));
});

test('mixed legacy holes and sketch operations execute in feature order',async()=>{
  const p=createProject();
  p.source.features.push({id:'hole',bodyId:'body-block',type:'through-hole',name:'Bore',axis:2,center:['30 mm','10 mm'],diameter:'6 mm',suppressed:false});
  rectangle(p.source,'union','refill',['25 mm','5 mm'],'10 mm','10 mm');
  assert.deepEqual(cadDefinition(p.source).steps.map(f=>f.id),['hole','refill']);
  await solid(p.source,(_,a)=>near(a.volume*1e9,12000));
  moveFeature(p.source,'refill',-1);
  assert.deepEqual(cadDefinition(p.source).steps.map(f=>f.id),['refill','hole']);
  await solid(p.source,(_,a)=>near(a.volume*1e9,12000-90*Math.PI));
  p.source.features[1].suppressed=true;
  assert.equal(cadDefinition(p.source).steps,undefined);
  await solid(p.source,(_,a)=>near(a.volume*1e9,12000-90*Math.PI));
});

test('sketch base and revolved downstream cutter preserve their profile frames',async()=>{
  const p=createProject(),base=p.source.features[0];
  p.source.sketches=[{...defaultSketch('base-profile'),profile:{type:'rectangle',corner:['0 mm','0 mm'],width:'60 mm',height:'20 mm'}}];
  p.source.features=[{id:base.id,bodyId:base.bodyId,name:'Extruded block',type:'extrude',sketchId:'base-profile',distance:'10 mm',materialId:base.materialId}];
  const tool=rectangle(p.source,'subtract','revolved-cut',['0 mm','0 mm'],'4 mm','10 mm');
  tool.type='revolve';delete tool.distance;tool.angle='360 deg';
  p.source.sketches[1].plane='XZ';p.source.sketches[1].origin=['30 mm','10 mm','0 mm'];
  await solid(p.source,(_,a)=>near(a.volume*1e9,12000-160*Math.PI));
});

test('imported STEP can be extended and cut without changing or re-centering its base data',async()=>{
  const p=createProject();let text;
  await solid(p.source,async(shape)=>{text=await exportSolid(shape,'step').text();});
  p.source=stepSource(p.source,text,'block.step','imported');
  rectangle(p.source,'union','boss');
  addSketchOperation(p.source,'subtract',bounds,{sketch:'bore-profile',feature:'bore'});
  await solid(p.source,(_,a)=>near(a.volume*1e9,13000-160*Math.PI));
  assert.equal(p.source.features[0].stepText,text);
  assert.equal(validateSource(p.source).thermalSupported,false);
});

test('shared sketches update all referencing features; detach and removal preserve remaining references',async()=>{
  const p=createProject();rectangle(p.source,'subtract','pocket',['10 mm','5 mm'],'10 mm','10 mm');
  p.source.features[1].distance='5 mm';rectangle(p.source,'union','refill');
  p.source.features[2].distance='2 mm';
  rebindSketch(p.source,'refill','sketch-pocket');
  assert.equal(p.source.sketches.length,1);
  await solid(p.source,(_,a)=>near(a.volume*1e9,11700));
  p.source.sketches[0].profile.width='20 mm';
  await solid(p.source,(_,a)=>near(a.volume*1e9,11400));
  detachSketch(p.source,'refill','independent');
  p.source.sketches.find(sk=>sk.id==='independent').profile.width='10 mm';
  await solid(p.source,(_,a)=>near(a.volume*1e9,11200));
  p.source.features[1].suppressed=true;removeFeature(p.source,'refill');
  assert.deepEqual(p.source.sketches.map(sk=>sk.id),['sketch-pocket']);
  removeFeature(p.source,'pocket');assert.equal(p.source.sketches,undefined);
  assert.deepEqual(validateSource(p.source).source,p.source);
});

test('suppression retains legacy geometry keys and independent name/material edits do not rebuild',()=>{
  const p=createProject(),baseKey=cadFingerprint(p.source);rectangle(p.source);
  const key=cadFingerprint(p.source);p.source.sketches[0].name='New name';p.source.features[1].name='New tool';p.source.materials[0].density='8000 kg/m^3';
  assert.equal(cadFingerprint(p.source),key);
  p.source.features[1].suppressed=true;assert.equal(cadFingerprint(p.source),baseKey);
  assert.equal(validateSource(p.source).thermalSupported,true);
  p.source.features[1].suppressed=false;assert.equal(cadFingerprint(p.source),key);
});

test('invalid references, operation types, dimensions and limits are rejected transactionally',()=>{
  const p=createProject();rectangle(p.source);const history=new ProjectHistory(p),before=fingerprint(p.source);
  for(const mutate of [
    s=>{s.features[1].operation='xor';},s=>{s.features[1].bodyId='missing';},s=>{s.features[1].sketchId='missing';},
    s=>{s.features[1].id='aluminum';},s=>{s.features[1].suppressed=0;},s=>{s.features[1].distance='0 mm';},
    s=>{s.features[1].distance='10 N';},s=>{s.sketches[0].profile.width='-1 mm';},s=>{s.sketches.push(defaultSketch('unused'));},
    s=>{for(let i=0;i<24;i++)s.features.push({...s.features[1],id:`extra-${i}`});},
  ]) {const source=structuredClone(p.source);mutate(source);assert.throws(()=>history.update(source));assert.equal(fingerprint(history.project.source),before);}
  assert.throws(()=>moveFeature(p.source,'tool',-1),/after the base/);
  assert.throws(()=>removeFeature(p.source,p.source.features[0].id),/downstream/);
  assert.throws(()=>addSketchOperation(p.source,'subtract',null),/valid CAD/);
  const max=createProject();rectangle(max.source);
  for(let i=0;i<23;i++)max.source.features.push({...max.source.features[1],id:`extra-${i}`});
  assert.equal(validateSource(max.source).operations.length,24);
  assert.throws(()=>addSketchOperation(max.source,'union',bounds),/24/);
});

test('empty, split or disconnected intermediate solids fail with the responsible feature ID',async()=>{
  for(const [operation,corner,width,height] of [
    ['union',['80 mm','0 mm'],'10 mm','10 mm'],
    ['intersect',['80 mm','0 mm'],'10 mm','10 mm'],
    ['subtract',['-1 mm','-1 mm'],'62 mm','22 mm'],
    ['subtract',['25 mm','-1 mm'],'10 mm','22 mm'],
  ]) {
    const p=createProject();rectangle(p.source,operation,'invalid-stage',corner,width,height);
    // A later union would restore the shape; history must still diagnose the failed stage.
    rectangle(p.source,'union','later-stage',['0 mm','0 mm'],'100 mm','20 mm');
    await assert.rejects(buildSolid(p.source),/Feature invalid-stage .*one closed solid/);
    p.source.features[1].suppressed=true;
    await solid(p.source,(_,a)=>near(a.volume*1e9,20000));
  }
});

test('history and project round trips retain operations and original saved thermal provenance',()=>{
  const p=createProject('history');p.results.push(makeResult(p,solveThermal(p.source),'original'));
  const original=fingerprint(p.source),history=new ProjectHistory(p);history.checkpoint('Original block');
  const source=structuredClone(p.source);rectangle(source);history.update(source);history.checkpoint('Boss');
  assert.equal(isCurrent(history.project,history.project.results[0]),false);
  assert.throws(()=>solveThermal(source),/uncut block/);
  assert.equal(fingerprint(history.project.results[0].provenance.source),original);
  const loaded=validateProject(JSON.parse(JSON.stringify(history.project)),{imported:true});
  assert.deepEqual(loaded.source,source);assert.equal(loaded.results[0].verified,false);
  history.undo();assert.equal(isCurrent(history.project,history.project.results[0]),true);
  history.redo();assert.deepEqual(history.project.source,source);
  source.features[1].suppressed=true;
  assert.deepEqual(solveThermal(source).temperatures,p.results[0].temperatures);
});

test('mixed-operation STEP round trip and binary STL preserve closed outward volume',async()=>{
  const p=createProject();rectangle(p.source);addSketchOperation(p.source,'subtract',bounds,{feature:'bore',sketch:'bore-profile'});
  await solid(p.source,async(shape,a)=>{
    const imported=await importSTEP(exportSolid(shape,'step'));
    try{near(measureVolume(imported),a.volume*1e9);}finally{imported.delete();}
    const stl=await exportSolid(shape,'stl').arrayBuffer(),view=new DataView(stl),n=view.getUint32(80,true);
    assert.equal(stl.byteLength,84+50*n);let volume=0;
    for(let i=0;i<n;i++){const [a,b,c]=Array.from({length:3},(_,j)=>Array.from({length:3},(_,k)=>view.getFloat32(84+i*50+12+j*12+k*4,true)));volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;}
    near(volume/(a.volume*1e9),1,.002);
  });
});

test('real CAD worker discards a failed history and rejects exports until corrected', {timeout:30000},async()=>{
  const url=new URL('../docs/engineering/cad-worker.mjs',import.meta.url).href;
  const worker=new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:data=>parentPort.postMessage(data)};import(${JSON.stringify(url)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`,{eval:true});
  let id=0;const send=data=>new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('message',reply=>{worker.removeListener('error',reject);resolve(reply);});worker.postMessage({id:++id,...data});});
  try {
    const source=createProject().source;rectangle(source);const key=cadFingerprint(source);
    const built=await send({action:'build',source});assert.equal(built.error,undefined);near(built.artifact.volume*1e9,13000);
    source.sketches[0].profile.corner[0]='80 mm';
    const failed=await send({action:'build',source});assert.match(failed.error,/Feature tool/);
    const stale=await send({action:'export',format:'step',fingerprint:key});assert.match(stale.error,/current|changed|match/i);
    source.features[1].suppressed=true;
    const fixed=await send({action:'build',source});assert.equal(fixed.error,undefined);near(fixed.artifact.volume*1e9,12000);
    const exported=await send({action:'export',format:'step',fingerprint:cadFingerprint(source),name:'Recovered'});assert.ok(exported.blob.size>1000);
  }finally{await worker.terminate();}
});
