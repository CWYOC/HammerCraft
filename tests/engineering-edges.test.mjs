import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import {createProject,validateProject,validateSource,ProjectHistory,fingerprint,isCurrent} from '../docs/engineering/project.mjs';
import {buildSolid,describeSolid,exportSolid,importSTEP,measureVolume} from '../docs/engineering/cad-kernel.mjs';
import {cadFingerprint,featureInputSource} from '../docs/engineering/cad-model.mjs';
import {edgeSupport,matchingEdges,resolveEdgeSelection} from '../docs/engineering/topology.mjs';
import {moveFeature,removeFeature,addSketchOperation} from '../docs/engineering/features.mjs';
import {defaultSketch} from '../docs/engineering/sketch.mjs';
import {stepSource} from '../docs/engineering/cad-import.mjs';
import {solveThermal,makeResult} from '../docs/engineering/thermal.mjs';
import {pickVisibleEdge} from '../docs/engineering/edge-picking.mjs';
const near=(a,b,tol=1e-5)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
async function inspect(source,fn){const s=await buildSolid(source);try{const a=describeSolid(s,source);return fn?await fn(s,a):a;}finally{s.delete();}}
async function treatment(source,type='fillet',filter=e=>e.index===0,size='1 mm',id=type){
  const a=await inspect(source);
  const selected=a.edgeCatalog.filter(filter);assert.ok(selected.length);
  const feature={id,bodyId:source.features[0].bodyId,type,name:id,size,suppressed:false,
    selection:{support:edgeSupport(source),edges:selected.map((e,i)=>({id:`edge-ref-${i}`,anchor:e.anchor}))}};
  source.features.push(feature);return feature;
}
const vertical=e=>e.anchor.curve==='LINE'&&e.anchor.bounds[1][2]-e.anchor.bounds[0][2]>.99;

