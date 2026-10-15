import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createProject, validateProject, validateSource, ProjectHistory, fingerprint, isCurrent } from '../docs/engineering/project.mjs';
import { resolveSketch, defaultSketch } from '../docs/engineering/sketch.mjs';
import { cadDefinition, cadFingerprint } from '../docs/engineering/cad-model.mjs';
import { buildSolid, describeSolid, exportSolid, importSTEP, measureVolume } from '../docs/engineering/cad-kernel.mjs';
import { stepSource } from '../docs/engineering/cad-import.mjs';
import { solveThermal, meshInfo, makeResult } from '../docs/engineering/thermal.mjs';
const near = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
function example(type = 'rectangle', operation = 'extrude', plane = 'XY') {
  const p = createProject('sketch-test');
  p.source.sketches = [{ ...defaultSketch('profile-1', type), plane }];
  p.source.features = [{ id: 'solid-1', bodyId: 'body-block', type: operation, name: 'Sketch solid', sketchId: 'profile-1', materialId: 'aluminum', ...(operation === 'extrude' ? { distance: '10 mm' } : { angle: '360 deg' }) }];
  return p;
}
async function solid(p, fn) { const shape = await buildSolid(p.source); try { await fn(shape, describeSolid(shape, p.source)); } finally { shape.delete(); } }

