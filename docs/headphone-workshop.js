import { createViewer } from "./workshop-viewer.js?v=7";
const $ = (id) => document.getElementById(id);
let project = {
    format: "hc-headphone-workshop",
    version: 1,
    name: "Untitled IEM",
    shell_scale: [1, 1, 1],
    mirrored: false,
    drivers: [],
};
let catalog = [], hardware,
    selected,
    built,
    viewer,
    busy = false,
    sequence = 0,
    worker,
    workerFailed = false;
const pending = new Map();
let arrangeUndo;
function tell(text, error = false) {
    $("status").textContent = text;
    $("status").classList.toggle("error", error);
}
function setBusy(value) {
    busy = value;
    for (const el of document.querySelectorAll(
        ".workshop-controls input,.workshop-controls select,.workshop-controls button,.project-bar input,.project-bar button,.exports button,.exports select,#placementChecks button,.arrange-bar button",
    ))
        el.disabled = value;
    $("undoArrange").disabled = value || !arrangeUndo;
    $("viewNozzle").disabled = value || !project.nozzle;
    $("viewConnector").disabled = value || !project.connector_mount;
    for(let i=0;i<3;i++) if($("pinSize"+i)) $("pinSize"+i).disabled=value || !!$("pinModel").value;
    $("exportStl").disabled = value || !built || !!built.export_blockers?.length;
}
function rpc(action, data = {}) {
    return new Promise((resolve, reject) => {
        if (workerFailed)
            return reject(
                new Error("Reload the page to restart the geometry worker."),
            );
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, action, ...data });
    });
}
function number(id) {
    const input = $(id);
    if (input.value.trim() === "" || !Number.isFinite(input.valueAsNumber))
        throw new Error(
            `Enter a valid value for ${input.getAttribute("aria-label") || id}.`,
        );
    return input.valueAsNumber;
}
function option(value, label) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    return o;
}
function newDriver(index = 0, construction) {
    return {
        id: crypto.randomUUID(),
        preset: 13,
        position_mm: [3 + index * 3.5, -2, 0],
        rotation_deg: [0, 0, 0],
        end_mm: [-3, 11, -2.4],
        bend_mm: [-3 + index * 3.5, 3, -2],
        lead_mm: 3,
        inner_diameter_mm: 1.6,
        outer_diameter_mm: Math.max(2.4, 1.6 + (construction?.drilled_channels ? 6 * construction.resolution_mm : 0)),
    };
}
function draft() {
    const p = structuredClone(project);
    p.name = $("projectName").value;
    p.shell_scale = [0, 1, 2].map((i) => number(`scale${i}`));
    p.mirrored = $("mirrored").checked;
    if ($("constructionEnabled").checked) {
        p.construction = {
            drilled_channels: $("channelMode").value === "drilled",
            wall_mm: number("wallThickness"), resolution_mm: number("meshSpacing"),
            faceplate_mode: ["auto", "normal"].includes($("faceplateAxis").value) ? $("faceplateAxis").value : "axis",
            faceplate_axis: Math.abs(Number($("faceplateAxis").value)) || 0,
            faceplate_negative: $("faceplateAxis").value.startsWith("-"),
            ...($("faceplateAxis").value === "normal" ? {faceplate_normal: [0,1,2].map(i=>number(`faceplateNormal${i}`))} : {}),
            faceplate_depth_mm: number("faceplateDepth"),
            faceplate_gap_mm: number("faceplateGap"), cut_sound_paths: $("cutSoundPaths").checked,
            connector: $("connectorShape").value === "none" ? null : {
                shape: $("connectorShape").value,
                center_mm: [0,1,2].map(i => number(`connectorPosition${i}`)),
                size_mm: [0,1,2].map(i => number(`connectorSize${i}`)),
                rotation_deg: [0,1,2].map(i => number(`connectorRotation${i}`)),
            },
        };
    } else delete p.construction;
    if ($("assemblyEnabled").checked) {
        const body = prefix => ({size_mm:[0,1,2].map(i=>number(`${prefix}Size${i}`)),position_mm:[0,1,2].map(i=>number(`${prefix}Position${i}`)),rotation_deg:[0,1,2].map(i=>number(`${prefix}Rotation${i}`))});
        p.assembly = {connector:$("pinEnabled").checked ? body("pin") : null, crossover:$("boardEnabled").checked ? body("board") : null,
            clearance_mm:number("assemblyClearance"),cable_diameter_mm:number("cableDiameter"),cables:p.assembly?.cables || []};
        if(p.assembly.connector && $("pinModel").value) p.assembly.connector.model=$("pinModel").value;
    } else delete p.assembly;
    if(!$("pinMounted").checked || !p.assembly?.connector) delete p.connector_mount;
    else if(p.connector_mount) p.connector_mount.fit_clearance_mm=number("pinAllowance");
    if ($("nozzleEnabled").checked) p.nozzle = {
        origin_mm: [0,1,2].map(i=>number(`nozzleOrigin${i}`)),
        normal: [0,1,2].map(i=>number(`nozzleNormal${i}`)), lead_mm:number("nozzleLead"),
    };
    else delete p.nozzle;
    const d = p.drivers.find((d) => d.id === selected);
    if (d) {
        d.preset = Number($("preset").value);
        for (const [key, prefix] of [
            ["position_mm", "position"],
            ["rotation_deg", "rotation"],
            ["bend_mm", "bend"],
            ["end_mm", "end"],
        ])
            d[key] = [0, 1, 2].map((i) => number(`${prefix}${i}`));
        d.lead_mm = number("lead");
        d.inner_diameter_mm = number("innerDiameter");
        d.outer_diameter_mm = number("outerDiameter");
    }
    return p;
}
function showConstruction() {
    const c = project.construction;
    $("constructionEnabled").checked = !!c;
    $("constructionFields").hidden = !c;
    if (c) {
        $("channelMode").value = c.drilled_channels ? "drilled" : "tube";
        $("wallThickness").value = c.wall_mm;
        $("meshSpacing").value = c.resolution_mm;
        $("faceplateAxis").value = c.faceplate_mode && c.faceplate_mode !== "axis" ? c.faceplate_mode : `${c.faceplate_negative ? "-" : ""}${c.faceplate_axis}`;
        if (c.faceplate_normal) c.faceplate_normal.forEach((v,i)=>$(`faceplateNormal${i}`).value=v);
        $("faceplateDepth").value = c.faceplate_depth_mm;
        $("faceplateGap").value = c.faceplate_gap_mm;
        $("cutSoundPaths").checked = c.cut_sound_paths;
        $("connectorShape").value = c.connector?.shape || "none";
        if (c.connector) for (const [field,prefix] of [["center_mm","connectorPosition"],["size_mm","connectorSize"],["rotation_deg","connectorRotation"]])
            c.connector[field].forEach((value,i) => $(`${prefix}${i}`).value = value);
    }
    $("connectorFields").hidden = $("connectorShape").value === "none";
    $("faceplateNormal").hidden = $("faceplateAxis").value !== "normal";
    const info = built?.construction;
    $("faceplateStatus").textContent = info
        ? `${info.detected_face_area_mm2 != null ? `Detected flat face: ${info.detected_face_area_mm2.toFixed(1)} mm².` : "Manual cap placement."} Outward normal (${info.faceplate_normal.map(v=>v.toFixed(3)).join(", ")}). Hide the shell to inspect the cap; hide the cap to inspect the matching opening.`
        : "";
    $("constructionStatus").textContent = info
        ? `Constructed body + separate faceplate · ${info.resolution_mm.toFixed(2)} mm grid · ${info.requested_wall_mm.toFixed(2)} mm requested wall · cavity estimate ${info.cavity_volume_estimate_mm3.toFixed(0)} mm³ · cap ${info.faceplate.triangles.toLocaleString()} triangles. Inspect the result before manufacture.`
        : "Stock layout mode: hollowing and cuts are disabled.";
}
function showAssembly() {
    const a=project.assembly;
    $("assemblyEnabled").checked=!!a; $("assemblyFields").hidden=!a;
    $("pinMounted").checked=!!project.connector_mount;
    $("viewConnector").disabled=busy || !project.connector_mount;
    if(project.connector_mount) $("pinAllowance").value=project.connector_mount.fit_clearance_mm;
    $("pinMountStatus").textContent=project.connector_mount ? "Socket mating face is flush with the saved shell surface. Its opening follows Apply changes. Inspect the face, then Route cables." : "Connector is free to move. Seat it to establish a mounting surface.";
    if (!a) return;
    $("assemblyClearance").value=a.clearance_mm; $("cableDiameter").value=a.cable_diameter_mm;
    for (const [key,prefix] of [["connector","pin"],["crossover","board"]]) {
        const b=a[key];$(prefix+"Enabled").checked=!!b;$(prefix+"Fields").hidden=!b;
        if (b) for (const [field,suffix] of [["size_mm","Size"],["position_mm","Position"],["rotation_deg","Rotation"]]) b[field].forEach((v,i)=>$(prefix+suffix+i).value=v);
    }
    $("pinModel").value=a.connector?.model || "";
    showHardware();
    $("cableSummary").textContent=(a.cables||[]).map(c=>`${c.id}: ${c.points_mm.slice(1).reduce((sum,v,i)=>sum+Math.hypot(...v.map((x,j)=>x-c.points_mm[i][j])),0).toFixed(1)} mm`).join(" · ") || "No harness routes yet. Use Auto arrange assembly or Route cables.";
}
function showDriver() {
    const d = project.drivers.find((d) => d.id === selected);
    $("driverFields").hidden = !d;
    $("routeFields").hidden = !d;
    if (d) {
        $("preset").value = d.preset;
        for (const [key, prefix] of [
            ["position_mm", "position"],
            ["rotation_deg", "rotation"],
            ["bend_mm", "bend"],
            ["end_mm", "end"],
        ])
            d[key].forEach((x, i) => ($(`${prefix}${i}`).value = x));
        $("lead").value = d.lead_mm;
        $("innerDiameter").value = d.inner_diameter_mm;
        $("outerDiameter").value = d.outer_diameter_mm;
        showPreset();
    }
    const path = built?.paths.find((p) => p.driver_id === selected);
    $("pathLength").textContent = path
        ? `${path.length_mm.toFixed(2)} mm`
        : "—";
    $("pathVolume").textContent = path
        ? `${path.bore_volume_mm3.toFixed(2)} mm³`
        : "—";
    viewer?.select(selected);
    $("nozzleEnabled").checked=!!project.nozzle;
    $("viewNozzle").disabled=busy || !project.nozzle;
    $("nozzleFields").hidden=!project.nozzle;
    if (project.nozzle) {
        for (const [key,prefix] of [["origin_mm","nozzleOrigin"],["normal","nozzleNormal"]])
            project.nozzle[key].forEach((v,i)=>$(prefix+i).value=v);
        $("nozzleLead").value=project.nozzle.lead_mm;
    }
    $("nozzleStatus").textContent=project.nozzle
        ? `${project.drivers.length} outlet${project.drivers.length===1?"":"s"} aligned to the shared nozzle face. Separate bore positions are retained; only the terminal faces may touch the shell.`
        : "Outlets are positioned independently. Detect the nozzle to align their end faces.";
}
function showPreset() {
    const s = catalog.find((s) => s.id === Number($("preset").value));
    if (!s) return;
    $("driverNote").textContent =
        `${s.size_mm.map((x) => x.toFixed(2)).join(" × ")} mm · ${s.supplier_dimensioned ? "Supplier package dimensions" : "Planning package dimensions"}. ${s.note}`;
    $("driverSource").href=s.source_url;
    const i=hardware.driver_interfaces.find(i=>i.preset_id===s.id);
    $("driverInterface").textContent=i ? i.note : "Exact terminal coordinates and pin numbering are not verified for this preset. The harness uses a provisional approach anchor; confirm the ordered-part drawing before wiring.";
}
function showHardware() {
    const model=hardware.connectors.find(m=>m.id===$("pinModel").value);
    $("pinNote").textContent=model ? `${model.size_mm.map(v=>v.toFixed(2)).join(" × ")} mm including solder tails · Manufacturer nominal dimensions. ${model.shape}.` : "Custom rectangular envelope. Enter the complete body, pins and solder allowance from your socket drawing. +Z is the mating face.";
    $("pinDetails").textContent=model ? `${model.note} ${model.wiring}` : "Confirm the ordered-part drawing, pin assignments and assembly allowance before manufacture.";
    $("pinSource").hidden=!model;
    if(model) $("pinSource").href=model.source_url;
    for(let i=0;i<3;i++) $("pinSize"+i).disabled=busy || !!model;
}
function showPlacementChecks() {
    const checks = built.placement_checks || [];
    const counts = Object.fromEntries(["error", "warning", "unverified"].map(status => [status, checks.filter(c => c.status === status).length]));
    $("placementStatus").textContent = checks.length
        ? `${counts.error} ERROR${counts.error === 1 ? "" : "S"} · ${counts.warning} WARNING${counts.warning === 1 ? "" : "S"} · ${counts.unverified} UNVERIFIED`
        : "PLACEMENT CHECKS UNAVAILABLE";
    $("placementStatus").classList.toggle("error", counts.error > 0);
    $("placementChecks").replaceChildren(...checks.filter(c => c.status !== "pass").sort((a, b) =>
        ["error", "warning", "unverified"].indexOf(a.status) - ["error", "warning", "unverified"].indexOf(b.status)
    ).map(check => {
        const li = document.createElement("li");
        li.dataset.status = check.status;
        const label = document.createElement("strong");
        label.textContent = `${check.status.toUpperCase()} · `;
        const message = document.createElement("span");
        message.textContent = check.message;
        li.append(label, message);
        const partId = check.part_ids.find(id => id !== "shell");
        const driverId = partId?.startsWith("path:") ? partId.slice(5) : partId;
        if (project.drivers.some(d => d.id === driverId)) {
            const button = document.createElement("button");
            button.type = "button";
            button.disabled = busy;
            button.textContent = "SELECT DRIVER";
            button.onclick = guarded(async () => {
                if (busy) return;
                $("driverSelect").value = driverId;
                await $("driverSelect").onchange();
            });
            li.append(button);
        }
        return li;
    }));
}
function accept(result) {
    // A previous download describes the old accepted geometry.
    $("downloadFile").hidden = true;
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = undefined;
    window.HCDesignBridge?.changed();
    project = result.project;
    built = result.built;
    if (!project.drivers.some((d) => d.id === selected))
        selected = project.drivers[0]?.id;
    $("projectName").value = project.name;
    project.shell_scale.forEach((x, i) => ($(`scale${i}`).value = x));
    $("mirrored").checked = project.mirrored;
    showConstruction();
    showAssembly();
    $("shellName").textContent = result.sourceName;
    $("driverSelect").replaceChildren(
        ...project.drivers.map((d, i) =>
            option(
                d.id,
                `${String(i + 1).padStart(2, "0")} · ${catalog.find((s) => s.id === d.preset)?.name || "Driver"}`,
            ),
        ),
    );
    $("driverSelect").value = selected || "";
    $("driverCount").textContent = `${project.drivers.length} / 12`;
    $("shellSize").textContent =
        `${built.shell.size_mm.map((x) => x.toFixed(1)).join(" × ")} mm`;
    $("meshStatus").textContent =
        `Shell: ${built.shell.triangles.toLocaleString()} triangles · ${built.shell.boundary_edges} boundary edges · ${built.shell.nonmanifold_edges} nonmanifold edges · ${built.shell.inconsistent_edges} winding conflicts · ${built.shell.degenerate_triangles} degenerate faces.`;
    $("warnings").replaceChildren(
        ...built.warnings.filter(text => !built.placement_checks?.some(c => c.message === text)).map((text) => {
            const li = document.createElement("li");
            li.textContent = text;
            return li;
        }),
    );
    showPlacementChecks();
    const blockers = built.export_blockers || [];
    $("exportStatus").textContent = blockers.length
        ? `STL export blocked by ${blockers.length} placement or containment check${blockers.length === 1 ? "" : "s"}. Parts must stay inside the shell, including tube outer walls. Fix the listed checks; you can still save this editable project.`
        : "Represented parts passed shell containment checks. STL previews are available; manufacturing qualification is separate.";
    $("exportStatus").classList.toggle("error", blockers.length > 0);
    const previous = $("exportPart").value;
    $("exportPart").replaceChildren(
        ...built.parts.filter(p => !["channel", "cable"].includes(p.kind)).map((p) => option(p.id, p.name)),
    );
    if (built.parts.some((p) => p.id === previous))
        $("exportPart").value = previous;
    const invalidParts = built.placement_checks.filter(c => c.status === "error"
        || (c.status !== "pass" && ["package-shell", "package-cavity", "tube-shell", "assembly-shell"].includes(c.code)))
        .flatMap(c => c.part_ids);
    viewer.setParts(built.parts, selected, !!built.construction, invalidParts);
    showDriver();
}
async function run(action, data, message = "Geometry updated.") {
    if (busy) return;
    setBusy(true);
    tell("Calculating geometry in Rust… Shell construction may take several seconds.");
    try {
        const undoable=["arrange", "route", "outlets", "nozzle", "mount"].includes(action);
        const before=undoable ? (await rpc("save")).file : undefined;
        const result = await rpc(action, data);
        if (undoable && result.built) arrangeUndo=before;
        if (result.built) {
            if (!undoable) arrangeUndo=undefined;
            accept(result);
        }
        const errors = result.built?.placement_checks?.filter(c => c.status === "error").length || 0;
        tell(errors ? `${message} ${errors} placement error${errors === 1 ? "" : "s"}; see Placement checks.` : message, errors > 0);
        return result;
    } catch (error) {
        tell(
            `${error.message || error} Previous accepted geometry is retained.`,
            true,
        );
    } finally {
        setBusy(false);
    }
}
let downloadUrl;
function download(data, name, type) {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(new Blob([data], { type }));
    const link = $("downloadFile");
    link.href = downloadUrl;
    link.download = name;
    link.textContent = `DOWNLOAD ${name}`;
    link.hidden = false;
    link.click();
}

