import vm from 'node:vm';
import { read, dom, quiet } from './helpers.mjs';

export function designer() {
    const document = dom();
    const storage = new Map();
    for (const [id, value] of Object.entries({ iemSplMode: 'relative', iemNormalizeFrequency: '1000', iemNormalizeMode: 'system',
        iemTemperature: '20', iemHumidity: '50', iemAcousticLoadType: 'anechoic' })) document.getElementById(id).value = value;
    const context = vm.createContext({ document, window: { addEventListener() {}, Chart: true }, console: quiet,
        crypto: globalThis.crypto, structuredClone, Event, localStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, String(value)),
        }, Chart: class { constructor(_canvas, config) { Object.assign(this, config); } destroy() {} update() {} },
    });
    vm.runInContext(read('docs/cad-circuit.js'), context);
    // Expose closure functions only in the test VM; production exports stay unchanged.
    vm.runInContext(read('docs/iem-designer.js').replace('window.HCIemDesigner = { init, populateTargetProducts };',
        'window.test = { databaseDriverToDesign, referenceInfo, databaseReferenceError, state, driver, draw, rustRequest, applyRevPhysical, calculate, ensureDriverShape, passiveCircuitH, renderCircuitSvg, addCadComponent, finishWireEndpoint, undoCircuit, redoCircuit, mutateCircuit, bindDriverEvents, saveProject, loadProject, newProject, fallback, parseFile, reverseRun, restoreProjectSettings, importDriverFile, renderLibrary };'), context);
    context.window.test.restoreProjectSettings();
    return { ...context.window.test, document, context, storage };
}