test('single-edge and four-edge fillets/chamfers match independent removed-volume formulae',async()=>{
  for(const [type,coefficient]of[['fillet',1-Math.PI/4],['chamfer',.5]])for(const count of [1,4]){
    const source=createProject().source;
    await treatment(source,type,count===1?e=>e.index===0:vertical,'2 mm');
    const a=await inspect(source);near(a.volume*1e9,12000-count*10*4*coefficient);
    assert.equal(a.edgeCatalogError,'');assert.ok(a.faceCount>6);assert.equal(validateSource(source).thermalSupported,false);
  }
});
test('all-edge fillet equals the rounded cuboid Minkowski-sum volume',async()=>{
  const source=createProject().source;await treatment(source,'fillet',()=>true,'2 mm');
  const [a,b,c,r]=[56,16,6,2];const volume=a*b*c+2*r*(a*b+a*c+b*c)+Math.PI*r*r*(a+b+c)+4*Math.PI*r**3/3;
  near((await inspect(source)).volume*1e9,volume,2e-4);
});
test('top-rim chamfer on a rounded rectangle matches the integrated offset-area formula',async()=>{
  const source=createProject().source;
  await treatment(source,'fillet',vertical,'3 mm');
  await treatment(source,'chamfer',e=>Math.abs(e.anchor.bounds[0][2]-1)<1e-6&&Math.abs(e.anchor.bounds[1][2]-1)<1e-6,'1 mm');
  const rounded=12000-40*9*(1-Math.PI/4),perimeter=2*(60+20-12)+6*Math.PI;
  near((await inspect(source)).volume*1e9,rounded-perimeter/2+Math.PI/3,1e-4);
});
test('geometry references survive dimension regeneration and expression-driven treatment sizes',async()=>{
  const source=createProject().source;await treatment(source,'fillet',vertical,'height / 10');
  source.parameters[0].expression='80 mm';source.parameters[2].expression='20 mm';
  near((await inspect(source)).volume*1e9,32000-4*20*4*(1-Math.PI/4));
  const selection=structuredClone(source.features[1].selection);
  source.features[1].name='Rounded corners';source.materials[0].density='8000 kg/m^3';
  assert.deepEqual(source.features[1].selection,selection);
});
test('edge catalog has real curve geometry, independent SI lengths and finite millimetre segments',async()=>{
  const source=createProject().source,a=await inspect(source);
  assert.equal(a.edgeCatalog.length,12);
  near(a.edgeCatalog.reduce((s,e)=>s+e.length,0),.36);
  assert.equal(a.edgeCatalog.filter(vertical).length,4);
  for(const e of a.edgeCatalog){assert.ok(e.lines.every(Number.isFinite));assert.equal(e.lines.length,6);assert.equal(matchingEdges(e.anchor,a.edgeCatalog).length,1);}
  source.sketches=[{...defaultSketch('circle','circle'),profile:{type:'circle',center:['0 mm','0 mm'],radius:'5 mm'}}];
  const base=source.features[0];source.features=[{id:base.id,bodyId:base.bodyId,type:'extrude',name:'Cylinder',sketchId:'circle',distance:'10 mm',materialId:base.materialId}];
  await treatment(source,'chamfer',e=>e.anchor.curve==='CIRCLE'&&e.center[2]>.009,'1 mm');
  near((await inspect(source)).volume*1e9,250*Math.PI-Math.PI*(5-1/3));
});
test('translated sketch and imported STEP edges can receive persistent edge treatments',async()=>{
  const source=createProject().source,base=source.features[0];source.sketches=[defaultSketch('profile')];
  source.sketches[0].origin=['100 mm','-20 mm','30 mm'];
  source.features=[{id:base.id,bodyId:base.bodyId,type:'extrude',name:'Translated plate',sketchId:'profile',distance:'10 mm',materialId:base.materialId}];
  await treatment(source,'chamfer',vertical,'1 mm');
  const a=await inspect(source);near(a.volume*1e9,10000-20);
  source.sketches[0].origin=['110 mm','-10 mm','50 mm'];
  near((await inspect(source)).volume,a.volume,1e-10);
  const text=await inspect(source,async s=>await exportSolid(s,'step').text());
  const imported=stepSource(source,text,'beveled.step','imported');
  await treatment(imported,'chamfer',e=>e.anchor.curve==='LINE'&&e.length>.03,'0.2 mm');
  const result=await inspect(imported);assert.ok(result.volume<a.volume);assert.equal(imported.features[0].stepText,text);
});
test('input history excludes the selected feature and later failures, pruning only unused sketches',async()=>{
  const source=createProject().source;await treatment(source,'fillet',vertical,'1 mm');
  addSketchOperation(source,'union',[[0,0,0],[.06,.02,.01]],{sketch:'boss-profile',feature:'boss'});
  source.sketches[0].profile.corner[0]='100 mm';
  await assert.rejects(buildSolid(source),/Feature Union 2/);
  const before=featureInputSource(source,'fillet');assert.equal(before.features.length,1);assert.equal(before.sketches,undefined);
  near((await inspect(before)).volume*1e9,12000);
  const beforeBoss=featureInputSource(source,'boss');assert.equal(beforeBoss.features.length,2);assert.equal(beforeBoss.sketches,undefined);
  near((await inspect(beforeBoss)).volume*1e9,12000-40*(1-Math.PI/4));
});
test('mixed treatments execute in order and topology changes require explicit repair',async()=>{
  const source=createProject().source;await treatment(source,'fillet',vertical,'1 mm');
  await treatment(source,'chamfer',e=>e.anchor.curve==='LINE'&&e.center[2]>.009&&e.length>.05,'.2 mm');
  const complete=await inspect(source);assert.ok(complete.volume<.000012);
  moveFeature(source,'chamfer',-1);
  await assert.rejects(buildSolid(source),/upstream feature order changed/);
  source.features[1].suppressed=true;
  const restored=await inspect(source);near(restored.volume*1e9,12000-40*(1-Math.PI/4));
  removeFeature(source,'chamfer');assert.equal(source.features.length,2);
});
test('missing, ambiguous and duplicate geometric matches fail without nearest-edge guesses',async()=>{
  const source=createProject().source;const feature=await treatment(source);
  const input=featureInputSource(source,feature.id),a=await inspect(input);
  const duplicate=[...a.edgeCatalog,{...a.edgeCatalog[0],index:99}];
  assert.throws(()=>resolveEdgeSelection(feature.selection,edgeSupport(input),duplicate),/ambiguous/);
  feature.selection.edges[0].anchor.midpoint[0]=.3;
  await assert.rejects(buildSolid(source),/missing.*Reselect/);
  feature.suppressed=true;near((await inspect(source)).volume*1e9,12000);
});
test('oversized edge treatments fail at the responsible feature and suppression restores geometry',async()=>{
  for(const type of ['fillet','chamfer']){
    const source=createProject().source;const feature=await treatment(source,type,vertical,'100 mm');
    await assert.rejects(buildSolid(source),new RegExp(`Feature ${type}.*failed`));
    feature.suppressed=true;near((await inspect(source)).volume*1e9,12000);
  }
});
test('invalid edge source is rejected transactionally and suppressed references are retained',async()=>{
  const source=createProject().source;await treatment(source);const h=new ProjectHistory({...createProject(),source}),key=fingerprint(source);
  for(const mutate of [s=>s.features[1].size='2 N',s=>s.features[1].size='0 mm',s=>s.features[1].selection.edges=[],s=>s.features[1].bodyId='foreign',
    s=>s.features[1].suppressed=1,s=>s.features[1].selection.support=[],s=>s.features[1].selection.edges.push(structuredClone(s.features[1].selection.edges[0])),
    s=>s.features[1].selection.edges[0].anchor.midpoint[0]=NaN,s=>s.features[1].selection.edges[0].anchor.curve='fabricated',
    s=>{s.features[1].selection.edges=Array.from({length:65},(_,i)=>({...s.features[1].selection.edges[0],id:`r${i}`}));},
  ]){const s=structuredClone(source);mutate(s);assert.throws(()=>h.update(s));assert.equal(fingerprint(h.project.source),key);}
  source.features[1].suppressed=true;assert.deepEqual(validateSource(source).source.features[1].selection,source.features[1].selection);
  assert.equal(cadFingerprint(source),cadFingerprint(createProject().source));
});
test('history, project exchange and original thermal provenance retain edge feature inputs',async()=>{
  const p=createProject();p.results.push(makeResult(p,solveThermal(p.source),'original'));const original=fingerprint(p.source),h=new ProjectHistory(p);
  const source=structuredClone(p.source);await treatment(source);h.update(source);h.checkpoint('Rounded');
  assert.equal(isCurrent(h.project,h.project.results[0]),false);assert.equal(fingerprint(h.project.results[0].provenance.source),original);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(h.project))).source,source);
  assert.throws(()=>solveThermal(source),/uncut block/);h.undo();assert.equal(isCurrent(h.project,h.project.results[0]),true);h.redo();
  source.features[1].suppressed=true;assert.deepEqual(solveThermal(source).temperatures,p.results[0].temperatures);
});
test('filleted STEP and binary STL retain the true solid volume',async()=>{
  const source=createProject().source;await treatment(source,'fillet',()=>true,'2 mm');
  await inspect(source,async(shape,a)=>{
    const reimport=await importSTEP(exportSolid(shape,'step'));try{near(measureVolume(reimport),a.volume*1e9,1e-4);}finally{reimport.delete();}
    const buffer=await exportSolid(shape,'stl').arrayBuffer(),v=new DataView(buffer),count=v.getUint32(80,true);let volume=0;
    for(let i=0;i<count;i++){const[a,b,c]=[0,1,2].map(j=>[0,1,2].map(k=>v.getFloat32(84+i*50+12+j*12+k*4,true)));volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;}
    near(volume/(a.volume*1e9),1,.003);
  });
});
test('screen edge picking rejects occluded edges and uses a bounded hit distance',()=>{
  const matrix=[1,0,0,0,1,0,0,0,1],scale=[1,1,-.2];
  const vertices=[-1,-1,.5,1,-1,.5,0,1,.5],triangles=[0,1,2];
  const edges=[{index:1,lines:[-.5,0,0,.5,0,0]},{index:2,lines:[-.5,0,.5,.5,0,.5]}];
  assert.equal(pickVisibleEdge(edges,vertices,triangles,matrix,scale,100,100,[50,50]),2);
  assert.equal(pickVisibleEdge([edges[0]],vertices,triangles,matrix,scale,100,100,[50,50]),null);
  assert.equal(pickVisibleEdge(edges,vertices,triangles,matrix,scale,100,100,[50,80]),null);
  assert.equal(pickVisibleEdge([edges[0]],[],[],matrix,scale,100,100,[50,50]),1);
});
test('real CAD worker recovers from failed treatment and rejects stale export', {timeout:30000},async()=>{
  const source=createProject().source;await treatment(source);
  const url=new URL('../docs/engineering/cad-worker.mjs',import.meta.url).href;
  const worker=new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:d=>parentPort.postMessage(d)};import(${JSON.stringify(url)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`,{eval:true});
  let id=0;const send=data=>new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('message',r=>{worker.removeListener('error',reject);resolve(r);});worker.postMessage({id:++id,...data});});
  try{
    const good=await send({action:'build',source});assert.equal(good.error,undefined);assert.ok(good.artifact.edgeCatalog.length>12);
    const key=cadFingerprint(source);source.features[1].size='100 mm';
    assert.match((await send({action:'build',source})).error,/Feature fillet/);
    assert.match((await send({action:'export',format:'step',fingerprint:key})).error,/current solid/);
    source.features[1].suppressed=true;const fixed=await send({action:'build',source});assert.equal(fixed.error,undefined);near(fixed.artifact.volume*1e9,12000);
    assert.ok((await send({action:'export',format:'step',fingerprint:cadFingerprint(source)})).blob.size>1000);
  }finally{await worker.terminate();}
});
