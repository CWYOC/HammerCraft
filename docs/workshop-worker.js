import init, * as engine from './wasm/acoustic_engine.js?v=0.20.0';
const ready = init({ module_or_path: new URL('./wasm/acoustic_engine_bg.wasm?v=0.20.0', import.meta.url) });
// Retain one accepted project. Failed imports/edits never replace it.
let shell, project, built, sourceName = 'HeadphoneWorkshop starter';
self.onmessage = async ({ data }) => {
    const { id, action } = data;
    try {
        await ready;
        if (action === 'build' || action === 'import' || action === 'open') {
            let nextShell = shell, nextProject = data.project, nextSource = sourceName;
            if (action === 'import') {
                nextShell = JSON.parse(engine.workshop_import_stl(new Uint8Array(data.bytes), data.unit));
                nextSource = String(data.name || 'Imported shell').slice(0,200);
            } else if (action === 'open') {
                if (data.file?.format !== 'hc-workshop-file' || data.file.version !== 1) throw new Error('Unsupported project file. Open a .hcworkshop.json project.');
                nextShell = data.file.shell; nextProject = data.file.project;
                nextSource = String(data.file.sourceName || 'Project shell').slice(0,200);
            }
            const nextBuilt = JSON.parse(engine.workshop_build_json(JSON.stringify(nextProject), JSON.stringify(nextShell)));
            shell = nextShell; project = nextProject; built = nextBuilt; sourceName = nextSource;
            self.postMessage({ id, ok: true, project, sourceName, built });
        } else if (action === 'save') {
            if (!project) throw new Error('Load a shell first.');
            self.postMessage({ id, ok: true, file: { format: 'hc-workshop-file', version: 1, sourceName, project, shell } });
        } else if (action === 'export') {
            const part = built?.parts.find(p => p.id === data.part);
            if (!part) throw new Error('Select an existing part.');
            const bytes = engine.workshop_export_stl(JSON.stringify(part.mesh));
            self.postMessage({ id, ok: true, bytes, name: part.name }, [bytes.buffer]);
        } else throw new Error('Unknown workshop operation.');
    } catch (error) { self.postMessage({ id, ok: false, error: String(error?.message || error) }); }
};
