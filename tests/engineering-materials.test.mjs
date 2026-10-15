import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {dimensions as d, quantity, parameters} from '../docs/engineering/units.mjs';
import {MATERIAL_PROPERTIES, resolveProperty, sampleProperty, resolveMaterial, materialSnapshot, importMaterialSnapshot} from '../docs/engineering/materials.mjs';
import {createProject, validateSource, validateProject, fingerprint, isCurrent, ProjectHistory, requireThermalSource, thermalSourceIssue} from '../docs/engineering/project.mjs';
import {cadFingerprint} from '../docs/engineering/cad-model.mjs';
import {solveThermal, makeResult, meshInfo, summarize} from '../docs/engineering/thermal.mjs';
import {createSweep,runSweep} from '../docs/engineering/sweep.mjs';
import {sweepCSV} from '../docs/engineering/sweep-data.mjs';
import {createConvergence} from '../docs/engineering/convergence.mjs';
const near=(a,b,t=1e-9)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);
const example=()=>createProject('materials-project');
const base=()=>example().source.materials[0];
const table=(axis,points,outside='error')=>({type:'table',axis,outside,points:points.map(([x,y])=>({x,y}))});
const density=()=>table('temperature',[['20 degC','2700 kg/m^3'],['120 degC','2600 kg/m^3']]);
const conductivity=()=>table('temperature',[['20 degC','167 W/(m*K)'],['120 degC','150 W/(m*K)']]);

test('legacy material normalization and saved source fingerprints stay byte-identical',()=>{
  const p=example(),before=JSON.stringify(p.source);
  assert.equal(JSON.stringify(validateSource(p.source).source),before);
  assert.deepEqual(Object.keys(base()),['id','name','conductivity','density']);
  const result=makeResult(p,solveThermal(p.source),'legacy');p.results.push(result);
  assert.equal(fingerprint(p.source),before);
  assert.ok(isCurrent(validateProject(JSON.parse(JSON.stringify(p))),result));
  near(summarize(result).mass,.0324);near(summarize(result).heatOut[1],33.4,1e-6);
});

test('new units have independent SI dimensions and preserve former parameter names',()=>{
  const examples=[['1 MS/m',d.electricalConductivity,1e6],['1/(1 S/m)',d.resistivity,1],['1 pF/m',d.permittivity,1e-12],['1 H/m',d.permeability,1],['1 mT',d.fluxDensity,.001],['1 Wb/m^2',d.fluxDensity,1],['1 MHz',d.frequency,1e6],['1 bar',d.pressure,1e5],['1 psi',d.pressure,6894.757293168],['3 percent',d.scalar,.03],['2 Np/m',d.attenuation,2]];
  for(const [expr,dim,value]of examples)near(quantity(expr,dim),value,1e-10);
  const values=parameters([{name:'T',expression:'80 degC'},{name:'S',expression:'2 mm'},{name:'bar',expression:'S * 2'}]);
  near(quantity('T',d.temperature,values),353.15);near(quantity('bar',d.length,values),.004);
  assert.throws(()=>quantity('1 T',d.temperature));
  assert.throws(()=>parameters([{name:'mm',expression:'2'}]),/unit names/);
});

test('all supported constant properties resolve without inventing missing data',()=>{
  const properties={youngModulus:'70 GPa',poissonRatio:'0.33',yieldStrength:'250 MPa',ultimateStrength:'300 MPa',dampingRatio:'1 percent',specificHeat:'900 J/(kg*K)',thermalExpansion:'23e-6 / K',electricalConductivity:'35 MS/m',resistivity:'3e-8 ohm*m',permittivity:'8.85 pF/m',permeability:'1.25e-6 H/m',coercivity:'20 A/m',remanence:'0.1 T',soundSpeed:'5000 m/s',dynamicViscosity:'0.001 Pa*s',acousticAttenuation:'0.2 Np/m'};
  const m=resolveMaterial({...base(),properties});assert.equal(Object.keys(m.properties).length,18);
  near(m.properties.youngModulus.value,70e9);near(m.properties.poissonRatio.value,.33);
  assert.equal(resolveMaterial(base()).properties.specificHeat,undefined);
  assert.equal(Object.keys(MATERIAL_PROPERTIES).length,19);
  for(const [key,expression]of [['youngModulus','0 Pa'],['poissonRatio','0.5'],['poissonRatio','-1'],['specificHeat','0 J/(kg*K)'],['density','-1 kg/m^3'],['permittivity','0 F/m'],['conductivity','2 Pa'],['soundSpeed','4e8 m/s'],['acousticAttenuation','-1 /m']]) assert.throws(()=>resolveProperty(key,expression));
});

