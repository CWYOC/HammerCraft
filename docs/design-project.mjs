// Shared project model. Neither STL coordinates nor circuit wire graphics are
// electrical connections: persistent IDs explicitly join the two representations.
export const FORMAT = "hc-design-project";
const clone = (value) => structuredClone(value);
const object = (value) =>
    value && typeof value === "object" && !Array.isArray(value);
const stringId = (value) =>
    typeof value === "string" && /^[A-Za-z0-9_.-]{1,200}$/.test(value);
function unique(items, label) {
    const ids = new Set();
    for (const item of items) {
        if (!object(item) || !stringId(item.id) || ids.has(item.id))
            throw new Error(`${label} IDs must be unique and non-empty.`);
        ids.add(item.id);
    }
}
export function validateProject(input) {
    if (!object(input) || input.format !== FORMAT || input.version !== 1)
        throw new Error("Open a version 1 .hcdesign.json project.");
    if (
        !stringId(input.id) ||
        typeof input.name !== "string" ||
        input.name.length > 200
    )
        throw new Error("Invalid project identity/name.");
    const g = input.geometry,
        a = input.acoustics;
    if (
        !object(g) ||
        g.format !== "hc-workshop-file" ||
        g.version !== 1 ||
        g.project?.format !== "hc-headphone-workshop" ||
        g.project.version !== 1 ||
        !object(g.shell)
    )
        throw new Error("Project has no valid workshop section.");
    if (
        !Array.isArray(g.project.drivers) ||
        g.project.drivers.length > 12 ||
        !object(a) ||
        a.version !== 3 ||
        !Array.isArray(a.drivers) ||
        a.drivers.length > 128
    )
        throw new Error("Invalid driver lists or acoustic project version.");
    unique(g.project.drivers, "Geometry driver");
    unique(a.drivers, "Acoustic driver");
    for (const d of a.drivers) {
        if (
            !Array.isArray(d.path) ||
            !object(d.circuit) ||
            !Array.isArray(d.circuit.nodes) ||
            !Array.isArray(d.circuit.components)
        )
            throw new Error("Acoustic drivers need paths and circuit graphs.");
        unique(
            d.path.filter((p) => p.id !== undefined),
            "Acoustic section",
        );
    }
    if (!Array.isArray(input.links) || input.links.length > 12)
        throw new Error("Invalid driver links.");
    unique(input.links, "Link");
    const geometry = new Set(),
        sections = new Set();
    for (const link of input.links) {
        if (
            ![link.geometryDriverId, link.acousticDriverId, link.tubeId].every(
                stringId,
            ) ||
            !Number.isInteger(link.geometryPreset)
        )
            throw new Error("Invalid link identity.");
        const section = JSON.stringify([link.acousticDriverId, link.tubeId]);
        if (geometry.has(link.geometryDriverId) || sections.has(section))
            throw new Error("A route or acoustic tube cannot be linked twice.");
        geometry.add(link.geometryDriverId);
        sections.add(section);
    }
    return clone(input);
}
export function createProject(geometry, acoustics, id) {
    return validateProject({
        format: FORMAT,
        version: 1,
        id,
        name: geometry.project.name || "Untitled IEM",
        geometry,
        acoustics,
        links: [],
    });
}
export function connectTube(
    input,
    { geometryDriverId, acousticDriverId, tubeIndex, id },
) {
    const project = validateProject(input),
        g = project.geometry.project.drivers.find(
            (d) => d.id === geometryDriverId,
        ),
        a = project.acoustics.drivers.find((d) => d.id === acousticDriverId);
    if (
        !g ||
        !a ||
        !Number.isInteger(tubeIndex) ||
        a.path[tubeIndex]?.type !== "tube"
    )
        throw new Error(
            "Select a geometry driver, acoustic driver and tube section.",
        );
    const tube = a.path[tubeIndex];
    if (!tube.id) tube.id = `tube-${id}`;
    project.links.push({
        id,
        geometryDriverId,
        acousticDriverId,
        tubeId: tube.id,
        geometryPreset: g.preset,
    });
    return validateProject(project);
}
export function disconnectTube(input, id) {
    const project = validateProject(input);
    project.links = project.links.filter((l) => l.id !== id);
    return project;
}
// Only accepted Rust geometry may supply these metrics. Never trust metrics
// persisted in an imported file: the studio rebuilds geometry before calling us.
export function synchronize(input, paths) {
    const project = validateProject(input),
        statuses = [];
    for (const d of project.acoustics.drivers) {
        delete d.geometryLinkError;
        for (const p of d.path) delete p.geometryBinding;
    }
    for (const link of project.links) {
        const g = project.geometry.project.drivers.find(
                (d) => d.id === link.geometryDriverId,
            ),
            a = project.acoustics.drivers.find(
                (d) => d.id === link.acousticDriverId,
            );
        const tube = a?.path.find((p) => p.id === link.tubeId),
            metrics = paths.find((p) => p.driver_id === link.geometryDriverId);
        let error = !g
            ? "3D driver removed. Relink or unlink this route."
            : !a
              ? "Acoustic driver removed. Relink or unlink this route."
              : g.preset !== link.geometryPreset
                ? "3D package changed. Verify driver identity and relink."
                : tube?.type !== "tube"
                  ? "Linked acoustic tube removed or replaced. Relink or unlink this route."
                  : null;
        if (
            !error &&
            (!Number.isFinite(metrics?.length_mm) ||
                metrics.length_mm <= 0 ||
                !Number.isFinite(g.inner_diameter_mm) ||
                g.inner_diameter_mm <= 0)
        )
            error = "Accepted 3D path dimensions are unavailable.";
        if (error) {
            if (a) a.geometryLinkError = error;
            if (tube)
                tube.geometryBinding = {
                    linkId: link.id,
                    geometryDriverId: link.geometryDriverId,
                    stale: true,
                };
            statuses.push({ id: link.id, ok: false, message: error });
            continue;
        }
        if (
            tube.length !== metrics.length_mm ||
            tube.diameter !== g.inner_diameter_mm
        )
            a.referenceValidationMode = false;
        tube.length = metrics.length_mm;
        tube.diameter = g.inner_diameter_mm;
        tube.geometryBinding = {
            linkId: link.id,
            geometryDriverId: link.geometryDriverId,
            stale: false,
        };
        statuses.push({
            id: link.id,
            ok: true,
            message: `${tube.length.toFixed(2)} mm · ${tube.diameter.toFixed(2)} mm bore`,
        });
    }
    return { project, statuses };
}
