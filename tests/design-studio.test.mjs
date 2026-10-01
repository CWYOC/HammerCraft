import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import * as model from "../docs/design-project.mjs";

const deferred = () => {
    let resolve;
    const promise = new Promise((r) => {
        resolve = r;
    });
    return { promise, resolve };
};
const clone = structuredClone;
async function studio() {
    const timers = new Map(),
        nodes = new Map(),
        events = new EventTarget();
    let timerId = 0;
    class Element extends EventTarget {
        value = "";
        textContent = "";
        children = [];
        dataset = {};
        hidden = false;
        classList = { toggle() {} };
        replaceChildren(...children) {
            this.children = children;
        }
        append(...children) {
            this.children.push(...children);
        }
        setAttribute() {}
        click() {
            return this.onclick?.();
        }
        set src(_url) {
            queueMicrotask(() => this.dispatchEvent(new Event("load")));
        }
    }
    const $ = (id) => {
        if (!nodes.has(id)) nodes.set(id, new Element());
        return nodes.get(id);
    };
    const file = {
        format: "hc-workshop-file",
        version: 1,
        shell: {},
        project: {
            format: "hc-headphone-workshop",
            version: 1,
            name: "Test design",
            drivers: [],
        },
    };
    const acoustic = {
        version: 3,
        name: "Test design",
        drivers: [
            {
                id: "a",
                name: "Test driver",
                path: [{ type: "tube", length: 10, diameter: 2 }],
                circuit: { nodes: [], components: [] },
            },
        ],
    };
    let geometry = clone(file),
        acoustics = clone(acoustic),
        rejectDraft = false,
        gate;
    let acousticReads = 0;
    const snapshot = async () => ({ file: clone(geometry), paths: [] });
    const ga = {
        snapshot,
        flush: async () => {
            if (rejectDraft) throw Error("Invalid geometry draft");
            if (gate) await gate.promise;
            return snapshot();
        },
        open: async (next) => {
            geometry = clone(next);
            return snapshot();
        },
    };
    const aa = {
        snapshot: () => {
            acousticReads++;
            return clone(acoustics);
        },
        flush: () => aa.snapshot(),
        validate: clone,
        open: (next) => {
            acoustics = clone(next);
            return clone(acoustics);
        },
        applyLinks: async (next) => {
            for (const d of acoustics.drivers)
                d.path = clone(
                    next.drivers.find((n) => n.id === d.id)?.path || d.path,
                );
            return clone(acoustics);
        },
    };
    for (const [id, adapter] of [
        ["geometryEditor", ga],
        ["acousticsEditor", aa],
    ]) {
        $(id).contentWindow = Object.assign(new EventTarget(), {
            HCDesignAdapter: adapter,
        });
    }
    $("studioName").value = "Test design";
    const document = {
        getElementById: $,
        createElement: () => new Element(),
        querySelectorAll: () => [],
    };
    const window = Object.assign(events, {
        HCAuth: { requireAdmin: async () => true },
    });
    const context = vm.createContext({
        document,
        window,
        ...model,
        structuredClone,
        TextEncoder,
        Event,
        Blob,
        crypto: globalThis.crypto,
        URL,
        fetch: async () => ({ ok: true, json: async () => [] }),
        localStorage: { getItem: () => null },
        setTimeout: (fn) => {
            const id = ++timerId;
            timers.set(id, fn);
            return id;
        },
        clearTimeout: (id) => timers.delete(id),
    });
    let source = fs.readFileSync(
        new URL("../docs/design-studio.js", import.meta.url),
        "utf8",
    );
    source = source.replace(
        /^import[\s\S]*?from "\.\/design-project\.mjs(?:\?v=\d+)?";/,
        "",
    );
    source =
        source.slice(0, source.lastIndexOf("start().catch")) +
        "\nwindow.test = { start, capture, operation, scheduleCapture, importFile, getProject: () => structuredClone(project) };";
    vm.runInContext(source, context);
    const api = window.test;
    await api.start();
    return {
        api,
        $,
        window,
        document,
        context,
        ga,
        aa,
        acoustic: () => acoustics,
        reads: () => acousticReads,
        rejectDraft: (value) => {
            rejectDraft = value;
        },
        holdGeometry: () => (gate = deferred()),
        draftEvent: () =>
            $("geometryEditor").contentWindow.dispatchEvent(
                new Event("hc-design-draft"),
            ),
        changeEvent: () =>
            $("acousticsEditor").contentWindow.dispatchEvent(
                new Event("hc-design-change"),
            ),
        runTimers: async () => {
            const batch = [...timers.values()];
            timers.clear();
            for (const fn of batch) await fn();
        },
    };
}

