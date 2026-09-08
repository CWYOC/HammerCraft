/* =========================================================
   HAMMER CRAFT
   STANDALONE IEM DESIGNER PAGE BOOTSTRAP
========================================================= */

"use strict";

(async () => {
    async function loadDesignerProducts() {
        if (!window.hcSupabase) return [];

        const { data, error } = await window.hcSupabase
            .from("products")
            .select("*")
            .order("display_order", { ascending: true });

        if (error) {
            console.warn("Unable to load products for IEM target selection:", error);
            return [];
        }

        return data || [];
    }

    async function startStandaloneDesigner() {
        try {
            if (!window.HCAuth) {
                throw new Error("Hammer Craft authentication helper is unavailable.");
            }

            const state = await window.HCAuth.requireAdmin();
            if (!state) return;

            const email = document.getElementById("designerAdminEmail");
            if (email) email.textContent = state.user?.email || "ADMIN";

            document.getElementById("designerLogoutButton")?.addEventListener("click", async () => {
                try {
                    await window.HCAuth.logout();
                } catch (error) {
                    console.error("Designer logout error:", error);
                    alert(error.message || "Unable to sign out.");
                }
            });

            if (!window.HCIemDesigner) {
                throw new Error("IEM designer module failed to load.");
            }

            const products = await loadDesignerProducts();
            window.HCIemDesigner.populateTargetProducts(products);
            window.HCIemDesigner.init();
        } catch (error) {
            console.error("Standalone IEM Designer startup error:", error);
            alert(`Unable to start IEM Designer: ${error.message}`);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", startStandaloneDesigner, { once: true });
    } else {
        startStandaloneDesigner();
    }
})();
