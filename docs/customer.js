/* =========================================================
   HAMMER CRAFT
   CUSTOMER ACCOUNT
   customer.js
========================================================= */

"use strict";


let customerState = null;


function customerEscape(value) {

    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

}


function customerDate(value) {

    if (!value) {
        return "—";
    }


    const date =
        new Date(value);


    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return "—";
    }


    return date.toLocaleDateString(
        "en-GB",
        {
            day: "2-digit",
            month: "short",
            year: "numeric"
        }
    );

}


function setCustomerText(
    id,
    value
) {

    const element =
        document.getElementById(id);


    if (element) {
        element.textContent = value;
    }

}


function renderCustomerProfile() {

    const user =
        customerState.user;


    const profile =
        customerState.profile;


    setCustomerText(
        "customerEmail",
        profile?.email ||
        user?.email ||
        "ACCOUNT"
    );


    setCustomerText(
        "profileEmail",
        profile?.email ||
        user?.email ||
        "—"
    );


    setCustomerText(
        "profileUserId",
        user?.id ||
        "—"
    );


    setCustomerText(
        "profileCreatedAt",
        customerDate(
            profile?.created_at ||
            user?.created_at
        )
    );

}


async function loadCustomerOrders() {

    const container =
        document.getElementById(
            "customerOrderList"
        );


    if (!container) {
        return;
    }


    const {
        data,
        error
    } = await window.hcSupabase
        .from("orders")
        .select(`
            id,
            order_number,
            status,
            created_at,
            updated_at
        `)
        .eq(
            "user_id",
            customerState.user.id
        )
        .order(
            "created_at",
            {
                ascending: false
            }
        );


    if (error) {

        console.error(
            "Customer orders:",
            error
        );


        setCustomerText(
            "customerOrderCount",
            "—"
        );


        container.innerHTML = `
            <div class="loading-card">
                Unable to load your orders.
            </div>
        `;

        return;

    }


    const orders =
        data || [];


    setCustomerText(
        "customerOrderCount",
        orders.length
    );


    if (
        orders.length === 0
    ) {

        container.innerHTML = `
            <div class="loading-card">
                No orders yet.
            </div>
        `;

        return;

    }


    container.innerHTML =
        orders.map(
            order => `
                <article class="customer-card">
                    <span class="customer-card-label">
                        ${customerEscape(
                            String(
                                order.status ||
                                "pending"
                            ).toUpperCase()
                        )}
                    </span>

                    <h3>
                        ${customerEscape(
                            order.order_number ||
                            order.id
                        )}
                    </h3>

                    <p>
                        ${customerDate(
                            order.created_at
                        )}
                    </p>

                    <a
                        href="order.html?id=${
                            encodeURIComponent(order.id)
                        }"
                        class="outline-button"
                    >
                        VIEW ORDER
                    </a>
                </article>
            `
        ).join("");

}


async function loadCustomerScans() {

    const container =
        document.getElementById(
            "customerEarScanList"
        );


    if (!container) {
        return;
    }


    const {
        data,
        error
    } = await window.hcSupabase
        .from("ear_scans")
        .select(`
            id,
            order_id,
            status,
            left_image_count,
            right_image_count,
            left_stl_path,
            right_stl_path,
            error_message,
            created_at,
            updated_at
        `)
        .eq(
            "user_id",
            customerState.user.id
        )
        .order(
            "created_at",
            {
                ascending: false
            }
        );


    if (error) {

        console.error(
            "Customer scans:",
            error
        );


        setCustomerText(
            "customerScanCount",
            "—"
        );


        container.innerHTML = `
            <div class="loading-card">
                Unable to load your ear scans.
            </div>
        `;

        return;

    }


    const scans =
        data || [];


    setCustomerText(
        "customerScanCount",
        scans.length
    );


    if (
        scans.length === 0
    ) {

        container.innerHTML = `
            <div class="loading-card">
                No ear scans yet.
            </div>
        `;

        return;

    }


    container.innerHTML =
        scans.map(
            scan => `
                <article class="customer-card">
                    <span class="customer-card-label">
                        ${customerEscape(
                            String(
                                scan.status ||
                                "unknown"
                            ).toUpperCase()
                        )}
                    </span>

                    <h3>
                        EAR SCAN
                    </h3>

                    <p>
                        ${customerDate(
                            scan.created_at
                        )}
                    </p>

                    <p>
                        LEFT ${Number(
                            scan.left_image_count || 0
                        )} / RIGHT ${Number(
                            scan.right_image_count || 0
                        )} IMAGES
                    </p>

                    ${
                        scan.error_message
                        ? `
                            <p class="customer-error">
                                ${customerEscape(
                                    scan.error_message
                                )}
                            </p>
                        `
                        : ""
                    }
                </article>
            `
        ).join("");

}


function loadCustomerTuningStatus() {

    const saved =
        localStorage.getItem(
            "hammerCraftCustomTuning"
        );


    setCustomerText(
        "customerTuningCount",
        saved ? "1" : "0"
    );


    const notice =
        document.getElementById(
            "savedTuningNotice"
        );


    if (notice) {
        notice.hidden = !saved;
    }

}


async function logoutCustomer() {

    try {

        await window.HCAuth
            .logout();

    }

    catch (error) {

        console.error(
            "Customer logout:",
            error
        );

        alert(
            error.message ||
            "Unable to log out."
        );

    }

}


async function startCustomerAccount() {

    try {

        if (!window.HCAuth) {
            throw new Error(
                "Authentication helper did not load."
            );
        }


        const state =
            await window.HCAuth
                .requireCustomer();


        if (!state) {
            return;
        }


        customerState = state;


        renderCustomerProfile();
        loadCustomerTuningStatus();


        await Promise.all([
            loadCustomerOrders(),
            loadCustomerScans()
        ]);

    }

    catch (error) {

        console.error(
            "Customer account startup:",
            error
        );

    }

}


document.getElementById(
    "customerLogoutButton"
)?.addEventListener(
    "click",
    logoutCustomer
);


document.addEventListener(
    "DOMContentLoaded",
    startCustomerAccount
);
