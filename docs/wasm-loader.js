"use strict";

(() => {
    let moduleRef = null;
    let loading = null;

    async function load() {
        if (moduleRef) return moduleRef;
        if (loading) return loading;

        loading = (async () => {
            const mod = await import("./wasm/acoustic_engine.js");
            if (typeof mod.default === "function") await mod.default();
            moduleRef = mod;
            return mod;
        })();

        return loading;
    }

    async function simulate(request) {
        const mod = await load();
        if (typeof mod.simulate_json !== "function") throw new Error("simulate_json() is unavailable.");
        return JSON.parse(mod.simulate_json(JSON.stringify(request)));
    }

    async function reverseDesign(request) {
        const mod = await load();
        if (typeof mod.reverse_design_json !== "function") throw new Error("reverse_design_json() is unavailable.");
        return JSON.parse(mod.reverse_design_json(JSON.stringify(request)));
    }

    async function version() {
        const mod = await load();
        return typeof mod.engine_version === "function" ? mod.engine_version() : "Rust/WASM";
    }

    window.HCAcousticEngine = {
        load,
        simulate,
        reverseDesign,
        version,
        isLoaded: () => Boolean(moduleRef)
    };
})();
