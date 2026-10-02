import init, * as engine from './wasm/acoustic_engine.js?v=0.27.0';
const ready = init({ module_or_path: new URL('./wasm/acoustic_engine_bg.wasm?v=0.27.0', import.meta.url) });
// Retain one accepted project. Failed imports/edits never replace it.
let shell, project, built, sourceName = 'HeadphoneWorkshop starter';
self.onmessage = async ({ data }) => {
    const { id, action } = data;
    try {
        await ready;
        if (['build','import','open','arrange','route','outlets','nozzle','mount'].includes(action)) {
            let nextShell = shell, nextProject = data.project, nextSource = sourceName;
            if (action === 'import') {
                nextShell = JSON.parse(engine.workshop_import_stl(new Uint8Array(data.bytes), data.unit));
                nextSource = String(data.name || 'Imported shell').slice(0,200);
            } else if (action === 'open') {
                if (data.file?.format !== 'hc-workshop-file' || data.file.version !== 1) throw new Error('Unsupported project file. Open a .hcworkshop.json project.');
                nextShell = data.file.shell; nextProject = data.file.project;
                nextSource = String(data.file.sourceName || 'Project shell').slice(0,200);
            }
            const detectMount=action === 'mount';
            if (detectMount || action === 'build' && nextProject.connector_mount) {
                nextProject=JSON.parse(engine.workshop_seat_connector_json(JSON.stringify(nextProject),JSON.stringify(nextShell),!!detectMount,data.allowance ?? .1));
            }
            if (action === 'arrange' || action === 'route') {
                nextProject = JSON.parse(engine.workshop_arrange_json(JSON.stringify(nextProject), JSON.stringify(nextShell), action === 'route', data.allowance));
            }
            if (action === 'outlets') nextProject = JSON.parse(engine.workshop_outlets_json(JSON.stringify(nextProject), JSON.stringify(nextShell)));
            if (action === 'nozzle' || action === 'build' && nextProject.nozzle) {
                nextProject = JSON.parse(engine.workshop_align_nozzle_json(JSON.stringify(nextProject), JSON.stringify(nextShell), action === 'nozzle' ? data.driverId || '' : ''));
            }
            const nextBuilt = JSON.parse(engine.workshop_build_json(JSON.stringify(nextProject), JSON.stringify(nextShell)));
            shell = nextShell; project = nextProject; built = nextBuilt; sourceName = nextSource;
            self.postMessage({ id, ok: true, project, sourceName, built });
        } else if (action === 'save') {
            if (!project) throw new Error('Load a shell first.');
            self.postMessage({ id, ok: true, file: { format: 'hc-workshop-file', version: 1, sourceName, project, shell } });
        } else if (action === 'export') {
            if (built?.export_blockers?.length) throw new Error(`STL export blocked: ${built.export_blockers[0]} Fix the placement checks first. Project saving remains available.`);
            const part = built?.parts.find(p => p.id === data.part);
            if (!part) throw new Error('Select an existing part.');
            if (part.kind === 'channel' || part.kind === 'cable') throw new Error('This is a planning guide, not an exportable part. Drilled channels are included in the shell body.');
            const bytes = engine.workshop_export_stl(JSON.stringify(part.mesh));
            self.postMessage({ id, ok: true, bytes, name: part.name }, [bytes.buffer]);
        } else throw new Error('Unknown workshop operation.');
    } catch (error) { self.postMessage({ id, ok: false, error: String(error?.message || error) }); }
};
