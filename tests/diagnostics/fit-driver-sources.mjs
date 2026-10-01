// Batch fitting of every receiver with available measurements. Missing data stays pending.
// node tests/diagnostics/fit-driver-sources.mjs packet/manifest.json NEW-output-directory [branch-count]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import init, * as engine from '../../docs/wasm/acoustic_engine.js';
import { fitSource } from './fit-source-network.mjs';
export async function fitManifest(manifestFile, output, branches=1) {
    if (fs.existsSync(output)) throw Error('Output already exists; choose a new directory to preserve profiles and reports.');
    const root=path.dirname(path.resolve(manifestFile));
    const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
    if(manifest.schema_version!==1 || !Array.isArray(manifest.cases))throw Error('Invalid measurement manifest.');
    if(![0,1,2].includes(branches))throw Error('Choose 0, 1 or 2 source branches.');
    const readFile=name=>{
        if(typeof name!=='string' || path.isAbsolute(name))throw Error('Use relative packet file paths.');
        const file=path.resolve(root,name),relative=path.relative(root,file);
        if(relative==='..'||relative.startsWith('..'+path.sep))throw Error('Packet file paths must stay inside the packet directory.');
        return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
    };
    await init({module_or_path:fs.readFileSync(new URL('../../docs/wasm/acoustic_engine_bg.wasm',import.meta.url))});
    const simulate=request=>JSON.parse(engine.simulate_json(JSON.stringify(request)));
    fs.mkdirSync(output,{recursive:true});
    const results=[];
    for(const driver of new Set(manifest.cases.map(c=>c.driver))) {
        const items=manifest.cases.filter(c=>c.driver===driver&&c.role==='fit');
        const missing=[],cases=[];
        try {
            for(const item of items) {
                const setup=readFile(item.setup_file),measurement=readFile(item.measurement_file);
                if(!setup)throw Error(`${item.id}: setup file is missing.`);
                if(!measurement)missing.push(item.id);
                else cases.push({item,setup,measurement});
            }
            if(missing.length || items.length<2) {
                results.push({driver,status:'AWAITING_MEASUREMENTS',missing_fit_cases:missing,fit_cases:items.length});continue;
            }
            const profile=fitSource(cases,simulate,{branches});
            const filename=`${String(results.length+1).padStart(2,'0')}-${String(driver).replace(/[^a-zA-Z0-9-]/g,'-').toLowerCase()}.source.json`;
            fs.writeFileSync(path.join(output,filename),JSON.stringify(profile,null,2)+'\n');
            results.push({driver,status:profile.status,profile_file:filename,fit_rms_db:profile.fit.rms_db,fit_cases:items.length});
        }catch(error){results.push({driver,status:'NEEDS_ATTENTION',reason:error.message});}
    }
    const report={engine:engine.engine_version(),interpretation:'Fits are not independently validated. Validation-role files are never read by this fitter.',results};
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
    return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
    try {
        if(!process.argv[2]||!process.argv[3])throw Error('Usage: node fit-driver-sources.mjs manifest.json NEW-output-directory [0|1|2]');
        const report=await fitManifest(process.argv[2],process.argv[3],Number(process.argv[4]??1));
        console.log(JSON.stringify(report,null,2));
        if(report.results.some(r=>r.status!=='FIT_NOT_VALIDATED'))process.exitCode=2;
    }catch(error){console.error(error.message);process.exitCode=1;}
}