test('nonuniform tables interpolate actual SI values at knots and between knots',()=>{
  const p=resolveProperty('youngModulus',table('temperature',[['20 degC','70 GPa'],['60 degC','62 GPa'],['120 degC','50 GPa']]));
  near(sampleProperty(p,293.15).value,70e9);near(sampleProperty(p,313.15).value,66e9);
  near(sampleProperty(p,333.15).value,62e9);near(sampleProperty(p,363.15).value,56e9);near(sampleProperty(p,393.15).value,50e9);
  assert.throws(()=>sampleProperty(p,290),/extrapolation/);
  const clamped=resolveProperty('youngModulus',{...p.source,outside:'clamp'});
  assert.deepEqual(sampleProperty(clamped,200),{value:70e9,clamped:true});assert.deepEqual(sampleProperty(clamped,500),{value:50e9,clamped:true});
  assert.throws(()=>sampleProperty(clamped,-1));assert.throws(()=>sampleProperty(p,NaN));
});

test('frequency, pressure and strain curves accept compatible units and parameter expressions',()=>{
  const values=parameters([{name:'stiffness',expression:'70 GPa'},{name:'startFrequency',expression:'1 kHz'}]);
  for(const [axis,points,at]of [['frequency',[['startFrequency','stiffness'],['3 kHz','stiffness/2']],2000],['pressure',[['1 bar','stiffness'],['3 bar','stiffness/2']],2e5],['strain',[['0','stiffness'],['2 percent','stiffness/2']],.01]]){
    const p=resolveProperty('youngModulus',table(axis,points),values);near(sampleProperty(p,at).value,52.5e9);
  }
});

test('table validation rejects ambiguous, oversized, dimensionally wrong and invalid data',()=>{
  const valid=density();
  for(const change of [{axis:'unknown'},{axis:'magneticField'},{outside:'linear'},{points:valid.points.slice(0,1)},{points:Array(129).fill(valid.points[0])},{points:[valid.points[1],valid.points[0]]},{points:[valid.points[0],valid.points[0]]},{points:[valid.points[0],{x:'300 K',y:'3 mm'}]},{points:[{x:'-1 K',y:'2 kg/m^3'},valid.points[1]]},{points:[null,valid.points[1]]}])assert.throws(()=>resolveProperty('density',{...valid,...change}));
  assert.throws(()=>resolveProperty('unknown','1'));
  assert.throws(()=>resolveMaterial({...base(),properties:{density:'1 kg/m^3'}}));
  assert.throws(()=>resolveMaterial({...base(),properties:{hiddenProperty:'1'}}));
  assert.throws(()=>resolveMaterial({...base(),reference:{invalidAxis:'1'}}));
  assert.throws(()=>resolveMaterial({...base(),notes:'x'.repeat(4097)}));
});

test('B-H relation supports signed single-valued curves and rejects hysteresis and constants',()=>{
  const p=resolveProperty('bhCurve',table('magneticField',[['-1000 A/m','-1 T'],['0 A/m','0 T'],['1000 A/m','1 T']]));
  near(sampleProperty(p,-500).value,-.5);near(sampleProperty(p,250).value,.25);
  assert.throws(()=>resolveProperty('bhCurve','1 T'),/requires a table/);
  assert.throws(()=>resolveProperty('bhCurve',table('magneticField',[['0 A/m','1 T'],['100 A/m','0 T']])),/Hysteresis/);
});

test('variable density requires explicit reference conditions and produces reference mass',()=>{
  const p=example(),m=p.source.materials[0];m.density=density();
  assert.throws(()=>validateSource(p.source),/explicit material reference/);
  m.reference={temperature:'70 degC'};
  const model=validateSource(p.source);near(model.material.rho,2650);near(summarize(makeResult(p,solveThermal(p.source),'rho')).mass,.0318);
  assert.deepEqual(model.material.densityAt,{axis:'temperature',coordinate:343.15,clamped:false});
  const geometry=cadFingerprint(p.source),before=fingerprint(p.source);m.reference.temperature='120 degC';
  assert.equal(cadFingerprint(p.source),geometry);assert.notEqual(fingerprint(p.source),before);near(validateSource(p.source).material.rho,2600);
  m.reference.temperature='200 degC';assert.throws(()=>validateSource(p.source),/extrapolation/);
  m.density.outside='clamp';assert.ok(validateSource(p.source).material.densityAt.clamped);
});

test('thermal conductivity curves remain editable data but every thermal entry point rejects them',()=>{
  const p=example();p.source.materials[0].conductivity=conductivity();
  const model=validateSource(p.source);assert.equal(model.material.k,null);assert.equal(model.thermalSupported,true);assert.match(thermalSourceIssue(model),/constant, isotropic/);
  for(const action of [()=>requireThermalSource(p.source),()=>solveThermal(p.source),()=>meshInfo(p.source),()=>createSweep(p,{},'curve'),()=>createConvergence(p,{},'curve')])assert.throws(action,/constant, isotropic/);
  p.source.features[0].materialId=p.source.materials[1].id;assert.equal(thermalSourceIssue(validateSource(p.source)),'');assert.ok(solveThermal(p.source));
});

test('optional material curves never change constant-conductivity temperature fields',()=>{
  const p=example(),expected=solveThermal(p.source);
  p.source.materials[0].properties={youngModulus:table('temperature',[['20 degC','70 GPa'],['120 degC','60 GPa']]),specificHeat:'900 J/(kg*K)'};
  assert.deepEqual(solveThermal(p.source),expected);
});

