import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,validateSource,validateProject,ProjectHistory} from '../docs/engineering/project.mjs';
import {cadFingerprint,pruneSketches} from '../docs/engineering/cad-model.mjs';
import {appendSTEP,addTransform,usesNativeCAD} from '../docs/engineering/part-features.mjs';
import {stepSource} from '../docs/engineering/cad-import.mjs';
import {buildSolid,describeSolid,exportSolid,loadKernel} from '../docs/engineering/cad-kernel.mjs';
import * as cad from '../docs/engineering/vendor/replicad.mjs';
await loadKernel();
const box=cad.makeBox([0,0,0],[10,10,10]);const step=await cad.exportSTEP([{shape:box}]).text();box.delete();
function source(){const s=createProject().source;s.features[0].dimensions=['10 mm','10 mm','10 mm'];return s;}
async function artifact(source,fn){const shape=await buildSolid(source);try{return await fn(describeSolid(shape,source),shape);}finally{shape.delete();}}
const near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);

test('STEP parts retain placement, references and suppression through undo, project export and named versions',()=>{
 const p=createProject(),h=new ProjectHistory(p),s=source();appendSTEP(s,step,'second.step','second');s.features[1].placement.translation=['length','0 mm','0 mm'];h.update(s);h.checkpoint('Assembly');const key=cadFingerprint(h.project.source);h.undo();assert.equal(h.project.source.features.length,1);h.redo();assert.equal(cadFingerprint(h.project.source),key);
 const copy=validateProject(JSON.parse(JSON.stringify(h.project)),{imported:true});assert.equal(copy.source.features[1].placement.translation[0],'length');assert.equal(copy.versions[0].source.features[1].fileName,'second.step');copy.source.features[1].suppressed=true;assert.notEqual(cadFingerprint(copy.source),key);
 for(const change of [f=>f.placement.translation[0]='3 V',f=>f.placement.rotation[2]='2 mm',f=>f.operation='invalid',f=>f.bodyId='missing',f=>f.stepAsset={sha256:'0'.repeat(64),bytes:4}]){const invalid=structuredClone(s);change(invalid.features[1]);assert.throws(()=>validateSource(invalid));}
});
test('independent STEP parts, per-part rotation and translation preserve separate solid volumes',async()=>{
 const s=source();appendSTEP(s,step,'part.step','part');s.features[1].placement={translation:['30 mm','0 mm','0 mm'],rotation:['0 deg','0 deg','90 deg']};
 await artifact(s,async(a,shape)=>{assert.equal(a.solidCount,2);near(a.volume*1e9,2000);near(a.bounds[1][0],.03,1e-6);const roundtrip=stepSource(s,await exportSolid(shape,'step').text(),'assembly.step');await artifact(roundtrip,b=>{assert.equal(b.solidCount,2);near(b.volume,a.volume,1e-12);});});
});
test('STEP Boolean tools union, subtract and intersect overlapping solids with expected volumes',async()=>{
 for(const [operation,volume] of [['union',1500],['subtract',500],['intersect',500]]){
  const s=source();appendSTEP(s,step,'tool.step','tool');s.features[1].operation=operation;s.features[1].placement.translation[0]='5 mm';await artifact(s,a=>{assert.equal(a.solidCount,1);near(a.volume*1e9,volume);});
 }
 const s=source();appendSTEP(s,step,'tool.step','tool');s.features[1].operation='intersect';s.features[1].placement.translation[0]='30 mm';await assert.rejects(buildSolid(s),/positive volume|closed solid/);
});
test('whole-model placement and linear patterns preserve shape and cap expanded body counts',async()=>{
 const s=source();addTransform(s,'transform',null,'move');s.features[1].placement.rotation[2]='90 deg';s.features[1].placement.translation[0]='20 mm';addTransform(s,'linear-pattern',[[0,0,0],[.01,.01,.01]],'repeat');s.features[2].count=3;s.features[2].spacing=['20 mm','0 mm','0 mm'];
 await artifact(s,a=>{assert.equal(a.solidCount,3);near(a.volume*1e9,3000);near(a.bounds[0][0],.01,1e-6);near(a.bounds[1][0],.06,1e-6);});
 s.features[2].count=20;addTransform(s,'linear-pattern',[[0,0,0],[.1,.01,.01]],'repeat-again');s.features[3].count=4;await assert.rejects(buildSolid(s),/64 solid/);
 s.features[2].spacing=['0 mm','0 mm','0 mm'];assert.throws(()=>validateSource(s),/spacing/);
});
test('stored STEP detection ignores suppressed parts and validates portable references',()=>{
 const s=source();appendSTEP(s,{sha256:'a'.repeat(64),bytes:1500000000},'large.step','large');assert.equal(usesNativeCAD(s),true);const normalized=validateSource(s).source;assert.equal(normalized.features[1].stepAsset.bytes,1500000000);s.features[1].suppressed=true;assert.equal(usesNativeCAD(s),false);
});