function filename() {
    return (
        project.name.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80) ||
        "iem-workshop"
    );
}
function guarded(fn) {
    return async (...args) => {
        try {
            await fn(...args);
        } catch (e) {
            tell(e.message || String(e), true);
        }
    };
}
async function apply() {
    return run("build", { project: draft() });
}
async function start() {
    setBusy(true);
    if (!window.HCAuth)
        throw new Error("Authentication helper is unavailable.");
    const auth = await window.HCAuth.requireAdmin();
    if (!auth) return;
    viewer = createViewer($("viewport"));
    worker = new Worker(new URL("./workshop-worker.js?v=10", import.meta.url), {
        type: "module",
    });
    worker.onmessage = ({ data }) => {
        const request = pending.get(data.id);
        if (!request) return;
        pending.delete(data.id);
        data.ok ? request.resolve(data) : request.reject(new Error(data.error));
    };
    worker.onerror = () => {
        workerFailed = true;
        for (const request of pending.values())
            request.reject(
                new Error(
                    "The geometry worker could not load. Reload this page to retry.",
                ),
            );
        pending.clear();
        tell("Geometry worker failed to load. Reload to retry.", true);
    };
    const response = await fetch("./assets/workshop/drivers.json");
    if (!response.ok) throw new Error("Driver catalog could not load.");
    catalog = await response.json();
    const hardwareResponse=await fetch("./assets/workshop/hardware.json?v=1");
    if(!hardwareResponse.ok) throw new Error("Hardware catalog could not load.");
    hardware=await hardwareResponse.json();
    $("pinModel").append(...hardware.connectors.map(m=>option(m.id,m.name)));
    $("hardwareGuide").replaceChildren(...hardware.guidance.map(g=>{
        const p=document.createElement("p"),a=document.createElement("a");
        a.href=g.source_url;a.target="_blank";a.rel="noopener noreferrer";a.textContent=g.title;
        p.append(a,document.createTextNode(` — ${g.text}`));return p;
    }));
    $("preset").replaceChildren(...catalog.map((s) => option(s.id, s.name)));
    for (const prefix of ["position", "rotation", "bend", "end", "connectorPosition", "connectorSize", "connectorRotation", "pinSize", "pinPosition", "pinRotation", "boardSize", "boardPosition", "boardRotation", "faceplateNormal", "nozzleOrigin", "nozzleNormal"])
        for (let i = 0; i < 3; i++) {
            const label = document.createElement("label");
            label.textContent = ["X", "Y", "Z"][i];
            const input = document.createElement("input");
            input.type = "number";
            input.step = prefix === "rotation" ? "1" : "0.1";
            input.id = `${prefix}${i}`;
            if (prefix === "connectorPosition") input.value = [8,0,0][i];
            if (prefix === "connectorSize") input.value = [3,3,8][i];
            if (prefix === "connectorRotation") input.value = [0,90,0][i];
            const defaults={nozzleOrigin:[0,0,0],nozzleNormal:[0,1,0],faceplateNormal:[0,0,1],pinSize:[4,3,2],pinPosition:[-3,-4,1],pinRotation:[0,0,0],boardSize:[6,4,1.2],boardPosition:[2,-5,-2],boardRotation:[0,0,0]};
            if (defaults[prefix]) input.value=defaults[prefix][i];
            input.setAttribute("aria-label", `${prefix} ${["X", "Y", "Z"][i]}`);
            label.append(input);
            $(`${prefix}Fields`).append(label);
        }
    project.drivers = [newDriver()];
    $("apply").onclick = guarded(apply);
    $("pinModel").onchange=()=>{
        const model=hardware.connectors.find(m=>m.id===$("pinModel").value);
        if(model) model.size_mm.forEach((v,i)=>$("pinSize"+i).value=v);
        $("pinMounted").checked=false;showHardware();
    };
    $("pinMounted").onchange=()=>{if($("pinMounted").checked && !project.connector_mount){$("pinMounted").checked=false;$("pinMountStatus").textContent="Use Seat connector first to detect and verify a mounting surface.";}};
    $("seatConnector").onclick=guarded(()=>run("mount",{project:draft(),allowance:number("pinAllowance")},"Connector face seated on the shell. Opening synchronized; old harness routes cleared. Inspect the selected face, then Route cables."));
    $("viewConnector").onclick=()=>{if(project.connector_mount) viewer.viewNormal(project.connector_mount.normal.map((v,i)=>project.mirrored && i===0 ? -v : v));};
    $("nozzleEnabled").onchange=()=>$("nozzleFields").hidden=!$("nozzleEnabled").checked;
    $("alignNozzle").onclick=guarded(()=>run("nozzle",{project:draft(),driverId:selected},"All tube outlets aligned flush with the detected nozzle surface. Inspect the chosen face and bore spacing."));
    $("viewNozzle").onclick=()=>{ if(project.nozzle) viewer.viewNormal(project.nozzle.normal.map((v,i)=>project.mirrored && i===0 ? -v : v)); };
    $("faceplateAxis").onchange = () => $("faceplateNormal").hidden = $("faceplateAxis").value !== "normal";
    $("detectFaceplate").onclick = guarded(async () => {
        $("faceplateAxis").value = "auto";
        $("faceplateNormal").hidden = true;
        await apply();
    });
    $("assemblyEnabled").onchange=()=>$("assemblyFields").hidden=!$("assemblyEnabled").checked;
    for (const prefix of ["pin","board"]) $(prefix+"Enabled").onchange=()=>$(prefix+"Fields").hidden=!$(prefix+"Enabled").checked;
    $("channelMode").onchange=()=>{if ($("channelMode").value==="drilled") $("cutSoundPaths").checked=true;};
    for (const [id,action] of [["autoArrange","arrange"],["routeCables","route"],["extendOutlets","outlets"]]) $(id).onclick=guarded(async()=>{
        if(busy) return;
        const p=draft();
        const result=await run(action,{project:p,allowance:action==="arrange" && p.assembly?.connector ? number("pinAllowance") : undefined}, action==="outlets" ? "Drilled outlets extended to the shell. Inspect the openings and channel walls." : action==="arrange" ? `Assembly arranged${p.assembly?.connector ? " with the connector on the shell surface" : ""}. Inspect interfaces and clearances below.` : "Harness space routed. Electrical connections are unchanged.");
        if(result) setBusy(false);
    });
    $("undoArrange").onclick=guarded(async()=>{if(arrangeUndo) await run("open",{file:arrangeUndo},"Previous layout restored.");});
    $("driverSelect").onchange = guarded(async () => {
        const next = $("driverSelect").value;
        const result = await apply();
        if (result) {
            selected = next;
            $("driverSelect").value = next;
            showDriver();
        } else $("driverSelect").value = selected || "";
    });
    $("preset").onchange = showPreset;
    $("constructionEnabled").onchange = () => $("constructionFields").hidden = !$("constructionEnabled").checked;
    $("connectorShape").onchange = () => $("connectorFields").hidden = $("connectorShape").value === "none";
    $("addDriver").onclick = guarded(async () => {
        const p = draft();
        if (p.drivers.length >= 12)
            throw new Error("A maximum of 12 drivers is supported.");
        const d = newDriver(p.drivers.length, p.construction);
        p.drivers.push(d);
        const result = await run(p.construction?.drilled_channels ? "outlets" : "build", { project: p });
        if (result) {
            selected = d.id;
            $("driverSelect").value = selected;
            showDriver();
        }
    });
    $("duplicateDriver").onclick = guarded(async () => {
        const p = draft();
        if (p.drivers.length >= 12)
            throw new Error("A maximum of 12 drivers is supported.");
        const d = structuredClone(p.drivers.find((d) => d.id === selected));
        d.id = crypto.randomUUID();
        d.position_mm[0] += 3;
        p.drivers.push(d);
        const result = await run(p.construction?.drilled_channels ? "outlets" : "build", { project: p });
        if (result) {
            selected = d.id;
            $("driverSelect").value = selected;
            showDriver();
        }
    });
    $("removeDriver").onclick = guarded(() => {
        const p = draft();
        p.drivers = p.drivers.filter((d) => d.id !== selected);
        return run("build", { project: p });
    });
    $("resetView").onclick = () => viewer.reset();
    for (const id of ["showShell", "showPaths", "showFaceplate"])
        $(id).onchange = () =>
            viewer.visibility($("showShell").checked, $("showPaths").checked, $("showFaceplate").checked);
    $("saveProject").onclick = guarded(async () => {
        if (!(await apply())) return;
        const result = await run("save", {}, "Project file ready to download.");
        if (result)
            download(
                JSON.stringify(result.file),
                `${filename()}.hcworkshop.json`,
                "application/json",
            );
    });
    $("loadProject").onclick = () => $("projectFile").click();
    $("projectFile").onchange = guarded(async (e) => {
        const file = e.target.files[0];
        e.target.value = "";
        if (!file) return;
        if (file.size > 32 * 1024 * 1024)
            throw new Error("Project files must be under 32 MB.");
        await run(
            "open",
            { file: JSON.parse(await file.text()) },
            "Project opened.",
        );
    });
    $("importShell").onclick = () => $("shellFile").click();
    $("shellFile").onchange = guarded(async (e) => {
        const file = e.target.files[0];
        e.target.value = "";
        if (!file) return;
        if (file.size > 16 * 1024 * 1024)
            throw new Error("STL files must be under 16 MB.");
        const p = draft();
        p.shell_scale = [1, 1, 1];
        await run(
            "import",
            {
                bytes: await file.arrayBuffer(),
                unit: Number($("importUnits").value),
                name: file.name,
                project: p,
            },
            "Shell imported and centred. Inspect driver placement in the new shell.",
        );
    });
    $("exportStl").onclick = guarded(async () => {
        const part = $("exportPart").value;
        if (!(await apply())) return;
        const result = await run(
            "export",
            { part },
            "STL ready to download in millimetres.",
        );
        if (result)
            download(
                result.bytes,
                `${filename()}-${result.name.replace(/[^a-zA-Z0-9_-]+/g, "-")}.stl`,
                "model/stl",
            );
    });
    $("exportPaths").onclick = guarded(async () => {
        if (!(await apply())) return;
        download(
            JSON.stringify(
                {
                    format: "hc-workshop-path-dimensions",
                    version: 1,
                    project: project.name,
                    units: "mm",
                    note: "Geometric dimensions only. Assign measured driver data in the acoustic designer. No frequency response or physical validation is implied.",
                    placement_checks: built.placement_checks,
                    construction: built.construction,
                    paths: built.paths.map((path) => ({
                        ...path,
                        inner_diameter_mm: project.drivers.find(
                            (d) => d.id === path.driver_id,
                        ).inner_diameter_mm,
                    })),
                },
                null,
                2,
            ),
            `${filename()}-path-dimensions.json`,
            "application/json",
        );
        tell("Path dimensions exported.");
    });
    const shellResponse = await fetch("./assets/workshop/solid-shell.stl");
    if (!shellResponse.ok) throw new Error("Starter shell could not load.");
    setBusy(false);
    await run(
        "import",
        {
            bytes: await shellResponse.arrayBuffer(),
            unit: 1,
            name: "HeadphoneWorkshop starter",
            project,
        },
        "Ready. Geometry is calculated by Rust / WebAssembly.",
    );
    if (!built) throw new Error("Initial geometry did not load.");
    const snapshot = async () => ({file: (await rpc("save")).file, paths: structuredClone(built.paths)});
    window.HCDesignBridge?.connect("geometry", {
        snapshot,
        flush: async () => {
            if (!(await apply())) throw new Error($("status").textContent);
            return snapshot();
        },
        open: async file => {
            if (!(await run("open", {file}, "Shared project geometry loaded."))) throw new Error($("status").textContent);
            return snapshot();
        },
    });
}
start().catch((error) => {
    setBusy(true);
    tell(`Unable to start workshop: ${error.message || error}`, true);
});
