// Offline fitting against frozen setups, using the production WASM solver.
// Fits never constitute independent validation. Validation-role cases are excluded.
import '../../docs/acoustic-source-models.js';
import { hash, grid, interpolate, validatePoints, band, stats } from './measurement-validation.mjs';
const models = globalThis.HCSourceModels;
const positive = x => Number.isFinite(x) && x > 0;
const plain = value => JSON.parse(JSON.stringify(value));
function prepare(cases, simulate, points) {
    const fitting = cases.filter(c => c.item.role === 'fit');
    if (fitting.length < 2) throw Error('At least two measured fit cases are required; validation cases cannot be used.');
    let binding, name;
    const ids = new Set();
    const prepared = fitting.map(({ item, setup, measurement }) => {
        if (!item.id || ids.has(item.id)) throw Error('Fit case IDs must be unique.');
        ids.add(item.id);
        if (setup?.schema_version !== 1 || setup.request?.drivers?.length !== 1 || setup.drivers?.length !== 1
            || !setup.drivers[0].source_binding || !positive(setup.input_voltage_v)) throw Error(`${item.id}: export a current single-driver setup with its source binding.`);
        const meta = setup.drivers[0], driver = setup.request.drivers[0];
        if (meta.id !== driver.id || meta.voltage_mode !== 'common' || !positive(meta.measurement_voltage_v)) throw Error(`${item.id}: known baseline and common drive voltages are required.`);
        if (binding && models.canonical(binding) !== models.canonical(meta.source_binding)) throw Error('Fit cases must share a receiver, baseline and reference fixture.');
        binding = plain(meta.source_binding); name = meta.name;
        if (!measurement || measurement.schema_version !== 1
            || !['physical_measurement', 'published_curve'].includes(measurement.kind)) throw Error(`${item.id}: no physical measurement or documented published curve supplied.`);
        if (measurement.setup_confirmed !== true || measurement.setup_sha256 !== hash(setup)) throw Error(`${item.id}: confirm the frozen measurement setup hash before fitting.`);
        if (!positive(measurement.input_voltage_v) || Math.abs(measurement.input_voltage_v / setup.input_voltage_v - 1) > .01) throw Error(`${item.id}: measurement voltage must match the setup within 1%.`);
        if (measurement.kind === 'published_curve') {
            if (typeof measurement.source_url !== 'string' || !/^https?:\/\//.test(measurement.source_url)
                || !measurement.notes?.trim()) throw Error(`${item.id}: identify the published source and its fixture assumptions.`);
        } else {
            for (const key of ['specimen_id', 'mount_id', 'coupler_model', 'calibration_id', 'acquired_at']) {
                if (typeof measurement[key] !== 'string' || !measurement[key].trim()) throw Error(`${item.id}: missing ${key}.`);
            }
        }
        const range = band(item.band_hz);
        validatePoints(measurement.points);
        validatePoints(driver.response);
        for (const [description, values] of [['Measurement', measurement.points], ['Baseline', driver.response]]) {
            if (values[0].frequency_hz > range[0] || values.at(-1).frequency_hz < range[1]) throw Error(`${item.id}: ${description} does not cover the fit band; extrapolation is forbidden.`);
        }
        const request = plain(setup.request); request.frequencies_hz = grid(...range, points);
        const measured = request.frequencies_hz.map(f => interpolate(measurement.points, f));
        // Reference/reference cancels for every source; it cannot identify one.
        const probe = source => {
            const test = plain(request); test.drivers[0].acoustic_source = source;
            return simulate(test).combined.map(p => p.db);
        };
        const low = probe({ type: 'ideal_pressure' });
        const high = probe({ type: 'outlet_inertance', outlet_diameter_mm: 1, effective_length_mm: 0, resistance_acoustic_ohm: 5e8 });
        const informative = low.some((x, i) => Math.abs(x - high[i]) > 1e-4);
        return { id: item.id, request, measured, informative, band: range,
            evidence: { case_id: item.id, kind: measurement.kind, setup_sha256: hash(setup), measurement_sha256: hash(measurement),
                ...(measurement.source_url ? { source_url: measurement.source_url } : {}) } };
    });
    const signatures = new Set(prepared.filter(c => c.informative).map(c => models.canonical({
        path: c.request.drivers[0].acoustic_path, load: c.request.acoustic_load,
    })));
    if (signatures.size < 2) throw Error('Need at least two distinct source-sensitive acoustic setups. Reference unity and repeated copies cannot identify a source.');
    const range = [Math.max(...prepared.map(c => c.band[0])), Math.min(...prepared.map(c => c.band[1]))];
    band(range, 'common fit band');
    return { prepared, binding, name, range };
}
const lower = [.0001,.0001,.0001,.0001,20,.05];
const upper = [100,1000,1000,1000,40000,100];
export function sourceFromParameters(x) {
    const [r,m,k,...branches] = x.map(Math.exp);
    return { type: 'foster', resistance_acoustic_ohm: r * 1e8,
        inertance_kg_per_m4: m * 1e8 / (2 * Math.PI * 1000),
        compliance_m3_per_pa: 1 / (k * 1e8 * 2 * Math.PI * 1000),
        branches: Array.from({ length: branches.length / 3 }, (_, i) => ({ resistance_acoustic_ohm: branches[i*3] * 1e8, resonance_hz: branches[i*3+1], q: branches[i*3+2] })) };
}
// Bounded Nelder-Mead in positive log coordinates, with deterministic restarts.
function minimize(cost, start, lo, hi, budget) {
    const n=start.length, clip=x=>x.map((v,i)=>Math.max(lo[i],Math.min(hi[i],v)));
    let evaluations=0;
    const evaluate=x=>{const point=clip(x);evaluations++;return {x:point,cost:cost(point)};};
    let simplex=[evaluate(start),...start.map((_,i)=>evaluate(start.map((v,j)=>v+(i===j?.4:0))))];
    while(evaluations < budget) {
        simplex.sort((a,b)=>a.cost-b.cost);
        if (Math.max(...simplex.slice(1).map(p=>Math.max(...p.x.map((v,i)=>Math.abs(v-simplex[0].x[i]))))) < 1e-6) break;
        const centroid=start.map((_,i)=>simplex.slice(0,n).reduce((sum,p)=>sum+p.x[i],0)/n);
        const worst=simplex[n], transform=scale=>centroid.map((v,i)=>v+scale*(v-worst.x[i]));
        const reflected=evaluate(transform(1));
        if(reflected.cost<simplex[0].cost) {
            const expanded=evaluate(transform(2));simplex[n]=expanded.cost<reflected.cost?expanded:reflected;
        } else if(reflected.cost<simplex[n-1].cost) simplex[n]=reflected;
        else {
            const contracted=evaluate(transform(reflected.cost<worst.cost?.5:-.5));
            if(contracted.cost<Math.min(worst.cost,reflected.cost))simplex[n]=contracted;
            else simplex=simplex.map((p,i)=>i?evaluate(p.x.map((v,j)=>(v+simplex[0].x[j])/2)):p);
        }
    }
    simplex.sort((a,b)=>a.cost-b.cost);return {...simplex[0],evaluations};
}
export function fitSource(cases, simulate, { branches=1, maxEvaluations=4000, points=120 }={}) {
    if (![0,1,2].includes(branches) || !Number.isInteger(maxEvaluations) || maxEvaluations<200 || maxEvaluations>30000
        || !Number.isInteger(points) || points<32 || points>1000) throw Error('Invalid source fit options.');
    const {prepared,binding,name,range}=prepare(cases,simulate,points);
    const residuals=source=>prepared.map(c=>{
        const request={...c.request,drivers:[{...c.request.drivers[0],acoustic_source:source}]};
        const predicted=simulate(request).combined;
        if(predicted.length!==c.measured.length || predicted.some(p=>!Number.isFinite(p.db)||!Number.isFinite(p.phase_deg))) throw Error('Nonfinite simulation during source fit.');
        return predicted.map((p,i)=>p.db-c.measured[i]);
    });
    const cost=x=>{const errors=residuals(sourceFromParameters(x)).flat();return errors.reduce((s,x)=>s+x*x,0)/errors.length;};
    const lo=[...lower.slice(0,3),...Array.from({length:branches},()=>lower.slice(3)).flat()].map(Math.log);
    const hi=[...upper.slice(0,3),...Array.from({length:branches},()=>upper.slice(3)).flat()].map(Math.log);
    let best=null,evaluations=0;
    const starts=4;
    for(let i=0;i<starts;i++) {
        const start=[2,.5,8,...Array.from({length:branches},(_,b)=>[5,[1800,3500,6500,11000][(i+b)%4],2]).flat()].map(Math.log);
        start[1]+=Math.log([.3,1,3,10][i]);
        const result=minimize(cost,start,lo,hi,Math.floor(maxEvaluations/starts));evaluations+=result.evaluations;
        if(!best || result.cost<best.cost)best=result;
    }
    const source=sourceFromParameters(best.x);
    const errors=residuals(source);
    const metrics=prepared.map((c,i)=>({case_id:c.id,informative:c.informative,fit_error_db:stats(errors[i])}));
    return {format:'hc-acoustic-source-profile',version:1,driver_name:name,binding,source,band_hz:range,
        status:'FIT_NOT_VALIDATED',independently_validated:false,evidence:prepared.map(c=>c.evidence),
        fit:{objective:'Unnormalized SPL residual over fit-role cases only; no gain, baseline or phase fitting.',
            rms_db:Math.sqrt(best.cost),evaluations,branches,points_per_case:points,metrics}};
}