test('sketch source preserves stable references and expressions without changing legacy fingerprints', () => {
  const legacy = createProject('legacy');
  assert.equal(fingerprint(legacy.source), JSON.stringify(legacy.source));
  const p = example();
  p.source.sketches[0].profile.width = 'length';
  p.source.features[0].distance = 'height/2';
  const normalized = validateProject(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(normalized.source, p.source);
  const definition = cadDefinition(normalized.source);
  near(definition.sketch.profile.points[1][0], 60);
  near(definition.sketch.operation.distance, 5);
  const before = cadFingerprint(p.source);
  p.source.sketches[0].name = 'Renamed'; p.source.features[0].name = 'Renamed extrusion'; p.source.materials[0].density = '5000 kg/m^3';
  assert.equal(cadFingerprint(p.source), before);
  p.source.parameters[0].expression = '120 mm';
  assert.notEqual(cadFingerprint(p.source), before);
});

test('invalid profile, references, units and operation edits reject transactionally', () => {
  const history = new ProjectHistory(example()), before = fingerprint(history.project.source);
  for (const mutate of [
    s => { s.sketches[0].plane = 'bogus'; }, s => { s.sketches[0].origin = ['0 mm']; },
    s => { s.sketches[0].origin[0] = '11 km'; }, s => { s.sketches[0].profile.width = '5 V'; },
    s => { s.sketches[0].profile.width = '-1 mm'; }, s => { s.sketches[0].profile.height = '0 mm'; },
    s => { s.sketches[0].profile = { type: 'spline' }; }, s => { s.features[0].sketchId = 'missing'; },
    s => { s.sketches[0].id = 'aluminum'; s.features[0].sketchId = 'aluminum'; },
    s => { s.features[0].distance = '0 mm'; }, s => { s.features[0].distance = '5 kg'; },
    s => { s.features[0].type = 'revolve'; s.features[0].angle = '361 deg'; },
    s => { s.features[0].type = 'revolve'; s.features[0].angle = '0 deg'; },
    s => { s.features[0].type = 'revolve'; s.features[0].angle = '3 mm'; },
    s => { s.sketches.push(defaultSketch('extra')); }, s => { delete s.sketches; },
  ]) {
    const source = structuredClone(history.project.source); mutate(source);
    assert.throws(() => history.update(source)); assert.equal(fingerprint(history.project.source), before);
  }
  const legacy = createProject(); legacy.source.sketches = [defaultSketch()];
  assert.throws(() => validateSource(legacy.source), /referenced/);
});

test('polygons reject crossings, repeated points, touching edges, degeneracy and size limits', () => {
  const p = example('polygon'), sk = p.source.sketches[0];
  const make = points => points.map((point, i) => ({ id: `point-${i}`, position: point.map(v => `${v} mm`) }));
  for (const points of [
    [[0,0],[40,30],[40,0],[0,30]], [[0,0],[10,0],[10,0],[0,10]],
    [[0,0],[10,0],[20,0]], [[0,0],[40,0],[20,0],[20,20]],
    [[0,0],[20,0],[20,20],[10,0],[0,20]], [[0,0],[10,0]],
    [[0,0],[10,0],[0,10],[0,0]],
  ]) { sk.profile.points = make(points); assert.throws(() => validateSource(p.source)); }
  sk.profile.points = make(Array.from({ length: 65 }, (_, i) => [20 * Math.cos(i / 65 * 2 * Math.PI), 20 * Math.sin(i / 65 * 2 * Math.PI)]));
  assert.throws(() => validateSource(p.source), /3–64/);
  sk.profile = defaultSketch('x', 'polygon').profile; sk.profile.points[1].id = sk.profile.points[0].id;
  assert.throws(() => validateSource(p.source), /unique/);
});

test('all four profile extrusions have independently known CAD volumes on all three planes', async () => {
  const areas = { rectangle: 1000, circle: 100 * Math.PI, ellipse: 96 * Math.PI, polygon: 700 };
  for (const [type, area] of Object.entries(areas)) for (const plane of ['XY','XZ','YZ']) {
    const p = example(type, 'extrude', plane);
    await solid(p, (shape, artifact) => {
      near(artifact.volume * 1e9, area * 10);
      assert.ok(artifact.mesh.vertices.every(Number.isFinite));
      assert.ok(artifact.triangleCount > 0);
      const model = validateSource(p.source); near(model.sketch.area * 1e6, area);
      near(artifact.volume * model.material.rho * 1000, area * 10 * 2700 / 1e6);
    });
  }
});

test('extrusion plane orientation, translated origins and negative distances preserve global bounds', async () => {
  for (const plane of ['XY', 'XZ', 'YZ']) for (const sign of [1, -1]) {
    const p = example('rectangle', 'extrude', plane), sk = p.source.sketches[0];
    sk.origin = ['100 mm','-50 mm','20 mm']; p.source.features[0].distance = `${sign * 10} mm`;
    const model = validateSource(p.source), corners = [];
    for (const uv of [[0,0],[40,0],[40,25],[0,25]]) for (const d of [0,sign*10])
      corners.push([100,-50,20].map((o,i) => o + model.sketch.u[i]*uv[0] + model.sketch.v[i]*uv[1] + model.sketch.normal[i]*d));
    await solid(p, (_, artifact) => {
      for (let axis=0;axis<3;axis++) {
        near(artifact.bounds[0][axis]*1000,Math.min(...corners.map(p=>p[axis])));
        near(artifact.bounds[1][axis]*1000,Math.max(...corners.map(p=>p[axis])));
      }
    });
  }
});

test('full and partial revolutions match independent cylinders and torus volumes on all planes', async () => {
  for (const plane of ['XY','XZ','YZ']) for (const angle of [90,270,360]) {
    for (const type of ['rectangle','circle','ellipse']) {
      const p=example(type,'revolve',plane);p.source.features[0].angle=`${angle} deg`;
      const expected=(type==='rectangle' ? Math.PI*40**2*25 : 2*Math.PI*20*Math.PI*(type==='circle' ? 100 : 96))*angle/360;
      await solid(p, (_,a)=>near(a.volume*1e9,expected,1e-4));
    }
  }
});

test('concave revolved profiles use their area first moment, including clockwise input', async () => {
  // L profile is a 40x10 rectangle plus a 15x20 rectangle above it.
  const firstMoment = 400*20 + 300*7.5;
  for(const reverse of [false,true]) {
    const p=example('polygon','revolve','XZ');if(reverse)p.source.sketches[0].profile.points.reverse();
    await solid(p,(_,a)=>near(a.volume*1e9,2*Math.PI*firstMoment));
    const sk=validateSource(p.source).sketch;near(sk.area*sk.centroid[0]*1e9,firstMoment);
  }
});

test('ellipse with larger V radius is oriented correctly and preserves both dimensions',async()=>{
  const p=example('ellipse');p.source.sketches[0].profile.radiusU='6 mm';p.source.sketches[0].profile.radiusV='15 mm';
  await solid(p,(_,a)=>{near(a.volume*1e9,900*Math.PI);near((a.bounds[1][0]-a.bounds[0][0])*1000,12);near((a.bounds[1][1]-a.bounds[0][1])*1000,30);});
});

test('revolution rejects axis crossings and pinched curved solids without inventing geometry',()=>{
  for(const type of ['rectangle','circle','ellipse','polygon']) {
    const p=example(type,'revolve');
    if(type==='rectangle')p.source.sketches[0].profile.corner[0]='-1 mm';
    else if(type==='polygon')p.source.sketches[0].profile.points[0].position[0]='-1 mm';
    else p.source.sketches[0].profile.center[0]='0 mm';
    assert.throws(()=>validateSource(p.source),/positive U/);
  }
  const p=example('circle','revolve');p.source.sketches[0].profile.center[0]='10 mm';
  assert.throws(()=>validateSource(p.source),/pinched/);
});

test('parameter regeneration changes both sketch and downstream solid volume',async()=>{
  const p=example();p.source.sketches[0].profile.width='length';p.source.sketches[0].profile.height='width';p.source.features[0].distance='height';
  await solid(p,(_,a)=>near(a.volume*1e9,12000));p.source.parameters[0].expression='90 mm';
  await solid(p,(_,a)=>near(a.volume*1e9,18000));
});

test('history, named versions, duplicate and project round trips preserve sketches and old thermal results',()=>{
  const p=createProject('history');p.results.push(makeResult(p,solveThermal(p.source),'result-before-sketch'));
  const history=new ProjectHistory(p), original=fingerprint(p.source);history.checkpoint('Thermal baseline');
  const next=example('polygon').source;history.update(next);history.checkpoint('Bracket');
  assert.equal(isCurrent(history.project,history.project.results[0]),false);
  assert.equal(fingerprint(history.project.results[0].provenance.source),original);
  assert.throws(()=>solveThermal(next),/uncut block/);assert.throws(()=>meshInfo(next),/uncut block/);
  const restored=validateProject(JSON.parse(JSON.stringify(history.project)),{imported:true});
  assert.deepEqual(restored.source.sketches,next.sketches);assert.equal(restored.results[0].verified,false);
  const duplicate=validateProject({...structuredClone(history.project),id:'duplicate',revision:0,results:[],versions:[]});assert.deepEqual(duplicate.source.sketches,next.sketches);assert.equal(duplicate.results.length,0);
  history.undo();assert.equal(isCurrent(history.project,history.project.results[0]),true);history.redo();assert.deepEqual(history.project.source.sketches,next.sketches);
});

test('STEP and binary STL exports preserve a curved sketch solid and replace sketch references on import',async()=>{
  const p=example('circle','revolve','XZ');p.source.features[0].angle='270 deg';
  await solid(p,async(shape,artifact)=>{
    const blob=exportSolid(shape,'step'),again=await importSTEP(blob);
    try {near(measureVolume(again),artifact.volume*1e9,1e-4);}finally{again.delete();}
    const imported=stepSource(p.source,await blob.text(),'revolved.step','imported-solid');assert.equal(imported.sketches,undefined);
    await solid({source:imported},(_,a)=>near(a.volume,artifact.volume,1e-12));
    const stl=await exportSolid(shape,'stl').arrayBuffer(),view=new DataView(stl),n=view.getUint32(80,true);
    assert.equal(stl.byteLength,84+50*n);let volume=0;
    for(let i=0;i<n;i++){const v=Array.from({length:3},(_,j)=>Array.from({length:3},(_,k)=>view.getFloat32(84+i*50+12+j*12+k*4,true)));const[a,b,c]=v;volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;}
    assert.ok(volume>0);near(volume/(artifact.volume*1e9),1,.01);
  });
});

test('real CAD worker regenerates sketch solids and rejects stale exports', {timeout:30000},async()=>{
  const url=new URL('../docs/engineering/cad-worker.mjs',import.meta.url).href;
  const worker=new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:data=>parentPort.postMessage(data)};import(${JSON.stringify(url)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`,{eval:true});
  let id=0;const send=data=>new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('message',reply=>{worker.removeListener('error',reject);resolve(reply);});worker.postMessage({id:++id,...data});});
  try {const source=example('polygon').source;const built=await send({action:'build',source});assert.equal(built.error,undefined);near(built.artifact.volume*1e9,7000);
    const mismatch=await send({action:'export',format:'step',fingerprint:'stale'});assert.match(mismatch.error,/changed|current|match/i);
    const exported=await send({action:'export',format:'step',fingerprint:cadFingerprint(source),name:'Bracket'});assert.ok(exported.blob.size>1000);
  }finally{await worker.terminate();}
});
