import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
import {runtime} from '../docs/engineering/rust-runtime.mjs';
import {createProject,validateProject,validateSource,ProjectHistory,fingerprint} from '../docs/engineering/project.mjs';
import {faceReference,faceSupport} from '../docs/engineering/face-references.mjs';
import {cadFingerprint} from '../docs/engineering/cad-model.mjs';
import {validateStructuralRecord,STRUCTURAL_RUST_SETTINGS,structuralNodalLoads} from '../docs/engineering/structural-fem-data.mjs';
const exec=promisify(execFile),dir=await mkdtemp(path.join(os.tmpdir(),'hc-rust-structure-')),output=path.join(dir,'reference.json');
let python=process.env.ENGINEERING_PYTHON||'python3';try{await access('tools/engineering-compute/.venv/bin/python');python=path.resolve('tools/engineering-compute/.venv/bin/python');}catch{}
await exec(python,['-c',`
import json,sys,copy
sys.path.insert(0,'tools/engineering-compute')
from test_structural import StructuralTests
from structural_fem import solve_structural
from mesher import mesh_step
from test_compute import fixture
StructuralTests.setUpClass()
t=StructuralTests();base=t.request();cases=[]
def add(name,q):cases.append({'name':name,'request':q,'reference':solve_structural(q)})
add('axial',base)
q=copy.deepcopy(base);q['poissonRatio']=-.2;add('auxetic',q)
q=copy.deepcopy(base);q['boundaries'][-1]={'tag':t.surface(0,1),'type':'pressure','pressure':500000};add('pressure',q)
q=copy.deepcopy(base);q['boundaries'][-1]={'tag':t.surface(0,1),'type':'displacement','values':[1e-6,None,None]};add('prescribed',q)
q=copy.deepcopy(base);q['boundaries']=[{'tag':t.surface(0,0),'type':'fixed'}];q['gravity']=[0,0,-9.81];add('gravity',q)
q=copy.deepcopy(base);q['boundaries']=[{'tag':g['tag'],'type':'fixed'} for g in q['mesh']['boundary']];add('zero',q)
for size in [.008,.004,.002]:
    geometry=fixture();geometry['settings']['maxSize']=size;m=mesh_step(geometry);q=t.request(m);q['boundaries']=[{'tag':t.surface(0,0,m),'type':'fixed'},{'tag':t.surface(0,1,m),'type':'force','values':[0,0,-10]}];add('bending-'+str(size),q)
open(${JSON.stringify(output)},'w').write(json.dumps(cases))
`],{maxBuffer:1024*1024,env:{...process.env,OPENBLAS_NUM_THREADS:'1'}});
const cases=JSON.parse(await readFile(output,'utf8')),solve=q=>JSON.parse(runtime.solve_structural_tetra(JSON.stringify(q)));
test.after(()=>rm(dir,{recursive:true,force:true}));
const solutions=new Map();
function result(c){if(!solutions.has(c.name))solutions.set(c.name,solve(c.request));return solutions.get(c.name);}
function near(a,b,abs,rel=2e-6){assert.ok(Number.isFinite(a)&&Math.abs(a-b)<=abs+rel*Math.max(Math.abs(a),Math.abs(b)),`${a} ≉ ${b}`);}
function project(c){const q=c.request,p=createProject('rust-structure');p.source.materials[0].properties={youngModulus:q.youngModulus+' Pa',poissonRatio:String(q.poissonRatio),yieldStrength:q.yieldStrength+' Pa'};p.source.meshes.push({id:'cad-mesh',type:'gmsh-tetra',bodyId:'body-block',minSize:'1 mm',maxSize:'4 mm',curvature:20});p.source.physics.push({id:'structure',type:'linear-elasticity',bodyId:'body-block',geometryKey:cadFingerprint(p.source),support:faceSupport(p.source),gravity:q.gravity.map(v=>v+' m/s^2'),boundaries:q.boundaries.map((b,i)=>({face:faceReference(q.mesh.boundary.find(g=>g.tag===b.tag),'surface-'+i),type:b.type,...(b.type==='force'||b.type==='displacement'?{values:b.values.map(v=>v===null?null:v+(b.type==='force'?' N':' m'))}:b.type==='pressure'?{expression:b.pressure+' Pa'}:{})}))});p.source.studies.push({id:'structure-study',name:'Static',type:'static',physicsId:'structure',meshId:'cad-mesh',solverId:'hc-structural-fem-1'});return validateProject(p);}
function record(c){const p=project(c);return {id:'rust-structure-result',provenance:{projectId:p.id,revision:p.revision,source:p.source,fingerprint:fingerprint(p.source),meshId:'mesh-result',createdAt:'2026-10-15T12:00:00Z'},mesh:c.request.mesh,solution:result(c),verified:true};}