test("unapplied editor input warns before closing, without needing a geometry build", async () => {
    const s = await studio();
    s.draftEvent();
    const leave = new Event("beforeunload", { cancelable: true });
    s.window.dispatchEvent(leave);
    assert.equal(leave.defaultPrevented, true);
    assert.equal(s.$("projectState").textContent, "UNSAVED CHANGES");
});

test("typing a project name is unsaved before the field loses focus", async () => {
    const s = await studio();
    s.$("studioName").value = "Unblurred edit";
    s.$("studioName").oninput?.();
    const leave = new Event("beforeunload", { cancelable: true });
    s.window.dispatchEvent(leave);
    assert.equal(leave.defaultPrevented, true);
});

test("snapshot after a slow geometry build preserves newer acoustic path edits", async () => {
    const s = await studio(),
        pending = s.holdGeometry();
    const saving = s.api.capture(true);
    s.acoustic().drivers[0].path[0].length = 25;
    pending.resolve();
    await saving;
    assert.equal(s.acoustic().drivers[0].path[0].length, 25);
    assert.equal(s.api.getProject().acoustics.drivers[0].path[0].length, 25);
});

test("editor changes arriving during an operation are reconciled afterwards", async () => {
    const s = await studio(),
        pending = deferred(),
        reads = s.reads();
    const running = s.api.operation(() => pending.promise);
    s.acoustic().drivers[0].name = "Late file import";
    s.changeEvent();
    await s.runTimers();
    pending.resolve();
    await running;
    await s.runTimers();
    assert.ok(s.reads() > reads);
    assert.equal(
        s.api.getProject().acoustics.drivers[0].name,
        "Late file import",
    );
});

test("opening a valid saved project recovers from an invalid current geometry draft", async () => {
    const s = await studio(),
        saved = s.api.getProject();
    saved.name = "Recovered design";
    s.rejectDraft(true);
    await s.api.importFile(saved);
    assert.equal(s.$("studioName").value, "Recovered design");
});

test("a rejected name does not poison accepted shared state or block opening a saved project", async () => {
    const s = await studio(),
        saved = s.api.getProject();
    s.$("studioName").value = "中".repeat(67);
    await assert.rejects(s.api.capture(), /name/i);
    assert.equal(s.api.getProject().name, saved.name);
    await s.api.importFile(saved);
    assert.equal(s.$("studioName").value, saved.name);
});

test("importing an acoustic component preserves a valid unblurred shared name", async () => {
    const s = await studio(),
        acousticFile = s.api.getProject().acoustics;
    s.$("studioName").value = "My renamed design";
    await s.api.importFile(acousticFile);
    assert.equal(s.api.getProject().name, "My renamed design");
    assert.equal(s.$("studioName").value, "My renamed design");
});

test("a circuit-only import applies pending geometry instead of silently discarding it", async () => {
    const s = await studio(),
        acousticFile = s.api.getProject().acoustics;
    s.ga.flush = async () => {
        const result = await s.ga.snapshot();
        result.file.project.shell_scale = [1.2, 1, 1];
        return result;
    };
    await s.api.importFile(acousticFile);
    assert.deepEqual(
        Array.from(s.api.getProject().geometry.project.shell_scale),
        [1.2, 1, 1],
    );
});

test("saving clears draft state and a queued unchanged rebuild does not mark it dirty again", async () => {
    const s = await studio(),
        flush = s.ga.flush;
    s.ga.flush = async () => {
        const result = await flush();
        s.changeEvent();
        return result;
    };
    s.draftEvent();
    await s.$("saveAll").onclick();
    await s.runTimers();
    const leave = new Event("beforeunload", { cancelable: true });
    s.window.dispatchEvent(leave);
    assert.equal(leave.defaultPrevented, false);
    assert.equal(s.$("projectState").textContent, "DOWNLOAD READY");
    URL.revokeObjectURL(s.$("studioDownload").href);
});

test("editor bridge distinguishes draft input from accepted-state notifications", () => {
    const window = Object.assign(new EventTarget(), { parent: {} });
    const document = Object.assign(new EventTarget(), {
        documentElement: { classList: { add() {} } },
    });
    let drafts = 0,
        accepted = 0;
    window.addEventListener("hc-design-draft", () => drafts++);
    window.addEventListener("hc-design-change", () => accepted++);
    const timers = [];
    const context = vm.createContext({
        window,
        document,
        Event,
        URLSearchParams,
        location: { search: "?embedded=1" },
        setTimeout: (fn) => timers.push(fn),
        clearTimeout() {},
    });
    vm.runInContext(
        fs.readFileSync(
            new URL("../docs/design-bridge.js", import.meta.url),
            "utf8",
        ),
        context,
    );
    document.dispatchEvent(new Event("input"));
    assert.equal(drafts, 1);
    assert.equal(accepted, 0);
    window.HCDesignBridge.changed();
    timers.shift()();
    assert.equal(drafts, 1);
    assert.equal(accepted, 1);
});
