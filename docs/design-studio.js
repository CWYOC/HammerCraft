import {
    FORMAT,
    createProject,
    validateProject,
    validProjectName,
    connectTube,
    disconnectTube,
    synchronize,
} from "./design-project.mjs?v=3";
const $ = (id) => document.getElementById(id);
let project,
    geometry,
    acoustics,
    catalog = [],
    statuses = [],
    busy = false,
    dirty = false,
    changeTimer,
    captureRequested = false,
    downloadUrl;
const frames = [$("geometryEditor"), $("acousticsEditor")];
const uid = () => crypto.randomUUID();
function message(text, error = false) {
    $("studioMessage").textContent = text;
    $("studioMessage").classList.toggle("error", error);
}
function setBusy(value) {
    busy = value;
    $("editorArea").classList.toggle("busy", value);
    for (const el of document.querySelectorAll(
        "main button,main input,main select",
    ))
        el.disabled = value;
    for (const frame of frames) frame.inert = value;
}
function invalidateDownload() {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
    $("studioDownload").hidden = true;
}
function changed() {
    dirty = true;
    invalidateDownload();
    $("projectState").textContent = "UNSAVED CHANGES";
}
function opt(value, text) {
    const el = document.createElement("option");
    el.value = value;
    el.textContent = text;
    return el;
}
function nameOf(d) {
    return catalog.find((c) => c.id === d?.preset)?.name || "3D driver";
}
function selectOptions(el, items) {
    const previous = el.value;
    el.replaceChildren(...items);
    if (items.some((o) => o.value === previous)) el.value = previous;
}
function tubeOptions() {
    const d = project?.acoustics.drivers.find(
        (d) => d.id === $("linkAcoustic").value,
    );
    selectOptions(
        $("linkTube"),
        (d?.path || []).flatMap((p, i) =>
            p.type === "tube"
                ? [
                      opt(
                          String(i),
                          `Section ${i + 1} · ${Number(p.length).toFixed(2)} mm × ${Number(p.diameter).toFixed(2)} mm`,
                      ),
                  ]
                : [],
        ),
    );
}
function render() {
    if (!project) return;
    selectOptions(
        $("linkGeometry"),
        project.geometry.project.drivers.map((d, i) =>
            opt(d.id, `${i + 1} · ${nameOf(d)}`),
        ),
    );
    selectOptions(
        $("linkAcoustic"),
        project.acoustics.drivers.map((d, i) =>
            opt(
                d.id,
                `${i + 1} · ${d.name}${d.measurement?.length ? "" : " · no measured FR"}`,
            ),
        ),
    );
    tubeOptions();
    $("linkCount").textContent = String(project.links.length);
    $("linkRows").replaceChildren(
        ...project.links.map((link) => {
            const row = document.createElement("div");
            row.className = "link-row";
            const status = statuses.find((s) => s.id === link.id);
            row.dataset.ok = String(!!status?.ok);
            const div = document.createElement("div"),
                title = document.createElement("strong"),
                note = document.createElement("span"),
                button = document.createElement("button");
            const g = project.geometry.project.drivers.find(
                    (d) => d.id === link.geometryDriverId,
                ),
                a = project.acoustics.drivers.find(
                    (d) => d.id === link.acousticDriverId,
                );
            title.textContent = `${g ? nameOf(g) : "Missing 3D driver"} ↔ ${a?.name || "Missing acoustic driver"}`;
            note.textContent = status?.message || "Waiting for geometry";
            button.textContent = "UNLINK";
            button.onclick = () =>
                operation(async () => {
                    await capture();
                    project = disconnectTube(project, link.id);
                    await updateLinks();
                    changed();
                    message(
                        "Unlinked. The last dimensions remain as editable acoustic values.",
                    );
                });
            div.append(title, note);
            row.append(div, button);
            return row;
        }),
    );
    const linked = new Set(project.links.map((l) => l.geometryDriverId)),
        unlinked = project.geometry.project.drivers.filter(
            (d) => !linked.has(d.id),
        ),
        linkedAcoustics = new Set(project.links.map((l) => l.acousticDriverId)),
        unlinkedAcoustics = project.acoustics.drivers.filter(
            (d) => !linkedAcoustics.has(d.id),
        );
    $("unlinkedNote").textContent =
        `${unlinked.length} 3D route${unlinked.length === 1 ? "" : "s"} unlinked. ${statuses.filter((s) => !s.ok).length} link${statuses.filter((s) => !s.ok).length === 1 ? " needs" : "s need"} attention. ${unlinkedAcoustics.length} acoustic driver${unlinkedAcoustics.length === 1 ? " has" : "s have"} no 3D link; these still contribute to the combined response. Unlinked acoustic sections keep their manual dimensions.`;
}
async function operation(fn) {
    if (busy) return;
    setBusy(true);
    try {
        return await fn();
    } catch (e) {
        message(e.message || String(e), true);
    } finally {
        setBusy(false);
        if (captureRequested) queueCapture();
    }
}
async function capture(flush = false, name = $("studioName").value) {
    const before = project ? JSON.stringify(project) : null;
    // File imports can finish while Rust is working. Read the acoustic editor
    // afterwards so applying links cannot restore an older acoustic path.
    const g = await (flush ? geometry.flush() : geometry.snapshot());
    const a = await (flush ? acoustics.flush() : acoustics.snapshot());
    const next = project
        ? { ...project, geometry: g.file, acoustics: a }
        : createProject(g.file, a, uid());
    next.name = name;
    next.geometry.project.name = name;
    next.acoustics.name = name;
    await updateLinks(g.paths, next);
    if (before && JSON.stringify(project) !== before) changed();
}
async function updateLinks(paths, candidate = project) {
    if (!paths) paths = (await geometry.snapshot()).paths;
    const result = synchronize(candidate, paths);
    project = result.project;
    statuses = result.statuses;
    project.acoustics = await acoustics.applyLinks(project.acoustics);
    project.acoustics.name = project.name;
    render();
}
function scheduleCapture() {
    if (!project) return;
    captureRequested = true;
    queueCapture();
}
function queueCapture() {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
        if (busy || !captureRequested) return;
        captureRequested = false;
        return operation(() => capture());
    }, 250);
}
async function switchView(view) {
    await capture(true);
    for (const name of ["geometry", "links", "acoustics"])
        $(name + "Panel").hidden = name !== view;
    for (const button of document.querySelectorAll("[data-view]"))
        button.setAttribute(
            "aria-selected",
            String(button.dataset.view === view),
        );
}
function waitForEditor(frame, url) {
    return new Promise((resolve, reject) => {
        let timeout;
        const check = () => {
            try {
                const w = frame.contentWindow;
                if (w.HCDesignAdapter) {
                    clearTimeout(timeout);
                    w.addEventListener("hc-design-change", scheduleCapture);
                    w.addEventListener("hc-design-draft", changed);
                    resolve(w.HCDesignAdapter);
                    return;
                }
                w.addEventListener("hc-design-ready", check, { once: true });
            } catch (e) {
                clearTimeout(timeout);
                reject(e);
            }
        };
        frame.addEventListener("load", check);
        timeout = setTimeout(
            () =>
                reject(
                    new Error(
                        "An editor did not finish loading. Check your connection and reload the studio.",
                    ),
                ),
            30000,
        );
        frame.src = url;
    });
}
async function openPackage(input) {
    // Validate before touching either editor. Keep complete rollback snapshots.
    const next = validateProject(input);
    acoustics.validate(next.acoustics);
    const old = project ? structuredClone(project) : null,
        oldName = $("studioName").value;
    try {
        const g = await geometry.open(next.geometry);
        const a = await acoustics.open(next.acoustics);
        project = { ...next, geometry: g.file, acoustics: a };
        $("studioName").value = next.name;
        await updateLinks(g.paths);
        changed();
        message(
            `Opened ${next.name}. ${statuses.filter((s) => !s.ok).length} links need attention.`,
        );
    } catch (error) {
        if (old) {
            try {
                await geometry.open(old.geometry);
                await acoustics.open(old.acoustics);
                project = old;
                $("studioName").value = oldName;
                await updateLinks();
            } catch (rollback) {
                throw new Error(
                    `${error.message}. Restoring the previous editor state failed: ${rollback.message}. Reload the last saved file.`,
                );
            }
        }
        throw error;
    }
}
async function importFile(input) {
    // Opening a saved file is also a recovery action. Retain accepted state for
    // rollback without requiring an invalid geometry/name draft to build first.
    const draftName = $("studioName").value;
    const replacesGeometry = [FORMAT, "hc-workshop-file"].includes(
        input?.format,
    );
    // A circuit-only import must retain pending geometry edits, since it does
    // not replace that part of the project.
    await capture(
        !replacesGeometry,
        validProjectName(draftName) ? draftName : project.name,
    );
    if (input?.format === FORMAT) return openPackage(input);
    const next = structuredClone(project);
    if (input?.format === "hc-workshop-file") next.geometry = input;
    else if (Array.isArray(input?.drivers)) {
        next.acoustics = acoustics.validate(input);
        next.acoustics.version = 3;
    } else
        throw new Error(
            "Choose a shared design project, workshop JSON or acoustic project JSON. Import STL inside Assembly & tubes.",
        );
    await openPackage(next);
}
async function start() {
    setBusy(true);
    if (!window.HCAuth) throw new Error("Authentication helper unavailable.");
    if (!(await window.HCAuth.requireAdmin())) return;
    const response = await fetch("./assets/workshop/drivers.json");
    if (!response.ok) throw new Error("Driver catalog unavailable.");
    catalog = await response.json();
    [geometry, acoustics] = await Promise.all([
        waitForEditor(frames[0], "headphone-workshop.html?embedded=1"),
        waitForEditor(frames[1], "iem-designer.html?embedded=1"),
    ]);
    await capture();
    $("projectState").textContent = "NEW PROJECT";
    for (const button of document.querySelectorAll("[data-view]"))
        button.onclick = () => operation(() => switchView(button.dataset.view));
    $("studioName").oninput = changed;
    $("studioName").onchange = () =>
        operation(async () => {
            await capture();
            changed();
        });
    $("linkAcoustic").onchange = tubeOptions;
    $("connectTube").onclick = () =>
        operation(async () => {
            // Preserve the explicit choices while collecting the latest snapshots.
            const choice = {
                geometryDriverId: $("linkGeometry").value,
                acousticDriverId: $("linkAcoustic").value,
                tubeIndex: Number($("linkTube").value),
                id: uid(),
            };
            if (!$("linkTube").value)
                throw new Error("Select an acoustic tube section.");
            await capture();
            project = connectTube(project, choice);
            await updateLinks();
            changed();
            message(
                "Linked. Accepted 3D route changes now update this acoustic tube section.",
            );
        });
    $("createCircuit").onclick = () =>
        operation(async () => {
            const id = $("linkGeometry").value;
            await capture();
            const g = project.geometry.project.drivers.find((d) => d.id === id);
            if (!g) throw new Error("Select a 3D driver.");
            const added = acoustics.addDriver(nameOf(g));
            await capture();
            $("linkAcoustic").value = added.id;
            tubeOptions();
            changed();
            message(
                "Created a blank circuit path. Select its tube section and link it; load the correct driver measurements in Circuit & response.",
            );
        });
    $("saveAll").onclick = () =>
        operation(async () => {
            await capture(true);
            const file = validateProject(project);
            invalidateDownload();
            downloadUrl = URL.createObjectURL(
                new Blob([JSON.stringify(file)], { type: "application/json" }),
            );
            const link = $("studioDownload");
            link.href = downloadUrl;
            link.download = `${project.name.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80) || "iem-design"}.hcdesign.json`;
            link.textContent = `DOWNLOAD ${link.download}`;
            link.hidden = false;
            link.click();
            dirty = false;
            $("projectState").textContent = "DOWNLOAD READY";
            message(
                "Complete project file prepared. Keep the downloaded file to reopen all three designs together.",
            );
        });
    $("openAll").onclick = () => $("studioFile").click();
    $("studioFile").onchange = async (e) => {
        const file = e.target.files[0];
        e.target.value = "";
        if (!file) return;
        await operation(async () => {
            if (file.size > 64 * 1024 * 1024)
                throw new Error("Project files must be under 64 MB.");
            await importFile(JSON.parse(await file.text()));
        });
    };
    $("importSaved").onclick = () =>
        operation(async () => {
            const text = localStorage.getItem("hc_iem_project");
            if (!text)
                throw new Error(
                    "No saved acoustic project in this browser. Use Open / import file for a JSON file.",
                );
            await importFile(JSON.parse(text));
        });
    window.addEventListener("beforeunload", (e) => {
        if (dirty) {
            e.preventDefault();
            e.returnValue = "";
        }
    });
    setBusy(false);
    message(
        "Ready. Place drivers and tubes, then connect them in Driver links. Save all exports one complete project.",
    );
}
start().catch((e) => {
    setBusy(true);
    message(`Unable to start studio: ${e.message || e}`, true);
});