test('Rust vector FEM matches independent Python fields for nine material/load/refinement cases',()=>{
 for(const c of cases){const r=result(c);assert.deepEqual(r.solver,STRUCTURAL_RUST_SETTINGS);for(const [key,abs]of [['displacements',1e-12],['reactions',1e-6],['strains',1e-10],['stresses',.05],['principal',.05],['vonMises',.05]])r[key].forEach((v,i)=>near(v,c.reference[key][i],abs));near(r.strainEnergy,c.reference.strainEnergy,1e-12);near(r.maxStrain,c.reference.maxStrain,1e-10);near(r.maxDisplacementRatio,c.reference.maxDisplacementRatio,1e-12);validateStructuralRecord(record(c),validateSource);}
});
test('Rust cantilever refinement approaches the continuum reference and balances reactions',()=>{
 const deflections=cases.filter(c=>c.name.startsWith('bending')).map(c=>2*result(c).strainEnergy/10),reference=10*.06**3/(3*70e9*(.02*.01**3/12))+10*.06/((5/6)*(70e9/2.6)*.02*.01);
 assert.ok(deflections[0]<deflections[1]&&deflections[1]<deflections[2]&&deflections[2]<reference);assert.ok(Math.abs(deflections[2]/reference-1)<.16);for(const c of cases.filter(c=>c.name.startsWith('bending')))near(result(c).balance.reactionForce[2],10,1e-6);
});
test('native and WASM structural fields agree independently of the HTTP adapter',async()=>{
 const c=cases.find(c=>c.name==='gravity'),input=path.join(dir,'request.json'),out=path.join(dir,'result.json'),status=path.join(dir,'status.json');await writeFile(input,JSON.stringify(c.request));await exec(path.resolve('engineering-rust/target/release/engineering-server'),['--worker',input,out,status]);const native=JSON.parse(await readFile(out,'utf8'));native.displacements.forEach((v,i)=>near(v,result(c).displacements[i],1e-13));assert.equal(native.solver.library,'HammerCraft Rust');
});
test('Rust static results preserve native identity, source history and imported verification status',()=>{
 const c=cases[0],h=new ProjectHistory(project(c));h.addStructuralResult(record(c));assert.equal(h.project.structuralResults[0].solution.solver.library,'HammerCraft Rust');const restored=validateProject(JSON.parse(JSON.stringify(h.project)),{imported:true});assert.equal(restored.structuralResults[0].verified,false);assert.deepEqual(restored.structuralResults[0].solution.solver,STRUCTURAL_RUST_SETTINGS);
});
test('Rust structural solver rejects rigid motions, conflicting displacement and invalid materials',()=>{
 for(const mutate of [q=>q.boundaries=q.boundaries.slice(-1),q=>q.boundaries=q.boundaries.slice(0,1),q=>q.boundaries=[{tag:q.boundaries[0].tag,type:'fixed'},{tag:q.boundaries[1].tag,type:'displacement',values:[.001,null,null]}],q=>q.poissonRatio=.5,q=>q.youngModulus=0,q=>q.gravity=[0,Infinity,0],q=>q.boundaries[0].values=[null,null,null]]){const q=structuredClone(cases[0].request);mutate(q);assert.throws(()=>solve(q));}
});
test('nodal equilibrium validation detects altered reactions even when global force and moment remain balanced',()=>{
 const c=cases.find(c=>c.name==='bending-0.004'),r=structuredClone(record(c)),g=c.request.mesh.boundary.find(g=>g.tag===c.request.boundaries[0].tag);const ns=g.triangles.slice(0,3),p=ns.map(n=>r.mesh.nodes.slice(n*3,n*3+3));
 // Equal/opposite forces along their connecting line preserve both global totals.
 const v=p[1].map((x,a)=>1000*(x-p[0][a]));for(let a=0;a<3;a++){r.solution.reactions[ns[0]*3+a]+=v[a];r.solution.reactions[ns[1]*3+a]-=v[a];}
 assert.throws(()=>validateStructuralRecord(r,validateSource),/internal forces/);
 const loads=structuralNodalLoads(c.request);near(loads.filter((_,i)=>i%3===2).reduce((a,b)=>a+b,0),-10,1e-10);
});
