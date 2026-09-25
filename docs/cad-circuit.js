/* Electrical graph and wire geometry for the IEM schematic editor.
 * Coordinates never imply a connection. Wires and shared legacy node IDs do.
 */
(function () {
    "use strict";
    const clone = value => structuredClone(value);
    const id = () => crypto.randomUUID();
    const samePoint = (a, b) => a.x === b.x && a.y === b.y;

    function endpointNode(circuit, endpoint, fallback) {
        if (endpoint?.componentId) {
            const component = circuit.components.find(c => c.id === endpoint.componentId && c.kind !== "wire");
            return component ? component[endpoint.side === "a" ? "nodeA" : "nodeB"] : null;
        }
        if (endpoint?.driverTerminal) return endpoint.driverTerminal === "plus" ? circuit.output : circuit.ground;
        return endpoint?.nodeId || fallback;
    }

    function routeSegment(a, b, mode = "orthogonal") {
        if (mode === "free" || a.x === b.x || a.y === b.y) return [a, b];
        if (mode === "45") {
            const dx = b.x - a.x, dy = b.y - a.y;
            const diagonal = Math.min(Math.abs(dx), Math.abs(dy));
            return [a, { x: a.x + Math.sign(dx) * diagonal, y: a.y + Math.sign(dy) * diagonal }, b];
        }
        const midX = (a.x + b.x) / 2;
        return [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b];
    }

    function wirePoints(a, b, wire = {}) {
        // Explicit waypoints survive completion and movement. Auto routes are
        // regenerated from the current terminal positions on every render.
        const anchors = [a, ...(wire.route || []), b];
        const mode = wire.routing || "free"; // preserve old hand-routed projects
        const points = [];
        for (let i = 1; i < anchors.length; i++) {
            for (const p of routeSegment(anchors[i - 1], anchors[i], mode)) {
                if (!points.length || !samePoint(points.at(-1), p)) points.push({ x: p.x, y: p.y });
            }
        }
        return points;
    }

    function createWire(circuit, endpointA, endpointB, options = {}) {
        const nodeA = endpointNode(circuit, endpointA), nodeB = endpointNode(circuit, endpointB);
        if (!nodeA || !nodeB || nodeA === nodeB) return null;
        const duplicate = circuit.components.some(c => c.kind === "wire" && (
            (endpointNode(circuit, c.endpointA, c.nodeA) === nodeA && endpointNode(circuit, c.endpointB, c.nodeB) === nodeB) ||
            (endpointNode(circuit, c.endpointA, c.nodeA) === nodeB && endpointNode(circuit, c.endpointB, c.nodeB) === nodeA)));
        if (duplicate) return null;
        const wire = { id: id(), kind: "wire", label: options.label || "WIRE", value: 0,
            nodeA, nodeB, endpointA: clone(endpointA), endpointB: clone(endpointB),
            route: clone(options.route || []), routing: options.routing || "orthogonal" };
        circuit.components.push(wire);
        return wire;
    }

    function pruneNodes(circuit) {
        const used = new Set([circuit.input, circuit.output, circuit.ground]);
        for (const component of circuit.components) {
            used.add(component.nodeA); used.add(component.nodeB);
        }
        circuit.nodes = circuit.nodes.filter(n => used.has(n.id) || n.connectPoint || !n.hidden);
    }

    function makeEditable(circuit) {
        // Legacy generators connected parts by assigning the same node ID.
        // Give each physical pin its own ID and expose each shared net as wires.
        // Call after generation, since generators may still advance circuit.output.
        if (circuit.output === circuit.input && circuit.output !== circuit.ground) {
            circuit.output = id();
            circuit.nodes.push({ id: circuit.output, label: "DRIVER +", x: 762, y: 120, hidden: true });
            createWire(circuit, { nodeId: circuit.input }, { nodeId: circuit.output, driverTerminal: "plus" });
        }
        const original = clone(circuit.components);
        for (const component of circuit.components.filter(c => c.kind !== "wire")) {
            for (const side of ["a", "b"]) {
                const field = side === "a" ? "nodeA" : "nodeB";
                const nodeId = component[field];
                const node = circuit.nodes.find(n => n.id === nodeId);
                if (!node) continue;
                const shared = original.some(c => c.id !== component.id && (
                    (c.nodeA === nodeId && (c.kind !== "wire" || !c.endpointA?.componentId)) ||
                    (c.nodeB === nodeId && (c.kind !== "wire" || !c.endpointB?.componentId))));
                if (!shared && ![circuit.input, circuit.output, circuit.ground].includes(nodeId)) continue;
                const pin = id();
                circuit.nodes.push({ id: pin, label: `${component.label || "PART"}${side.toUpperCase()}`, x: node.x, y: node.y, hidden: true });
                component[field] = pin;
                const anchor = { nodeId };
                if (nodeId === circuit.output) anchor.driverTerminal = "plus";
                else if (![circuit.input, circuit.ground].includes(nodeId)) {
                    node.hidden = false; node.connectPoint = true;
                }
                createWire(circuit, { componentId: component.id, side, nodeId: pin }, anchor);
            }
        }
        for (const wire of circuit.components.filter(c => c.kind === "wire")) {
            for (const side of ["A", "B"]) {
                const node = endpointNode(circuit, wire[`endpoint${side}`], wire[`node${side}`]);
                if (!node) continue;
                wire[`node${side}`] = node;
                if (wire[`endpoint${side}`]) wire[`endpoint${side}`].nodeId = node;
            }
        }
    }

    function removeComponent(circuit, componentId) {
        circuit.components = circuit.components.filter(c => c.id !== componentId &&
            c.endpointA?.componentId !== componentId && c.endpointB?.componentId !== componentId);
        pruneNodes(circuit);
    }

    function duplicateComponent(circuit, original, label, offset = 40) {
        if (!original || original.kind === "wire") return null;
        const copy = clone(original);
        copy.id = id(); copy.label = label;
        copy.x = Math.max(60, Math.min(740, (Number(copy.x) || 400) + offset));
        copy.y = Math.max(40, Math.min(300, (Number(copy.y) || 160) + offset));
        // A copy always receives new pins, including when pasted into a different driver.
        copy.nodeA = id(); copy.nodeB = id();
        delete copy.endpointA; delete copy.endpointB;
        circuit.nodes.push(
            { id: copy.nodeA, label: `${label}A`, x: copy.x - 48, y: copy.y, hidden: true },
            { id: copy.nodeB, label: `${label}B`, x: copy.x + 48, y: copy.y, hidden: true });
        circuit.components.push(copy);
        return copy;
    }

    function splitWire(circuit, wireId, points, requested) {
        const wire = circuit.components.find(c => c.id === wireId && c.kind === "wire");
        if (!wire || points.length < 2) return null;
        let nearest;
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1], b = points[i];
            const dx = b.x - a.x, dy = b.y - a.y;
            const t = Math.max(0, Math.min(1, ((requested.x - a.x) * dx + (requested.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
            const p = { x: a.x + t * dx, y: a.y + t * dy };
            const distance = Math.hypot(p.x - requested.x, p.y - requested.y);
            if (!nearest || distance < nearest.distance) nearest = { ...p, distance, index: i };
        }
        if (Math.hypot(nearest.x - points[0].x, nearest.y - points[0].y) < 1 ||
            Math.hypot(nearest.x - points.at(-1).x, nearest.y - points.at(-1).y) < 1) return null;
        const junction = { id: id(), label: "JUNCTION", x: nearest.x, y: nearest.y, connectPoint: true };
        circuit.nodes.push(junction);
        circuit.components = circuit.components.filter(c => c.id !== wireId);
        const endpoint = { nodeId: junction.id };
        createWire(circuit, wire.endpointA || { nodeId: wire.nodeA }, endpoint,
            { routing: wire.routing || "free", route: points.slice(1, nearest.index) });
        createWire(circuit, endpoint, wire.endpointB || { nodeId: wire.nodeB },
            { routing: wire.routing || "free", route: points.slice(nearest.index, -1) });
        return junction;
    }

    function compile(circuit) {
        const errors = [], warnings = [];
        for (const port of ["input", "output", "ground"]) {
            if (!circuit[port] || !circuit.nodes.some(n => n.id === circuit[port])) {
                errors.push(`The circuit is missing its ${port} terminal.`);
            }
        }
        const parent = new Map();
        const add = node => { if (node && !parent.has(node)) parent.set(node, node); };
        [circuit.input, circuit.output, circuit.ground].forEach(add);
        circuit.nodes.forEach(n => add(n.id));
        const root = node => {
            if (!parent.has(node)) return null;
            let r = node;
            while (parent.get(r) !== r) r = parent.get(r);
            while (parent.get(node) !== node) { const next = parent.get(node); parent.set(node, r); node = next; }
            return r;
        };
        const join = (a, b) => { a = root(a); b = root(b); if (a && b && a !== b) parent.set(b, a); };
        const parts = [];
        for (const component of circuit.components) {
            const a = component.kind === "wire" ? endpointNode(circuit, component.endpointA, component.nodeA) : component.nodeA;
            const b = component.kind === "wire" ? endpointNode(circuit, component.endpointB, component.nodeB) : component.nodeB;
            if (!a || !b || !parent.has(a) || !parent.has(b)) {
                errors.push(`${component.label || "Component"}: a connection refers to a missing terminal.`);
                continue;
            }
            if (!["resistor", "capacitor", "inductor", "wire", "low_pass"].includes(component.kind)) {
                errors.push(`${component.label || "Component"}: unsupported component type.`); continue;
            }
            if (!["wire", "low_pass"].includes(component.kind) && !component.bypassed &&
                (!Number.isFinite(Number(component.value)) || Number(component.value) < 0 ||
                (component.kind !== "resistor" && Number(component.value) === 0))) {
                errors.push(`${component.label || "Component"}: enter a valid ${component.kind} value.`); continue;
            }
            if (component.kind === "wire" || component.kind === "low_pass" || component.bypassed ||
                (component.kind === "resistor" && Number(component.value) === 0)) join(a, b);
            parts.push({ ...component, nodeA: a, nodeB: b });
        }
        const input = root(circuit.input), output = root(circuit.output), ground = root(circuit.ground);
        if (input === ground) errors.push("Input is shorted to ground. Remove the short before calculating.");
        const branches = parts.filter(c => c.kind !== "wire" && c.kind !== "low_pass" && !c.bypassed &&
            !(c.kind === "resistor" && Number(c.value) === 0))
            .map(c => ({ ...c, nodeA: root(c.nodeA), nodeB: root(c.nodeB) })).filter(c => c.nodeA !== c.nodeB);
        const adjacency = new Map([...new Set([...parent.keys()].map(root))].map(n => [n, new Set()]));
        for (const c of branches) { adjacency.get(c.nodeA).add(c.nodeB); adjacency.get(c.nodeB).add(c.nodeA); }
        const visit = (seeds, avoid = null) => {
            const seen = new Set(seeds.filter(n => n !== avoid)); const queue = [...seen];
            for (const n of queue) for (const next of adjacency.get(n) || []) {
                if (next !== avoid && !seen.has(next)) { seen.add(next); queue.push(next); }
            }
            return seen;
        };
        if (output === ground) warnings.push("The driver is shorted to ground and will produce no output.");
        else if (!visit([input], ground).has(output)) errors.push("Driver + is not connected to the input. Complete the signal path.");
        const live = visit([input, ground, output]);
        const activeComponents = parts.filter(c => live.has(root(c.nodeA)) && live.has(root(c.nodeB)));
        const floating = parts.filter(c => c.kind !== "wire" && !live.has(root(c.nodeA)) && !live.has(root(c.nodeB)));
        if (floating.length) warnings.push(`Unconnected parts are excluded: ${floating.map(c => c.label || c.kind).join(", ")}.`);
        const components = branches.filter(c => live.has(c.nodeA) && live.has(c.nodeB));
        const used = new Set([input, output, ground]);
        components.forEach(c => { used.add(c.nodeA); used.add(c.nodeB); });
        return { errors, warnings, activeComponents,
            circuit: { input, output, ground, nodes: [...used].map(id => ({ id })), components, filters: circuit.filters || [] } };
    }

    window.HCCircuit = { endpointNode, wirePoints, createWire, pruneNodes, makeEditable, removeComponent, duplicateComponent, splitWire, compile };
})();