test('real module worker reports unsupported conductivity without returning a field',async()=>{
  const url=new URL('../docs/engineering/worker.mjs',import.meta.url).href;
  const worker=new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:data=>parentPort.postMessage(data)};import(${JSON.stringify(url)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`,{eval:true});
  try{
    for(const action of ['solve','mesh','sweep','convergence']){
      const p=example();p.source.materials[0].conductivity=conductivity();
      const events=await new Promise((resolve,reject)=>{const all=[];const listener=e=>{all.push(e);if(['Failed','Completed'].includes(e.state)){worker.off('message',listener);resolve(all);}};worker.once('error',reject);worker.on('message',listener);worker.postMessage({id:action,action,project:p});});
      assert.equal(events.at(-1).state,'Failed');assert.match(events.at(-1).error,/constant, isotropic/);assert.ok(events.every(e=>!e.result));
    }
  }finally{await worker.terminate();}
});

test('history and project serialization preserve definitions, provenance and source notes',()=>{
  const p=example(),history=new ProjectHistory(p),result=makeResult(p,solveThermal(p.source),'baseline');history.addResult(result);
  const next=structuredClone(p.source);Object.assign(next.materials[0],{density:density(),reference:{temperature:'70 degC'},grade:'Illustrative data',referenceSource:'User-provided test data',notes:'Demonstration only'});
  history.update(next);history.checkpoint('Material curve');assert.ok(!isCurrent(history.project,result));
  const saved=validateProject(JSON.parse(JSON.stringify(history.project)));assert.deepEqual(saved.source.materials[0],next.materials[0]);assert.deepEqual(saved.versions[0].source.materials[0],next.materials[0]);
  assert.equal(saved.results[0].provenance.source.materials[0].density,'2700 kg/m^3');
  history.undo();assert.ok(isCurrent(history.project,result));history.redo();assert.equal(validateSource(history.project.source).material.rho,2650);
  const invalid=structuredClone(history.project.source);invalid.materials[0].reference.temperature='-20 K';assert.throws(()=>history.update(invalid));assert.deepEqual(history.project.source,saved.source);
});

test('material snapshots resolve dependencies, round trip every property and allocate independent IDs',()=>{
  const values=parameters([{name:'rhoRef',expression:'2700 kg/m^3'},{name:'nu',expression:'0.33'}]);
  const material={...base(),density:table('temperature',[['20 degC','rhoRef'],['120 degC','rhoRef-100 kg/m^3']]),reference:{temperature:'70 degC',strain:'1 percent'},properties:{poissonRatio:'nu',dampingRatio:table('strain',[['0','0.01'],['2 percent','0.02']])},notes:'Synthetic test'};
  const file=materialSnapshot(material,values),imported=importMaterialSnapshot(JSON.parse(JSON.stringify(file)),'imported');
  assert.equal(imported.id,'imported');assert.equal(imported.properties.poissonRatio,'0.33');assert.equal(imported.reference.strain,'0.01');near(resolveMaterial(imported).rho,2650);
  assert.ok(!JSON.stringify(file).includes('rhoRef'));assert.ok(!JSON.stringify(file).includes('"nu"'));
  imported.density.points[0].y='2800 kg/m^3';assert.equal(material.density.points[0].y,'rhoRef');assert.equal(file.material.density.points[0].y,'2700 kg/m^3');
  assert.notEqual(importMaterialSnapshot(file).id,importMaterialSnapshot(file).id);
  assert.throws(()=>importMaterialSnapshot({...file,format:'other'}));assert.throws(()=>importMaterialSnapshot({...file,material:{...file.material,density:'unknownParameter'}}));
});

test('material library rejects duplicate IDs, overflow and removal of assigned material',()=>{
  const p=example(),next=structuredClone(p.source);next.materials.push(structuredClone(next.materials[0]));assert.throws(()=>validateSource(next));
  next.materials.pop();next.materials=next.materials.filter(m=>m.id!==next.features[0].materialId);assert.throws(()=>validateSource(next));
  const overflow=structuredClone(p.source);while(overflow.materials.length<33)overflow.materials.push({...base(),id:`copy-${overflow.materials.length}`});assert.throws(()=>validateSource(overflow),/1–32/);
});

test('density-reference sweeps use each sample condition and export the reference alongside mass',()=>{
  const p=example();p.source.parameters.push({id:'p-ref',name:'referenceTemp',expression:'70 degC'});
  Object.assign(p.source.materials[0],{density:density(),reference:{temperature:'referenceTemp'}});
  const settings={parameterId:'p-ref',start:'20 degC',end:'120 degC',samples:3,objective:'mass',maxTemperature:'',maxMass:''};
  const record=runSweep(p,settings,'reference-sweep');
  for(const [i,row] of record.rows.entries())near(row.metrics.mass,[.0324,.0318,.0312][i]);
  const rows=sweepCSV(record).split('\r\n').map(line=>line.split(',').map(v=>v.slice(1,-1)));
  const axis=rows[0].indexOf('density_reference_axis'),coordinate=rows[0].indexOf('density_reference_coordinate_SI');
  assert.ok(axis>0);assert.equal(rows[2][axis],'temperature');near(Number(rows[2][coordinate]),343.15);
});
