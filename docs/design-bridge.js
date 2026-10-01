// Same-origin editor adapter. The studio reads these APIs directly from its
// own iframe windows; no permissive cross-origin postMessage receiver is used.
(() => {
    const embedded =
        window.parent !== window &&
        new URLSearchParams(location.search).get("embedded") === "1";
    if (embedded) document.documentElement.classList.add("design-embedded");
    let timer;
    window.HCDesignBridge = {
        embedded,
        connect(kind, adapter) {
            window.HCDesignAdapter = { kind, ...adapter };
            window.dispatchEvent(new Event("hc-design-ready"));
        },
        changed() {
            clearTimeout(timer);
            timer = setTimeout(
                () => window.dispatchEvent(new Event("hc-design-change")),
                180,
            );
        },
    };
    // Draft input is unsaved even before blur or a successful geometry build.
    // Keep this separate from accepted-state changes so programmatic rebuilds
    // after Save do not immediately mark the same project dirty again.
    document.addEventListener("input", () => {
        if (embedded) window.dispatchEvent(new Event("hc-design-draft"));
    });
    document.addEventListener("change", () => window.HCDesignBridge.changed());
})();
