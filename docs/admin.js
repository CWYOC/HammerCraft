/* =========================================================
   HAMMER CRAFT
   ADMIN DASHBOARD
========================================================= */

"use strict";


/* =========================================================
   GLOBAL STATE
========================================================= */

let currentAdminUser =
    null;


let allProducts =
    [];


let allScans =
    [];


let allAccounts =
    [];


let parsedFrequencyResponse =
    [];


let confirmCallback =
    null;


/* =========================================================
   ELEMENT HELPERS

   Supports both the older Hammer Craft admin.html IDs
   and the newer IDs.
========================================================= */

function byId(
    ...ids
) {

    for (
        const id
        of
        ids
    ) {

        const element =
            document.getElementById(
                id
            );


        if (
            element
        ) {

            return element;

        }

    }


    return null;

}


function getValue(
    ...ids
) {

    const element =
        byId(
            ...ids
        );


    return (
        element?.value
        ??
        ""
    );

}


function setValue(
    value,
    ...ids
) {

    const element =
        byId(
            ...ids
        );


    if (
        element
    ) {

        element.value =
            value
            ??
            "";

    }

}


function getChecked(
    ...ids
) {

    const element =
        byId(
            ...ids
        );


    return Boolean(
        element?.checked
    );

}


function setChecked(
    value,
    ...ids
) {

    const element =
        byId(
            ...ids
        );


    if (
        element
    ) {

        element.checked =
            Boolean(
                value
            );

    }

}


/* =========================================================
   GENERAL HELPERS
========================================================= */

function escapeHtml(
    value
) {

    return String(
        value ?? ""
    )
        .replaceAll(
            "&",
            "&amp;"
        )
        .replaceAll(
            "<",
            "&lt;"
        )
        .replaceAll(
            ">",
            "&gt;"
        )
        .replaceAll(
            "\"",
            "&quot;"
        )
        .replaceAll(
            "'",
            "&#039;"
        );

}


function safeNumber(
    value,
    fallback = 0
) {

    const numeric =
        Number(
            value
        );


    return Number.isFinite(
        numeric
    )
        ?
        numeric
        :
        fallback;

}


function slugify(
    value
) {

    return String(
        value ?? ""
    )
        .toLowerCase()
        .trim()
        .replace(
            /[^a-z0-9]+/g,
            "-"
        )
        .replace(
            /^-+|-+$/g,
            ""
        );

}


function formatDate(
    value
) {

    if (
        !value
    ) {

        return "—";

    }


    const date =
        new Date(
            value
        );


    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return "—";

    }


    return date.toLocaleString(
        "en-GB"
    );

}


function toDateTimeLocalValue(
    value
) {

    if (
        !value
    ) {

        return "";

    }


    const date =
        new Date(
            value
        );


    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return "";

    }


    const pad =
        number =>
            String(
                number
            )
                .padStart(
                    2,
                    "0"
                );


    return (
        `${date.getFullYear()}-`
        +
        `${pad(date.getMonth() + 1)}-`
        +
        `${pad(date.getDate())}T`
        +
        `${pad(date.getHours())}:`
        +
        `${pad(date.getMinutes())}`
    );

}


/* =========================================================
   LABEL HELPERS
========================================================= */

function statusLabel(
    status
) {

    const labels = {

        coming_soon:
            "COMING SOON",

        in_stock:
            "IN STOCK",

        low_stock:
            "LOW STOCK",

        out_of_stock:
            "OUT OF STOCK",

        hidden:
            "HIDDEN"

    };


    return (
        labels[
            status
        ]
        ||
        String(
            status ?? ""
        )
            .replaceAll(
                "_",
                " "
            )
            .toUpperCase()
    );

}


function categoryLabel(
    category
) {

    const labels = {

        reference:
            "REFERENCE",

        custom_tune:
            "CUSTOM SOUND",

        custom_fit:
            "CUSTOM FIT",

        full_custom:
            "FULL CUSTOM"

    };


    return (
        labels[
            category
        ]
        ||
        String(
            category ?? ""
        )
            .replaceAll(
                "_",
                " "
            )
            .toUpperCase()
    );

}


function soundSignatureLabel(
    signature
) {

    const labels = {

        clear:
            "CLEAR",

        warm:
            "WARM",

        balanced:
            "BALANCED",

        classical:
            "CLASSICAL",

        vocal:
            "VOCAL",

        bass:
            "BASS FOCUSED",

        bright:
            "BRIGHT",

        smooth:
            "SMOOTH",

        v_shape:
            "V-SHAPE",

        studio:
            "STUDIO",

        custom:
            "CUSTOM"

    };


    return (
        labels[
            signature
        ]
        ||
        String(
            signature ?? ""
        )
            .replaceAll(
                "_",
                " "
            )
            .toUpperCase()
    );

}


function recommendedForLabel(
    value
) {

    const labels = {

        pop:
            "POP",

        rock:
            "ROCK",

        edm:
            "EDM",

        hiphop:
            "HIP-HOP",

        hip_hop:
            "HIP-HOP",

        classical:
            "CLASSICAL",

        jazz:
            "JAZZ",

        vocal:
            "VOCAL",

        studio:
            "STUDIO / MIXING",

        gaming:
            "GAMING",

        acoustic:
            "ACOUSTIC",

        electronic:
            "ELECTRONIC",

        all_round:
            "ALL-ROUND",

        allround:
            "ALL-ROUND"

    };


    return (
        labels[
            value
        ]
        ||
        String(
            value ?? ""
        )
            .replaceAll(
                "_",
                " "
            )
            .toUpperCase()
    );

}


/* =========================================================
   RECOMMENDED-FOR HELPERS
========================================================= */

function getCheckedRecommendedValues(
    selector
) {

    return Array
        .from(
            document.querySelectorAll(
                selector
            )
        )
        .filter(
            checkbox =>
                checkbox.checked
        )
        .map(
            checkbox =>
                checkbox.value
        );

}


function setCheckedRecommendedValues(
    selector,
    values
) {

    let normalizedValues =
        [];


    if (
        Array.isArray(
            values
        )
    ) {

        normalizedValues =
            values;

    }

    else if (
        typeof values ===
        "string"
    ) {

        normalizedValues =
            values
                .split(",")
                .map(
                    item =>
                        item.trim()
                )
                .filter(
                    Boolean
                );

    }


    const selected =
        new Set(
            normalizedValues
        );


    document
        .querySelectorAll(
            selector
        )
        .forEach(
            checkbox => {

                checkbox.checked =
                    selected.has(
                        checkbox.value
                    );

            }
        );

}


/* =========================================================
   MESSAGE
========================================================= */

function setMessage(
    elementId,
    message,
    type = ""
) {

    const element =
        document.getElementById(
            elementId
        );


    if (
        !element
    ) {

        return;

    }


    element.textContent =
        message
        ||
        "";


    element.classList.remove(
        "success",
        "error"
    );


    if (
        type
    ) {

        element.classList.add(
            type
        );

    }

}


/* =========================================================
   AUTH
========================================================= */

async function ensureAdmin() {

    if (
        !window.HCAuth
    ) {

        throw new Error(
            "Hammer Craft authentication helper is unavailable."
        );

    }


    const state =
        await window.HCAuth
            .requireAdmin();


    if (
        !state
    ) {

        return false;

    }


    currentAdminUser =
        state.user;


    const emailElement =
        byId(
            "adminEmail"
        );


    if (
        emailElement
    ) {

        emailElement.textContent =
            currentAdminUser.email
            ||
            "ADMIN";

    }


    return true;

}


/* =========================================================
   LOGOUT
========================================================= */

async function logoutAdmin() {

    try {

        await window.HCAuth
            .logout();

    }

    catch (
        error
    ) {

        console.error(
            "Admin logout error:",
            error
        );


        alert(
            error.message
            ||
            "Unable to sign out."
        );

    }

}


/* =========================================================
   CONFIRM MODAL
========================================================= */

function showConfirm(
    title,
    text,
    callback
) {

    confirmCallback =
        callback;


    const modal =
        byId(
            "confirmModal"
        );


    if (
        modal
    ) {

        const titleElement =
            byId(
                "confirmTitle"
            );


        const textElement =
            byId(
                "confirmText"
            );


        if (
            titleElement
        ) {

            titleElement.textContent =
                title;

        }


        if (
            textElement
        ) {

            textElement.textContent =
                text;

        }


        modal.classList.add(
            "open"
        );


        return;

    }


    if (
        window.confirm(
            `${title}\n\n${text}`
        )
    ) {

        Promise.resolve(
            callback?.()
        )
            .catch(
                error => {

                    console.error(
                        error
                    );

                }
            );

    }

}


function closeConfirm() {

    confirmCallback =
        null;


    byId(
        "confirmModal"
    )
        ?.classList
        .remove(
            "open"
        );

}


/* =========================================================
   ACCOUNTS
========================================================= */

async function loadAccounts() {

    const container =
        byId(
            "adminAccountList",
            "accountsGrid"
        );


    if (
        !container
    ) {

        return;

    }


    container.innerHTML =
        `<div class="loading-card">Loading accounts...</div>`;


    try {

        const {
            data,
            error
        } =
            await window.hcSupabase
                .from(
                    "profiles"
                )
                .select(`
                    id,
                    email,
                    full_name,
                    is_admin,
                    created_at
                `)
                .order(
                    "created_at",
                    {
                        ascending:
                            false
                    }
                );


        if (
            error
        ) {

            throw error;

        }


        allAccounts =
            data
            ||
            [];


        renderAccounts(
            allAccounts
        );


        updateAccountStats();

    }

    catch (
        error
    ) {

        console.error(
            "Account load error:",
            error
        );


        container.innerHTML =
            `<div class="loading-card">Unable to load accounts.</div>`;

    }

}


function renderAccounts(
    accounts
) {

    const container =
        byId(
            "adminAccountList",
            "accountsGrid"
        );


    if (
        !container
    ) {

        return;

    }


    if (
        accounts.length ===
        0
    ) {

        container.innerHTML =
            `<div class="loading-card">No accounts found.</div>`;


        return;

    }


    container.innerHTML =

        accounts
            .map(
                account => `

                    <article class="account-card">

                        <span class="card-label">

                            ${
                                account.is_admin
                                ?
                                "ADMIN"
                                :
                                "CUSTOMER"
                            }

                        </span>


                        <h3>

                            ${
                                escapeHtml(
                                    account.full_name
                                    ||
                                    "Unnamed account"
                                )
                            }

                        </h3>


                        <p>

                            ${
                                escapeHtml(
                                    account.email
                                    ||
                                    ""
                                )
                            }

                        </p>


                        <div class="account-meta">

                            <span>

                                CREATED

                                ${
                                    formatDate(
                                        account.created_at
                                    )
                                }

                            </span>

                        </div>

                    </article>

                `
            )
            .join("");

}


function setTextIfPresent(
    id,
    value
) {

    const element =
        byId(
            id
        );


    if (
        element
    ) {

        element.textContent =
            value;

    }

}


function updateAccountStats() {

    setTextIfPresent(
        "totalAccounts",
        allAccounts.length
    );


    setTextIfPresent(
        "accountSummaryTotal",
        allAccounts.length
    );


    const admins =
        allAccounts.filter(
            account =>
                account.is_admin ===
                true
        );


    setTextIfPresent(
        "totalAdmins",
        admins.length
    );


    const usersWithScans =
        new Set(
            allScans
                .map(
                    scan =>
                        scan.user_id
                )
                .filter(
                    Boolean
                )
        );


    setTextIfPresent(
        "accountsWithScans",
        usersWithScans.size
    );

}


/* =========================================================
   SCANS
========================================================= */

async function loadScans() {

    const container =
        byId(
            "adminScanList",
            "scansGrid"
        );


    if (
        !container
    ) {

        return;

    }


    container.innerHTML =
        `<div class="loading-card">Loading scans...</div>`;


    try {

        const {
            data,
            error
        } =
            await window.hcSupabase
                .from(
                    "ear_scans"
                )
                .select(
                    "*"
                )
                .order(
                    "created_at",
                    {
                        ascending:
                            false
                    }
                );


        if (
            error
        ) {

            throw error;

        }


        allScans =
            data
            ||
            [];


        renderScans();


        updateScanStats();


        updateAccountStats();

    }

    catch (
        error
    ) {

        console.error(
            "Scan load error:",
            error
        );


        container.innerHTML =
            `<div class="loading-card">Unable to load scans.</div>`;

    }

}


function renderScans() {

    const container =
        byId(
            "adminScanList",
            "scansGrid"
        );


    if (
        !container
    ) {

        return;

    }


    const filterElement =
        byId(
            "scanStatusFilter"
        );


    const filter =
        filterElement?.value
        ||
        "";


    let scans =
        allScans;


    if (
        filter
    ) {

        scans =
            scans.filter(
                scan =>
                    scan.status ===
                    filter
            );

    }


    if (
        scans.length ===
        0
    ) {

        container.innerHTML =
            `<div class="loading-card">No scans found.</div>`;


        return;

    }


    container.innerHTML =

        scans
            .map(
                scan => `

                    <article class="scan-card">

                        <div class="scan-card-top">

                            <span
                                class="status-badge ${
                                    escapeHtml(
                                        scan.status
                                        ||
                                        ""
                                    )
                                }"
                            >

                                ${
                                    escapeHtml(
                                        scan.status
                                        ||
                                        "unknown"
                                    )
                                }

                            </span>


                            <span>

                                ${
                                    formatDate(
                                        scan.created_at
                                    )
                                }

                            </span>

                        </div>


                        <h3>

                            ${
                                escapeHtml(
                                    scan.side
                                    ||
                                    "Ear scan"
                                )
                            }

                        </h3>


                        <p>

                            ID:
                            ${
                                escapeHtml(
                                    scan.id
                                )
                            }

                        </p>


                        ${
                            scan.error_message
                            ?
                            `

                                <p class="scan-error">

                                    ${
                                        escapeHtml(
                                            scan.error_message
                                        )
                                    }

                                </p>

                            `
                            :
                            ""
                        }


                        <div class="scan-actions">

                            <button
                                type="button"
                                onclick="queueScan('${scan.id}')"
                            >
                                PROCESS
                            </button>


                            <button
                                type="button"
                                onclick="retryScan('${scan.id}')"
                            >
                                RETRY
                            </button>


                            <button
                                type="button"
                                class="danger-button"
                                onclick="confirmDeleteScan('${scan.id}')"
                            >
                                DELETE
                            </button>

                        </div>

                    </article>

                `
            )
            .join("");

}


function updateScanStats() {

    setTextIfPresent(
        "totalScans",
        allScans.length
    );


    setTextIfPresent(

        "processingScans",

        allScans.filter(
            scan =>
                scan.status ===
                "processing"
        ).length

    );


    setTextIfPresent(

        "completeScans",

        allScans.filter(
            scan =>
                scan.status ===
                    "complete"
                ||
                scan.status ===
                    "completed"
        ).length

    );


    setTextIfPresent(

        "failedScans",

        allScans.filter(
            scan =>
                scan.status ===
                "failed"
        ).length

    );

}


async function queueScan(
    scanId
) {

    try {

        const {
            error
        } =
            await window.hcSupabase
                .from(
                    "ear_scans"
                )
                .update({

                    status:
                        "queued",

                    error_message:
                        null

                })
                .eq(
                    "id",
                    scanId
                );


        if (
            error
        ) {

            throw error;

        }


        await loadScans();

    }

    catch (
        error
    ) {

        console.error(
            "Queue scan error:",
            error
        );


        alert(
            error.message
        );

    }

}


async function retryScan(
    scanId
) {

    await queueScan(
        scanId
    );

}


/* =========================================================
   DELETE SCAN
========================================================= */

function confirmDeleteScan(
    scanId
) {

    showConfirm(

        "Delete scan?",

        "This permanently deletes the scan database entry and attempts to remove its storage files.",

        async () => {

            await deleteScan(
                scanId
            );

        }

    );

}


async function deleteScan(
    scanId
) {

    try {

        const scan =
            allScans.find(
                item =>
                    String(
                        item.id
                    )
                    ===
                    String(
                        scanId
                    )
            );


        if (
            scan?.storage_prefix
        ) {

            try {

                const {
                    data: files,
                    error: listError
                } =
                    await window.hcSupabase
                        .storage
                        .from(
                            "ear-scans"
                        )
                        .list(
                            scan.storage_prefix,
                            {
                                limit:
                                    1000
                            }
                        );


                if (
                    listError
                ) {

                    console.warn(
                        listError
                    );

                }


                if (
                    files?.length
                ) {

                    const paths =
                        files.map(
                            file =>
                                `${scan.storage_prefix}/${file.name}`
                        );


                    const {
                        error: removeError
                    } =
                        await window.hcSupabase
                            .storage
                            .from(
                                "ear-scans"
                            )
                            .remove(
                                paths
                            );


                    if (
                        removeError
                    ) {

                        console.warn(
                            removeError
                        );

                    }

                }

            }

            catch (
                storageError
            ) {

                console.warn(
                    "Unable to remove every scan storage file:",
                    storageError
                );

            }

        }


        const {
            error
        } =
            await window.hcSupabase
                .from(
                    "ear_scans"
                )
                .delete()
                .eq(
                    "id",
                    scanId
                );


        if (
            error
        ) {

            throw error;

        }


        closeConfirm();


        await loadScans();

    }

    catch (
        error
    ) {

        console.error(
            "Delete scan error:",
            error
        );


        alert(
            error.message
        );

    }

}


/* =========================================================
   PROCESSORS
========================================================= */

async function queryProcessors() {

    let result =
        await window.hcSupabase
            .from(
                "reconstruction_processors"
            )
            .select(
                "*"
            )
            .order(
                "last_seen_at",
                {
                    ascending:
                        false
                }
            );


    if (
        !result.error
    ) {

        return result;

    }


    console.warn(
        "reconstruction_processors unavailable, trying processors.",
        result.error
    );


    result =
        await window.hcSupabase
            .from(
                "processors"
            )
            .select(
                "*"
            )
            .order(
                "last_seen_at",
                {
                    ascending:
                        false
                }
            );


    return result;

}


async function loadProcessors() {

    const container =
        byId(
            "processorList",
            "processorsGrid"
        );


    if (
        !container
    ) {

        return;

    }


    container.innerHTML =
        `<div class="loading-card">Loading processors...</div>`;


    try {

        const {
            data,
            error
        } =
            await queryProcessors();


        if (
            error
        ) {

            throw error;

        }


        const processors =
            data
            ||
            [];


        if (
            processors.length ===
            0
        ) {

            container.innerHTML =
                `<div class="loading-card">No processors registered.</div>`;


            return;

        }


        container.innerHTML =

            processors
                .map(
                    processor => {

                        const lastSeen =
                            processor.last_seen_at
                            ?
                            new Date(
                                processor.last_seen_at
                            )
                            :
                            null;


                        const age =
                            lastSeen
                            ?
                            Date.now()
                            -
                            lastSeen.getTime()
                            :
                            Infinity;


                        const online =
                            age <
                            30000;


                        return `

                            <article class="processor-card">

                                <span
                                    class="status-badge ${
                                        online
                                        ?
                                        "complete"
                                        :
                                        "failed"
                                    }"
                                >

                                    ${
                                        online
                                        ?
                                        "ONLINE"
                                        :
                                        "OFFLINE"
                                    }

                                </span>


                                <h3>

                                    ${
                                        escapeHtml(
                                            processor.name
                                            ||
                                            processor.processor_name
                                            ||
                                            "Processor"
                                        )
                                    }

                                </h3>


                                <p>

                                    ${
                                        escapeHtml(
                                            processor.platform
                                            ||
                                            processor.os
                                            ||
                                            ""
                                        )
                                    }

                                </p>


                                <p>

                                    Accelerator:

                                    ${
                                        escapeHtml(
                                            processor.accelerator
                                            ||
                                            "Unknown"
                                        )
                                    }

                                </p>


                                <p>

                                    Last seen:

                                    ${
                                        formatDate(
                                            processor.last_seen_at
                                        )
                                    }

                                </p>

                            </article>

                        `;

                    }
                )
                .join("");

    }

    catch (
        error
    ) {

        console.error(
            "Processor load error:",
            error
        );


        container.innerHTML =
            `<div class="loading-card">Unable to load processors.</div>`;

    }

}


/* =========================================================
   PRODUCTS
========================================================= */

async function loadProducts() {

    const container =
        byId(
            "adminProductList",
            "productsGrid"
        );


    if (
        !container
    ) {

        return;

    }


    container.innerHTML =
        `<div class="loading-card">Loading products...</div>`;


    try {

        const {
            data,
            error
        } =
            await window.hcSupabase
                .from(
                    "products"
                )
                .select(
                    "*"
                )
                .order(
                    "display_order",
                    {
                        ascending:
                            true
                    }
                );


        if (
            error
        ) {

            throw error;

        }


        allProducts =
            data
            ||
            [];


        renderProducts();


        updateProductStats();


        populateFrProductSelect();


        populateReferenceProductSelect();

    }

    catch (
        error
    ) {

        console.error(
            "Product load error:",
            error
        );


        container.innerHTML =
            `<div class="loading-card">Unable to load products.</div>`;

    }

}


/* =========================================================
   PRODUCT CARD
========================================================= */

function renderProducts() {

    const container =
        byId(
            "adminProductList",
            "productsGrid"
        );


    if (
        !container
    ) {

        return;

    }


    if (
        allProducts.length ===
        0
    ) {

        container.innerHTML =
            `<div class="loading-card">No products yet.</div>`;


        return;

    }


    container.innerHTML =

        allProducts
            .map(
                product => {

                    const recommendedFor =
                        Array.isArray(
                            product.recommended_for
                        )
                        ?
                        product.recommended_for
                        :
                        [];


                    return `

                    <article class="admin-product-card">

                        <div class="admin-product-image">

                            ${
                                product.image_url
                                ?
                                `

                                    <img
                                        src="${
                                            escapeHtml(
                                                product.image_url
                                            )
                                        }"
                                        alt="${
                                            escapeHtml(
                                                product.name
                                            )
                                        }"
                                        onerror="
                                            this.style.display='none';
                                        "
                                    >

                                `
                                :
                                `

                                    <div class="product-image-placeholder">

                                        ${
                                            escapeHtml(
                                                product.name
                                            )
                                        }

                                    </div>

                                `
                            }

                        </div>


                        <div class="admin-product-content">

                            <div class="admin-product-topline">

                                <span>

                                    ${
                                        escapeHtml(
                                            categoryLabel(
                                                product.category
                                            )
                                        )
                                    }

                                </span>


                                <span>

                                    ${
                                        escapeHtml(
                                            statusLabel(
                                                product.status
                                            )
                                        )
                                    }

                                </span>


                                ${
                                    product.is_reference_target
                                    ?
                                    `<span>REFERENCE TARGET</span>`
                                    :
                                    ""
                                }

                            </div>


                            <h3>

                                ${
                                    escapeHtml(
                                        product.name
                                        ||
                                        "Unnamed product"
                                    )
                                }

                            </h3>


                            <p>

                                ${
                                    escapeHtml(
                                        product.short_description
                                        ||
                                        product.subtitle
                                        ||
                                        ""
                                    )
                                }

                            </p>


                            ${
                                product.sound_signature
                                ?
                                `

                                    <div class="product-sound-signature">

                                        <span>
                                            SOUND
                                        </span>

                                        <strong>

                                            ${
                                                escapeHtml(
                                                    soundSignatureLabel(
                                                        product.sound_signature
                                                    )
                                                )
                                            }

                                        </strong>

                                    </div>

                                `
                                :
                                ""
                            }


                            ${
                                recommendedFor.length >
                                0
                                ?
                                `

                                    <div class="product-recommended-admin">

                                        <span>
                                            RECOMMENDED FOR
                                        </span>


                                        <div>

                                            ${
                                                recommendedFor
                                                    .map(
                                                        value => `

                                                            <span>

                                                                ${
                                                                    escapeHtml(
                                                                        recommendedForLabel(
                                                                            value
                                                                        )
                                                                    )
                                                                }

                                                            </span>

                                                        `
                                                    )
                                                    .join("")
                                            }

                                        </div>

                                    </div>

                                `
                                :
                                ""
                            }


                            <div class="product-admin-meta">

                                <span>

                                    £${
                                        safeNumber(
                                            product.price_gbp
                                        )
                                            .toFixed(
                                                2
                                            )
                                    }

                                </span>


                                <span>

                                    STOCK

                                    ${
                                        safeNumber(
                                            product.stock_quantity
                                        )
                                    }

                                </span>


                                <span>

                                    ${
                                        escapeHtml(
                                            statusLabel(
                                                product.status
                                            )
                                        )
                                    }

                                </span>

                            </div>


                            <div class="product-admin-switches">

                                <label>

                                    <input
                                        type="checkbox"
                                        ${
                                            product.public_visible
                                            ?
                                            "checked"
                                            :
                                            ""
                                        }
                                        onchange="
                                            updateProductBoolean(
                                                '${product.id}',
                                                'public_visible',
                                                this.checked
                                            )
                                        "
                                    >

                                    PUBLIC

                                </label>


                                <label>

                                    <input
                                        type="checkbox"
                                        ${
                                            product.ordering_enabled
                                            ?
                                            "checked"
                                            :
                                            ""
                                        }
                                        onchange="
                                            updateProductBoolean(
                                                '${product.id}',
                                                'ordering_enabled',
                                                this.checked
                                            )
                                        "
                                    >

                                    ORDERING

                                </label>


                                <label>

                                    <input
                                        type="checkbox"
                                        ${
                                            product.featured
                                            ?
                                            "checked"
                                            :
                                            ""
                                        }
                                        onchange="
                                            updateProductBoolean(
                                                '${product.id}',
                                                'featured',
                                                this.checked
                                            )
                                        "
                                    >

                                    FEATURED

                                </label>

                            </div>


                            <div class="scan-actions">

                                <button
                                    type="button"
                                    class="primary-button"
                                    onclick="
                                        openEditProduct(
                                            '${product.id}'
                                        )
                                    "
                                >
                                    EDIT
                                </button>


                                <button
                                    type="button"
                                    onclick="
                                        setReferenceProduct(
                                            '${product.id}'
                                        )
                                    "
                                >
                                    SET REFERENCE
                                </button>


                                <button
                                    type="button"
                                    onclick="
                                        openProductPage(
                                            '${product.id}'
                                        )
                                    "
                                >
                                    VIEW
                                </button>


                                <button
                                    type="button"
                                    class="danger-button"
                                    onclick="
                                        confirmDeleteProduct(
                                            '${product.id}'
                                        )
                                    "
                                >
                                    DELETE
                                </button>

                            </div>

                        </div>

                    </article>

                `;

                }
            )
            .join("");

}


/* =========================================================
   PRODUCT STATS
========================================================= */

function updateProductStats() {

    setTextIfPresent(
        "totalProducts",
        allProducts.length
    );


    setTextIfPresent(

        "productsInStock",

        allProducts.filter(
            product =>
                product.status ===
                "in_stock"
        ).length

    );


    setTextIfPresent(

        "productsLowStock",

        allProducts.filter(
            product =>
                product.status ===
                "low_stock"
        ).length

    );


    setTextIfPresent(

        "productsOutStock",

        allProducts.filter(
            product =>
                product.status ===
                "out_of_stock"
        ).length

    );


    setTextIfPresent(

        "productsComingSoon",

        allProducts.filter(
            product =>
                product.status ===
                "coming_soon"
        ).length

    );

}


/* =========================================================
   CREATE PRODUCT FIELD ALIASES
========================================================= */

function readCreateProductFields() {

    return {

        name:
            getValue(
                "newProductName",
                "productName"
            )
                .trim(),

        sku:
            getValue(
                "newProductSku",
                "productSku"
            )
                .trim(),

        slug:
            getValue(
                "newProductSlug",
                "productSlug"
            )
                .trim(),

        category:
            getValue(
                "newProductCategory",
                "productCategory"
            )
            ||
            "reference",

        fitType:
            getValue(
                "newProductFitType",
                "productFitType"
            )
            ||
            "universal",

        tuningType:
            getValue(
                "newProductTuningType",
                "productTuningType"
            )
            ||
            "reference",

        soundSignature:
            getValue(
                "newProductSoundSignature",
                "productSoundSignature"
            )
            ||
            "",

        recommendedFor:
            getCheckedRecommendedValues(
                ".newProductRecommended"
            ),

        price:
            getValue(
                "newProductPrice",
                "productPrice"
            ),

        stock:
            getValue(
                "newProductStock",
                "productStock"
            ),

        lowThreshold:
            getValue(
                "newProductLowThreshold",
                "productLowThreshold"
            ),

        status:
            getValue(
                "newProductStatus",
                "productStatus"
            )
            ||
            "coming_soon",

        displayOrder:
            getValue(
                "newProductOrder",
                "productDisplayOrder"
            ),

        maxPerOrder:
            getValue(
                "newProductMaxOrder",
                "productMaxPerOrder"
            ),

        launchDate:
            getValue(
                "newProductLaunchDate",
                "productLaunchDate"
            ),

        detailPage:
            getValue(
                "newProductDetailPage",
                "productDetailPage"
            )
                .trim(),

        subtitle:
            getValue(
                "newProductSubtitle",
                "productSubtitle"
            )
                .trim(),

        shortDescription:
            getValue(
                "newProductShortDescription",
                "productShortDescription"
            )
                .trim(),

        description:
            getValue(
                "newProductDescription",
                "productDescription"
            )
                .trim(),

        featured:
            getChecked(
                "newProductFeatured",
                "productFeatured"
            ),

        ordering:
            getChecked(
                "newProductOrdering",
                "productOrderingEnabled"
            ),

        preorder:
            getChecked(
                "newProductPreorder",
                "productPreorderEnabled"
            ),

        customFit:
            getChecked(
                "newProductCustomFit",
                "productCustomFit"
            ),

        customTuning:
            getChecked(
                "newProductCustomTuning",
                "productCustomTuning"
            ),

        publicVisible:
            getChecked(
                "newProductPublicVisible",
                "productPublicVisible"
            ),

        referenceTarget:
            getChecked(
                "newProductReferenceTarget"
            )

    };

}


/* =========================================================
   CREATE PRODUCT
========================================================= */

async function createProduct() {

    setMessage(
        "addProductMessage",
        ""
    );


    setMessage(
        "productCreateMessage",
        ""
    );


    const fields =
        readCreateProductFields();


    if (
        !fields.name
    ) {

        setMessage(
            byId(
                "addProductMessage"
            )
            ?
            "addProductMessage"
            :
            "productCreateMessage",

            "Product name is required.",

            "error"
        );


        return;

    }


    let slug =
        fields.slug;


    if (
        !slug
    ) {

        slug =
            slugify(
                fields.name
            );

    }


    try {

        const payload = {

            name:
                fields.name,

            sku:
                fields.sku
                ||
                null,

            slug:
                slug,

            category:
                fields.category,

            fit_type:
                fields.fitType,

            tuning_type:
                fields.tuningType,

            sound_signature:
                fields.soundSignature
                ||
                null,

            recommended_for:
                fields.recommendedFor,

            price_gbp:
                Math.max(
                    0,
                    safeNumber(
                        fields.price
                    )
                ),

            stock_quantity:
                Math.max(
                    0,
                    Math.round(
                        safeNumber(
                            fields.stock
                        )
                    )
                ),

            low_stock_threshold:
                Math.max(
                    0,
                    Math.round(
                        safeNumber(
                            fields.lowThreshold,
                            3
                        )
                    )
                ),

            status:
                fields.status
                ||
                "coming_soon",

            display_order:
                Math.max(
                    0,
                    Math.round(
                        safeNumber(
                            fields.displayOrder
                        )
                    )
                ),

            max_per_order:
                Math.max(
                    1,
                    Math.round(
                        safeNumber(
                            fields.maxPerOrder,
                            1
                        )
                    )
                ),

            featured:
                fields.featured,

            ordering_enabled:
                fields.ordering,

            preorder_enabled:
                fields.preorder,

            custom_fit:
                fields.customFit,

            custom_tuning:
                fields.customTuning,

            public_visible:
                fields.publicVisible,

            is_reference_target:
                false,

            subtitle:
                fields.subtitle
                ||
                null,

            short_description:
                fields.shortDescription
                ||
                null,

            description:
                fields.description
                ||
                null,

            detail_page:
                fields.detailPage
                ||
                null

        };


        if (
            fields.launchDate
        ) {

            payload.launch_date =
                new Date(
                    fields.launchDate
                )
                    .toISOString();

        }


        const {
            data,
            error
        } =
            await window.hcSupabase
                .from(
                    "products"
                )
                .insert(
                    payload
                )
                .select()
                .single();


        if (
            error
        ) {

            throw error;

        }


        const imageInput =
            byId(
                "newProductImage",
                "productImage"
            );


        const imageFile =
            imageInput
                ?.files
                ?.[0];


        if (
            imageFile
        ) {

            await uploadProductImage(
                data,
                imageFile
            );

        }


        if (
            fields.referenceTarget
        ) {

            await setReferenceProduct(
                data.id,
                false
            );

        }


        const messageId =
            byId(
                "addProductMessage"
            )
            ?
            "addProductMessage"
            :
            "productCreateMessage";


        setMessage(
            messageId,
            "Product added successfully.",
            "success"
        );


        resetProductForm();


        await loadProducts();

    }

    catch (
        error
    ) {

        console.error(
            "Create product error:",
            error
        );


        const messageId =
            byId(
                "addProductMessage"
            )
            ?
            "addProductMessage"
            :
            "productCreateMessage";


        setMessage(
            messageId,
            error.message,
            "error"
        );

    }

}


/* =========================================================
   PRODUCT IMAGE
========================================================= */

async function uploadProductImage(
    product,
    file
) {

    const extension =
        file.name
            .split(
                "."
            )
            .pop()
            .toLowerCase();


    const path =
        `products/${product.id}/hero.${extension}`;


    const {
        error: uploadError
    } =
        await window.hcSupabase
            .storage
            .from(
                "product-images"
            )
            .upload(
                path,
                file,
                {
                    upsert:
                        true
                }
            );


    if (
        uploadError
    ) {

        throw uploadError;

    }


    const {
        data
    } =
        window.hcSupabase
            .storage
            .from(
                "product-images"
            )
            .getPublicUrl(
                path
            );


    const {
        error
    } =
        await window.hcSupabase
            .from(
                "products"
            )
            .update({

                image_url:
                    data.publicUrl,

                image_path:
                    path

            })
            .eq(
                "id",
                product.id
            );


    if (
        error
    ) {

        throw error;

    }

}


/* =========================================================
   PRODUCT SWITCH
========================================================= */

async function updateProductBoolean(
    productId,
    field,
    value
) {

    const allowed =
        new Set([

            "public_visible",
            "ordering_enabled",
            "featured",
            "preorder_enabled",
            "custom_fit",
            "custom_tuning"

        ]);


    if (
        !allowed.has(
            field
        )
    ) {

        return;

    }


    const payload =
        {};


    payload[
        field
    ] =
        Boolean(
            value
        );


    try {

        const {
            error
        } =
            await window.hcSupabase
                .from(
                    "products"
                )
                .update(
                    payload
                )
                .eq(
                    "id",
                    productId
                );


        if (
            error
        ) {

            throw error;

        }


        const product =
            allProducts.find(
                item =>
                    String(
                        item.id
                    )
                    ===
                    String(
                        productId
                    )
            );


        if (
            product
        ) {

            product[
                field
            ] =
                Boolean(
                    value
                );

        }

    }

    catch (
        error
    ) {

        console.error(
            "Update product boolean error:",
            error
        );


        alert(
            error.message
        );


        await loadProducts();

    }

}


/* =========================================================
   EDIT PRODUCT
========================================================= */

function getProductById(
    productId
) {

    return (
        allProducts.find(
            item =>
                String(
                    item.id
                )
                ===
                String(
                    productId
                )
        )
        ||
        null
    );

}


function openEditProduct(
    productId
) {

    const product =
        getProductById(
            productId
        );


    if (
        !product
    ) {

        alert(
            "Product could not be found."
        );


        return;

    }


    setValue(
        product.id,
        "editProductId"
    );


    setValue(
        product.name,
        "editProductName"
    );


    setValue(
        product.sku,
        "editProductSku"
    );


    setValue(
        product.slug,
        "editProductSlug"
    );


    setValue(
        product.category
        ||
        "reference",
        "editProductCategory"
    );


    setValue(
        product.fit_type
        ||
        "universal",
        "editProductFitType"
    );


    setValue(
        product.tuning_type
        ||
        "reference",
        "editProductTuningType"
    );


    setValue(
        product.sound_signature
        ||
        "",
        "editProductSoundSignature"
    );


    setCheckedRecommendedValues(
        ".editProductRecommended",
        product.recommended_for
        ||
        []
    );


    setValue(
        product.price_gbp
        ??
        0,
        "editProductPrice"
    );


    setValue(
        product.stock_quantity
        ??
        0,
        "editProductStock"
    );


    setValue(
        product.low_stock_threshold
        ??
        3,
        "editProductLowThreshold"
    );


    setValue(
        product.status
        ||
        "coming_soon",
        "editProductStatus"
    );


    setValue(
        product.display_order
        ??
        0,
        "editProductOrder"
    );


    setValue(
        toDateTimeLocalValue(
            product.launch_date
        ),
        "editProductLaunchDate"
    );


    setValue(
        product.max_per_order
        ??
        1,
        "editProductMaxOrder"
    );


    setValue(
        product.detail_page,
        "editProductDetailPage"
    );


    setChecked(
        product.public_visible ===
        true,
        "editProductPublic"
    );


    setChecked(
        product.ordering_enabled ===
        true,
        "editProductOrdering"
    );


    setChecked(
        product.featured ===
        true,
        "editProductFeatured"
    );


    setChecked(
        product.preorder_enabled ===
        true,
        "editProductPreorder"
    );


    setChecked(
        product.custom_fit_available ===
            true
        ||
        product.custom_fit ===
            true,
        "editProductCustomFit"
    );


    setChecked(
        product.custom_tuning_available ===
            true
        ||
        product.custom_tuning ===
            true,
        "editProductCustomTuning"
    );


    setValue(
        product.subtitle,
        "editProductSubtitle"
    );


    setValue(
        product.short_description,
        "editProductShortDescription"
    );


    setValue(
        product.description,
        "editProductDescription"
    );


    setMessage(
        "editProductMessage",
        ""
    );


    byId(
        "editProductModal"
    )
        ?.classList
        .add(
            "open"
        );

}


function closeEditProduct() {

    byId(
        "editProductModal"
    )
        ?.classList
        .remove(
            "open"
        );

}


/* =========================================================
   SAVE PRODUCT EDIT
========================================================= */

async function saveProductEdit() {

    const productId =
        getValue(
            "editProductId"
        );


    if (
        !productId
    ) {

        setMessage(
            "editProductMessage",
            "Product ID is missing.",
            "error"
        );


        return;

    }


    const button =
        byId(
            "saveProductEditButton"
        );


    const originalText =
        button?.textContent
        ||
        "SAVE CHANGES";


    if (
        button
    ) {

        button.disabled =
            true;


        button.textContent =
            "SAVING...";

    }


    setMessage(
        "editProductMessage",
        ""
    );


    try {

        const name =
            getValue(
                "editProductName"
            )
                .trim();


        if (
            !name
        ) {

            throw new Error(
                "Model name is required."
            );

        }


        let slug =
            getValue(
                "editProductSlug"
            )
                .trim();


        if (
            !slug
        ) {

            slug =
                slugify(
                    name
                );

        }


        const launchDate =
            getValue(
                "editProductLaunchDate"
            );


        const existingProduct =
            getProductById(
                productId
            );


        const payload = {

            name:
                name,

            sku:
                getValue(
                    "editProductSku"
                )
                    .trim()
                ||
                null,

            slug:
                slug,

            category:
                getValue(
                    "editProductCategory"
                )
                ||
                "reference",

            fit_type:
                getValue(
                    "editProductFitType"
                )
                ||
                "universal",

            tuning_type:
                getValue(
                    "editProductTuningType"
                )
                ||
                "reference",

            sound_signature:
                getValue(
                    "editProductSoundSignature"
                )
                ||
                null,

            recommended_for:
                getCheckedRecommendedValues(
                    ".editProductRecommended"
                ),

            price_gbp:
                Math.max(
                    0,
                    safeNumber(
                        getValue(
                            "editProductPrice"
                        )
                    )
                ),

            stock_quantity:
                Math.max(
                    0,
                    Math.round(
                        safeNumber(
                            getValue(
                                "editProductStock"
                            )
                        )
                    )
                ),

            low_stock_threshold:
                Math.max(
                    0,
                    Math.round(
                        safeNumber(
                            getValue(
                                "editProductLowThreshold"
                            ),
                            3
                        )
                    )
                ),

            status:
                getValue(
                    "editProductStatus"
                )
                ||
                "coming_soon",

            display_order:
                Math.max(
                    0,
                    Math.round(
                        safeNumber(
                            getValue(
                                "editProductOrder"
                            )
                        )
                    )
                ),

            launch_date:
                launchDate
                ?
                new Date(
                    launchDate
                )
                    .toISOString()
                :
                null,

            max_per_order:
                Math.max(
                    1,
                    Math.round(
                        safeNumber(
                            getValue(
                                "editProductMaxOrder"
                            ),
                            1
                        )
                    )
                ),

            detail_page:
                getValue(
                    "editProductDetailPage"
                )
                    .trim()
                ||
                null,

            public_visible:
                getChecked(
                    "editProductPublic"
                ),

            ordering_enabled:
                getChecked(
                    "editProductOrdering"
                ),

            featured:
                getChecked(
                    "editProductFeatured"
                ),

            preorder_enabled:
                getChecked(
                    "editProductPreorder"
                ),

            subtitle:
                getValue(
                    "editProductSubtitle"
                )
                    .trim()
                ||
                null,

            short_description:
                getValue(
                    "editProductShortDescription"
                )
                    .trim()
                ||
                null,

            description:
                getValue(
                    "editProductDescription"
                )
                    .trim()
                ||
                null

        };


        if (
            existingProduct
            &&
            Object.prototype
                .hasOwnProperty
                .call(
                    existingProduct,
                    "custom_fit_available"
                )
        ) {

            payload.custom_fit_available =
                getChecked(
                    "editProductCustomFit"
                );

        }

        else {

            payload.custom_fit =
                getChecked(
                    "editProductCustomFit"
                );

        }


        if (
            existingProduct
            &&
            Object.prototype
                .hasOwnProperty
                .call(
                    existingProduct,
                    "custom_tuning_available"
                )
        ) {

            payload.custom_tuning_available =
                getChecked(
                    "editProductCustomTuning"
                );

        }

        else {

            payload.custom_tuning =
                getChecked(
                    "editProductCustomTuning"
                );

        }


        const {
            data,
            error
        } =
            await window.hcSupabase
                .from(
                    "products"
                )
                .update(
                    payload
                )
                .eq(
                    "id",
                    productId
                )
                .select()
                .single();


        if (
            error
        ) {

            throw error;

        }


        const index =
            allProducts.findIndex(
                item =>
                    String(
                        item.id
                    )
                    ===
                    String(
                        productId
                    )
            );


        if (
            index >=
            0
        ) {

            allProducts[
                index
            ] =
                data;

        }


        setMessage(
            "editProductMessage",
            "Product updated successfully.",
            "success"
        );


        await loadProducts();


        window.setTimeout(
            () => {

                closeEditProduct();

            },
            500
        );

    }

    catch (
        error
    ) {

        console.error(
            "Product update failed:",
            error
        );


        setMessage(
            "editProductMessage",
            error.message
            ||
            "Unable to update product.",
            "error"
        );

    }

    finally {

        if (
            button
        ) {

            button.disabled =
                false;


            button.textContent =
                originalText;

        }

    }

}


/* =========================================================
   SET REFERENCE
========================================================= */

async function setReferenceProduct(
    productId,
    reload = true
) {

    try {

        const {
            error: clearError
        } =
            await window.hcSupabase
                .from(
                    "products"
                )
                .update({

                    is_reference_target:
                        false

                })
                .eq(
                    "is_reference_target",
                    true
                );


        if (
            clearError
        ) {

            throw clearError;

        }


        const {
            error
        } =
            await window.hcSupabase
                .from(
                    "products"
                )
                .update({

                    is_reference_target:
                        true

                })
                .eq(
                    "id",
                    productId
                );


        if (
            error
        ) {

            throw error;

        }


        if (
            reload
        ) {

            await loadProducts();

        }

    }

    catch (
        error
    ) {

        console.error(
            "Reference target error:",
            error
        );


        alert(
            error.message
        );

    }

}


/* =========================================================
   DELETE PRODUCT
========================================================= */

function confirmDeleteProduct(
    productId
) {

    const product =
        getProductById(
            productId
        );


    showConfirm(

        "Delete product?",

        `Delete ${product?.name || "this product"} and its frequency-response data?`,

        async () => {

            await deleteProduct(
                productId
            );

        }

    );

}


async function deleteProduct(
    productId
) {

    try {

        const {
            error
        } =
            await window.hcSupabase
                .from(
                    "products"
                )
                .delete()
                .eq(
                    "id",
                    productId
                );


        if (
            error
        ) {

            throw error;

        }


        closeConfirm();


        await loadProducts();

    }

    catch (
        error
    ) {

        console.error(
            "Delete product error:",
            error
        );


        alert(
            error.message
        );

    }

}


/* =========================================================
   VIEW PRODUCT
========================================================= */

function openProductPage(
    productId
) {

    const product =
        getProductById(
            productId
        );


    if (
        !product
    ) {

        return;

    }


    const url =
        product.detail_page
        ||
        (
            product.slug
            ?
            `products/${product.slug}.html`
            :
            "product.html"
        );


    window.open(
        url,
        "_blank"
    );

}


/* =========================================================
   RESET PRODUCT FORM
========================================================= */

function resetProductForm() {

    const textFields = [

        [
            "newProductName",
            "productName"
        ],

        [
            "newProductSku",
            "productSku"
        ],

        [
            "newProductSlug",
            "productSlug"
        ],

        [
            "newProductPrice",
            "productPrice"
        ],

        [
            "newProductSubtitle",
            "productSubtitle"
        ],

        [
            "newProductShortDescription",
            "productShortDescription"
        ],

        [
            "newProductDescription",
            "productDescription"
        ],

        [
            "newProductDetailPage",
            "productDetailPage"
        ]

    ];


    textFields.forEach(
        ids => {

            const element =
                byId(
                    ...ids
                );


            if (
                element
            ) {

                element.value =
                    "";

            }

        }
    );


    setValue(
        0,
        "newProductStock",
        "productStock"
    );


    setValue(
        3,
        "newProductLowThreshold",
        "productLowThreshold"
    );


    setValue(
        0,
        "newProductOrder",
        "productDisplayOrder"
    );


    setValue(
        1,
        "newProductMaxOrder",
        "productMaxPerOrder"
    );


    setValue(
        "coming_soon",
        "newProductStatus",
        "productStatus"
    );


    setValue(
        "reference",
        "newProductCategory",
        "productCategory"
    );


    setValue(
        "universal",
        "newProductFitType",
        "productFitType"
    );


    setValue(
        "reference",
        "newProductTuningType",
        "productTuningType"
    );


    setValue(
        "",
        "newProductSoundSignature",
        "productSoundSignature"
    );


    setCheckedRecommendedValues(
        ".newProductRecommended",
        []
    );


    setValue(
        "",
        "newProductLaunchDate",
        "productLaunchDate"
    );


    const image =
        byId(
            "newProductImage",
            "productImage"
        );


    if (
        image
    ) {

        image.value =
            "";

    }


    setChecked(
        true,
        "newProductPublicVisible",
        "productPublicVisible"
    );


    setChecked(
        false,
        "newProductFeatured",
        "productFeatured"
    );


    setChecked(
        false,
        "newProductOrdering",
        "productOrderingEnabled"
    );


    setChecked(
        false,
        "newProductPreorder",
        "productPreorderEnabled"
    );


    setChecked(
        false,
        "newProductCustomFit",
        "productCustomFit"
    );


    setChecked(
        false,
        "newProductCustomTuning",
        "productCustomTuning"
    );


    setChecked(
        false,
        "newProductReferenceTarget"
    );


    const slugInput =
        byId(
            "newProductSlug",
            "productSlug"
        );


    if (
        slugInput
    ) {

        delete slugInput.dataset.manual;

    }

}


/* =========================================================
   AUTO SLUG
========================================================= */

function handleProductNameInput() {

    const name =
        getValue(
            "newProductName",
            "productName"
        );


    const slugInput =
        byId(
            "newProductSlug",
            "productSlug"
        );


    if (
        !slugInput
    ) {

        return;

    }


    if (
        !slugInput.dataset.manual
    ) {

        slugInput.value =
            slugify(
                name
            );

    }

}


/* =========================================================
   FREQUENCY RESPONSE TABLE HELPERS
========================================================= */

async function runFrQuery(
    operation
) {

    const names = [

        "product_frequency_response",
        "product_frequency_responses"

    ];


    let lastError =
        null;


    for (
        const tableName
        of
        names
    ) {

        try {

            const result =
                await operation(
                    tableName
                );


            if (
                !result.error
            ) {

                return {
                    ...result,
                    tableName
                };

            }


            lastError =
                result.error;

        }

        catch (
            error
        ) {

            lastError =
                error;

        }

    }


    return {

        data:
            null,

        error:
            lastError

    };

}


/* =========================================================
   POPULATE FR PRODUCT SELECT
========================================================= */

function populateFrProductSelect() {

    const select =
        byId(
            "frProductSelect"
        );


    if (
        !select
    ) {

        return;

    }


    const current =
        select.value;


    select.innerHTML = `

        <option value="">
            Select product
        </option>

        ${
            allProducts
                .map(
                    product => `

                        <option value="${product.id}">

                            ${
                                escapeHtml(
                                    product.name
                                )
                            }

                        </option>

                    `
                )
                .join("")
        }

    `;


    if (
        allProducts.some(
            product =>
                String(
                    product.id
                )
                ===
                String(
                    current
                )
        )
    ) {

        select.value =
            current;

    }

}


function populateReferenceProductSelect() {

    const select =
        byId(
            "referenceProductSelect"
        );


    if (
        !select
    ) {

        return;

    }


    const current =
        select.value;


    select.innerHTML = `

        <option value="">
            Select product
        </option>

        ${
            allProducts
                .map(
                    product => `

                        <option value="${product.id}">

                            ${
                                escapeHtml(
                                    product.name
                                )
                            }

                        </option>

                    `
                )
                .join("")
        }

    `;


    const reference =
        allProducts.find(
            product =>
                product.is_reference_target ===
                true
        );


    if (
        current
    ) {

        select.value =
            current;

    }

    else if (
        reference
    ) {

        select.value =
            reference.id;

    }

}


/* =========================================================
   FR FILE PARSER
========================================================= */

async function parseFrequencyResponseFile(
    file
) {

    const text =
        await file.text();


    const lines =
        text.split(
            /\r?\n/
        );


    const points =
        [];


    for (
        const rawLine
        of
        lines
    ) {

        const line =
            rawLine.trim();


        if (
            !line
            ||
            line.startsWith(
                "#"
            )
            ||
            line.startsWith(
                ";"
            )
        ) {

            continue;

        }


        const columns =
            line
                .split(
                    /[\s,;\t]+/
                )
                .filter(
                    Boolean
                );


        if (
            columns.length <
            2
        ) {

            continue;

        }


        const frequency =
            Number(
                columns[
                    0
                ]
            );


        const db =
            Number(
                columns[
                    1
                ]
            );


        if (
            !Number.isFinite(
                frequency
            )
            ||
            !Number.isFinite(
                db
            )
            ||
            frequency <=
                0
        ) {

            continue;

        }


        points.push({

            frequency:
                frequency,

            db:
                db

        });

    }


    points.sort(
        (
            first,
            second
        ) =>
            first.frequency
            -
            second.frequency
    );


    const unique =
        new Map();


    points.forEach(
        point => {

            unique.set(
                point.frequency,
                point
            );

        }
    );


    return Array.from(
        unique.values()
    );

}


/* =========================================================
   INTERPOLATE
========================================================= */

function interpolateResponse(
    points,
    targetFrequency
) {

    if (
        points.length ===
        0
    ) {

        return 0;

    }


    if (
        targetFrequency <=
        points[
            0
        ].frequency
    ) {

        return points[
            0
        ].db;

    }


    const last =
        points[
            points.length -
            1
        ];


    if (
        targetFrequency >=
        last.frequency
    ) {

        return last.db;

    }


    for (
        let index = 0;
        index <
            points.length -
            1;
        index++
    ) {

        const left =
            points[
                index
            ];


        const right =
            points[
                index +
                1
            ];


        if (
            targetFrequency >=
                left.frequency
            &&
            targetFrequency <=
                right.frequency
        ) {

            const leftLog =
                Math.log10(
                    left.frequency
                );


            const rightLog =
                Math.log10(
                    right.frequency
                );


            const targetLog =
                Math.log10(
                    targetFrequency
                );


            const ratio =
                (
                    targetLog
                    -
                    leftLog
                )
                /
                (
                    rightLog
                    -
                    leftLog
                );


            return (

                left.db

                +

                (
                    right.db
                    -
                    left.db
                )

                *
                ratio

            );

        }

    }


    return 0;

}


/* =========================================================
   PREVIEW FR
========================================================= */

async function previewFrequencyResponse() {

    const input =
        byId(
            "frFileInput",
            "frProductFile"
        );


    const file =
        input
            ?.files
            ?.[0];


    if (
        !file
    ) {

        setMessage(
            byId(
                "frMessage"
            )
            ?
            "frMessage"
            :
            "frProductMessage",

            "Choose an FRD, CSV or TXT file first.",

            "error"
        );


        return;

    }


    try {

        const points =
            await parseFrequencyResponseFile(
                file
            );


        if (
            points.length <
            10
        ) {

            throw new Error(
                "Too few valid measurement points were found."
            );

        }


        parsedFrequencyResponse =
            points;


        drawAdminFrChart(
            points
        );


        updateFrSummary(
            points
        );


        const saveButton =
            byId(
                "saveFrButton",
                "uploadProductFrButton"
            );


        if (
            saveButton
        ) {

            saveButton.disabled =
                false;

        }


        setMessage(
            byId(
                "frMessage"
            )
            ?
            "frMessage"
            :
            "frProductMessage",

            `${points.length} measurement points loaded.`,

            "success"
        );

    }

    catch (
        error
    ) {

        parsedFrequencyResponse =
            [];


        setMessage(
            byId(
                "frMessage"
            )
            ?
            "frMessage"
            :
            "frProductMessage",

            error.message,

            "error"
        );

    }

}


/* =========================================================
   DRAW FR
========================================================= */

function drawAdminFrChart(
    points
) {

    const canvas =
        byId(
            "adminFrCanvas",
            "frChart"
        );


    if (
        !canvas
    ) {

        return;

    }


    const ctx =
        canvas.getContext(
            "2d"
        );


    if (
        canvas.width <
        500
    ) {

        canvas.width =
            1400;

    }


    if (
        canvas.height <
        300
    ) {

        canvas.height =
            650;

    }


    const width =
        canvas.width;


    const height =
        canvas.height;


    ctx.clearRect(
        0,
        0,
        width,
        height
    );


    if (
        !points
        ||
        points.length <
        2
    ) {

        return;

    }


    const normalizationElement =
        byId(
            "frNormalization"
        );


    const normalization =
        normalizationElement
            ?.value
        ||
        "none";


    let displayPoints =
        points;


    if (
        normalization ===
        "1000"
    ) {

        const reference =
            interpolateResponse(
                points,
                1000
            );


        displayPoints =
            points.map(
                point => ({

                    frequency:
                        point.frequency,

                    db:
                        point.db
                        -
                        reference

                })
            );

    }


    const left =
        80;


    const right =
        35;


    const top =
        40;


    const bottom =
        65;


    const minFrequency =
        Math.max(
            20,
            displayPoints[
                0
            ].frequency
        );


    const maxFrequency =
        Math.min(

            20000,

            displayPoints[
                displayPoints.length -
                1
            ].frequency

        );


    const dbValues =
        displayPoints.map(
            point =>
                point.db
        );


    let minDb =
        Math.floor(
            Math.min(
                ...dbValues
            )
            /
            5
        )
        *
        5
        -
        5;


    let maxDb =
        Math.ceil(
            Math.max(
                ...dbValues
            )
            /
            5
        )
        *
        5
        +
        5;


    if (
        maxDb ===
        minDb
    ) {

        maxDb +=
            5;


        minDb -=
            5;

    }


    function xFromFrequency(
        frequency
    ) {

        const minLog =
            Math.log10(
                minFrequency
            );


        const maxLog =
            Math.log10(
                maxFrequency
            );


        return (

            left

            +

            (
                (
                    Math.log10(
                        frequency
                    )
                    -
                    minLog
                )
                /
                (
                    maxLog
                    -
                    minLog
                )
            )

            *
            (
                width
                -
                left
                -
                right
            )

        );

    }


    function yFromDb(
        db
    ) {

        return (

            top

            +

            (
                maxDb
                -
                db
            )
            /
            (
                maxDb
                -
                minDb
            )

            *
            (
                height
                -
                top
                -
                bottom
            )

        );

    }


    ctx.font =
        "18px Arial";


    for (
        let db = minDb;
        db <= maxDb;
        db += 5
    ) {

        const y =
            yFromDb(
                db
            );


        ctx.beginPath();


        ctx.strokeStyle =
            "rgba(23,23,23,0.10)";


        ctx.moveTo(
            left,
            y
        );


        ctx.lineTo(
            width -
            right,
            y
        );


        ctx.stroke();


        ctx.fillStyle =
            "#77716b";


        ctx.fillText(
            `${db > 0 ? "+" : ""}${db}`,
            15,
            y +
            5
        );

    }


    const frequencyLabels = [

        20,
        50,
        100,
        200,
        500,
        1000,
        2000,
        5000,
        10000,
        20000

    ];


    frequencyLabels.forEach(
        frequency => {

            if (
                frequency <
                    minFrequency
                ||
                frequency >
                    maxFrequency
            ) {

                return;

            }


            const x =
                xFromFrequency(
                    frequency
                );


            ctx.beginPath();


            ctx.strokeStyle =
                "rgba(23,23,23,0.07)";


            ctx.moveTo(
                x,
                top
            );


            ctx.lineTo(
                x,
                height -
                bottom
            );


            ctx.stroke();


            ctx.fillStyle =
                "#77716b";


            const label =
                frequency >=
                1000
                ?
                `${frequency / 1000}k`
                :
                String(
                    frequency
                );


            ctx.fillText(
                label,
                x -
                15,
                height -
                20
            );

        }
    );


    ctx.beginPath();


    ctx.strokeStyle =
        "#d86a2b";


    ctx.lineWidth =
        4;


    let started =
        false;


    displayPoints.forEach(
        point => {

            if (
                point.frequency <
                    minFrequency
                ||
                point.frequency >
                    maxFrequency
            ) {

                return;

            }


            const x =
                xFromFrequency(
                    point.frequency
                );


            const y =
                yFromDb(
                    point.db
                );


            if (
                !started
            ) {

                ctx.moveTo(
                    x,
                    y
                );


                started =
                    true;

            }

            else {

                ctx.lineTo(
                    x,
                    y
                );

            }

        }
    );


    ctx.stroke();

}


/* =========================================================
   FR SUMMARY
========================================================= */

function updateFrSummary(
    points
) {

    if (
        !points?.length
    ) {

        return;

    }


    setTextIfPresent(
        "frPointCount",
        points.length
    );


    setTextIfPresent(
        "frMinFrequency",
        `${points[0].frequency.toFixed(1)} Hz`
    );


    setTextIfPresent(

        "frMaxFrequency",

        `${
            points[
                points.length -
                1
            ]
                .frequency
                .toFixed(
                    1
                )
        } Hz`

    );


    setTextIfPresent(

        "frOneKhzLevel",

        `${
            interpolateResponse(
                points,
                1000
            )
                .toFixed(
                    2
                )
        } dB`

    );

}


/* =========================================================
   SAVE FR
========================================================= */

async function saveFrequencyResponse() {

    const productId =
        getValue(
            "frProductSelect"
        );


    if (
        !productId
    ) {

        setMessage(
            byId(
                "frMessage"
            )
            ?
            "frMessage"
            :
            "frProductMessage",

            "Select a product first.",

            "error"
        );


        return;

    }


    if (
        parsedFrequencyResponse.length ===
        0
    ) {

        const file =
            byId(
                "frFileInput",
                "frProductFile"
            )
                ?.files
                ?.[0];


        if (
            file
        ) {

            parsedFrequencyResponse =
                await parseFrequencyResponseFile(
                    file
                );

        }

    }


    if (
        parsedFrequencyResponse.length ===
        0
    ) {

        setMessage(
            byId(
                "frMessage"
            )
            ?
            "frMessage"
            :
            "frProductMessage",

            "Choose and preview a valid measurement first.",

            "error"
        );


        return;

    }


    try {

        const deleteResult =
            await runFrQuery(
                tableName =>
                    window.hcSupabase
                        .from(
                            tableName
                        )
                        .delete()
                        .eq(
                            "product_id",
                            productId
                        )
            );


        if (
            deleteResult.error
        ) {

            throw deleteResult.error;

        }


        const tableName =
            deleteResult.tableName;


        const rows =
            parsedFrequencyResponse.map(
                point => ({

                    product_id:
                        productId,

                    frequency_hz:
                        point.frequency,

                    db:
                        point.db

                })
            );


        const batchSize =
            500;


        for (
            let index = 0;
            index <
                rows.length;
            index +=
                batchSize
        ) {

            const batch =
                rows.slice(
                    index,
                    index +
                    batchSize
                );


            const {
                error
            } =
                await window.hcSupabase
                    .from(
                        tableName
                    )
                    .insert(
                        batch
                    );


            if (
                error
            ) {

                throw error;

            }

        }


        drawAdminFrChart(
            parsedFrequencyResponse
        );


        updateFrSummary(
            parsedFrequencyResponse
        );


        setMessage(
            byId(
                "frMessage"
            )
            ?
            "frMessage"
            :
            "frProductMessage",

            `${rows.length} real measurement points saved.`,

            "success"
        );

    }

    catch (
        error
    ) {

        console.error(
            "Save FR error:",
            error
        );


        setMessage(
            byId(
                "frMessage"
            )
            ?
            "frMessage"
            :
            "frProductMessage",

            error.message,

            "error"
        );

    }

}


/* =========================================================
   LOAD EXISTING FR
========================================================= */

async function loadExistingFrequencyResponse() {

    const productId =
        getValue(
            "frProductSelect"
        );


    if (
        !productId
    ) {

        parsedFrequencyResponse =
            [];


        drawAdminFrChart(
            []
        );


        return;

    }


    try {

        const result =
            await runFrQuery(
                tableName =>
                    window.hcSupabase
                        .from(
                            tableName
                        )
                        .select(`
                            frequency_hz,
                            db
                        `)
                        .eq(
                            "product_id",
                            productId
                        )
                        .order(
                            "frequency_hz",
                            {
                                ascending:
                                    true
                            }
                        )
            );


        if (
            result.error
        ) {

            throw result.error;

        }


        const points =
            (
                result.data
                ||
                []
            )
                .map(
                    point => ({

                        frequency:
                            Number(
                                point.frequency_hz
                            ),

                        db:
                            Number(
                                point.db
                            )

                    })
                )
                .filter(
                    point =>
                        Number.isFinite(
                            point.frequency
                        )
                        &&
                        Number.isFinite(
                            point.db
                        )
                );


        parsedFrequencyResponse =
            points;


        if (
            points.length >
            0
        ) {

            drawAdminFrChart(
                points
            );


            updateFrSummary(
                points
            );


            setMessage(
                byId(
                    "frMessage"
                )
                ?
                "frMessage"
                :
                "frProductMessage",

                `${points.length} existing measurement points loaded.`,

                "success"
            );

        }

        else {

            drawAdminFrChart(
                []
            );


            setMessage(
                byId(
                    "frMessage"
                )
                ?
                "frMessage"
                :
                "frProductMessage",

                "No frequency response saved for this product."

            );

        }

    }

    catch (
        error
    ) {

        console.error(
            "Load FR error:",
            error
        );


        setMessage(
            byId(
                "frMessage"
            )
            ?
            "frMessage"
            :
            "frProductMessage",

            error.message,

            "error"
        );

    }

}


/* =========================================================
   DELETE FR
========================================================= */

function confirmDeleteFrequencyResponse() {

    const productId =
        getValue(
            "frProductSelect"
        );


    if (
        !productId
    ) {

        return;

    }


    showConfirm(

        "Delete frequency response?",

        "The product will no longer have measurement data until a new response is uploaded.",

        async () => {

            const result =
                await runFrQuery(
                    tableName =>
                        window.hcSupabase
                            .from(
                                tableName
                            )
                            .delete()
                            .eq(
                                "product_id",
                                productId
                            )
                );


            if (
                result.error
            ) {

                alert(
                    result.error.message
                );


                return;

            }


            parsedFrequencyResponse =
                [];


            drawAdminFrChart(
                []
            );


            closeConfirm();

        }

    );

}


/* =========================================================
   SET REFERENCE FROM FR SECTION
========================================================= */

async function setSelectedReferenceProduct() {

    const productId =
        getValue(
            "referenceProductSelect"
        );


    if (
        !productId
    ) {

        setMessage(
            "referenceMessage",
            "Select a reference product.",
            "error"
        );


        return;

    }


    await setReferenceProduct(
        productId
    );


    setMessage(
        "referenceMessage",
        "Reference product updated.",
        "success"
    );

}


/* =========================================================
   ADMIN NAVIGATION
========================================================= */

function setupAdminNavigation() {

    document
        .querySelectorAll(
            "[data-section]"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        const name =
                            button.dataset.section;


                        const targets = {

                            accounts:
                                byId(
                                    "accountsSection"
                                ),

                            scans:
                                byId(
                                    "scansSection"
                                ),

                            processors:
                                byId(
                                    "processorsSection"
                                ),

                            products:
                                byId(
                                    "productsSection"
                                ),

                            "fr-data":
                                byId(
                                    "frDataSection"
                                )

                        };


                        targets[
                            name
                        ]
                            ?.scrollIntoView({

                                behavior:
                                    "smooth",

                                block:
                                    "start"

                            });

                    }
                );

            }
        );

}


/* =========================================================
   EVENTS
========================================================= */

function setupEvents() {

    byId(
        "adminLogoutButton",
        "logoutButton"
    )
        ?.addEventListener(
            "click",
            logoutAdmin
        );


    byId(
        "refreshAccountsButton"
    )
        ?.addEventListener(
            "click",
            loadAccounts
        );


    byId(
        "refreshScansButton"
    )
        ?.addEventListener(
            "click",
            loadScans
        );


    byId(
        "refreshProcessorsButton"
    )
        ?.addEventListener(
            "click",
            loadProcessors
        );


    byId(
        "refreshProductsButton"
    )
        ?.addEventListener(
            "click",
            loadProducts
        );


    byId(
        "scanStatusFilter"
    )
        ?.addEventListener(
            "change",
            renderScans
        );


    byId(
        "clearScanFilterButton"
    )
        ?.addEventListener(
            "click",
            () => {

                setValue(
                    "",
                    "scanStatusFilter"
                );


                renderScans();

            }
        );


    byId(
        "accountSearchInput",
        "accountSearch"
    )
        ?.addEventListener(
            "input",
            event => {

                const search =
                    event.target.value
                        .trim()
                        .toLowerCase();


                if (
                    !search
                ) {

                    renderAccounts(
                        allAccounts
                    );


                    return;

                }


                renderAccounts(

                    allAccounts.filter(
                        account =>

                            String(
                                account.email
                                ||
                                ""
                            )
                                .toLowerCase()
                                .includes(
                                    search
                                )

                            ||

                            String(
                                account.full_name
                                ||
                                ""
                            )
                                .toLowerCase()
                                .includes(
                                    search
                                )

                    )

                );

            }
        );


    byId(
        "newProductName",
        "productName"
    )
        ?.addEventListener(
            "input",
            handleProductNameInput
        );


    byId(
        "newProductSlug",
        "productSlug"
    )
        ?.addEventListener(
            "input",
            event => {

                if (
                    event.target.value
                        .trim()
                ) {

                    event.target.dataset.manual =
                        "true";

                }

                else {

                    delete event.target.dataset.manual;

                }

            }
        );


    byId(
        "addProductButton"
    )
        ?.addEventListener(
            "click",
            createProduct
        );


    byId(
        "closeEditProductButton"
    )
        ?.addEventListener(
            "click",
            closeEditProduct
        );


    byId(
        "saveProductEditButton"
    )
        ?.addEventListener(
            "click",
            saveProductEdit
        );


    byId(
        "editProductModal"
    )
        ?.addEventListener(
            "click",
            event => {

                if (
                    event.target.id ===
                    "editProductModal"
                ) {

                    closeEditProduct();

                }

            }
        );


    byId(
        "previewFrButton"
    )
        ?.addEventListener(
            "click",
            previewFrequencyResponse
        );


    byId(
        "saveFrButton",
        "uploadProductFrButton"
    )
        ?.addEventListener(
            "click",
            async () => {

                if (
                    parsedFrequencyResponse.length ===
                    0
                ) {

                    const file =
                        byId(
                            "frFileInput",
                            "frProductFile"
                        )
                            ?.files
                            ?.[0];


                    if (
                        file
                    ) {

                        parsedFrequencyResponse =
                            await parseFrequencyResponseFile(
                                file
                            );

                    }

                }


                await saveFrequencyResponse();

            }
        );


    byId(
        "deleteFrButton"
    )
        ?.addEventListener(
            "click",
            confirmDeleteFrequencyResponse
        );


    byId(
        "frProductSelect"
    )
        ?.addEventListener(
            "change",
            loadExistingFrequencyResponse
        );


    byId(
        "frNormalization"
    )
        ?.addEventListener(
            "change",
            () => {

                drawAdminFrChart(
                    parsedFrequencyResponse
                );

            }
        );


    byId(
        "setReferenceButton"
    )
        ?.addEventListener(
            "click",
            setSelectedReferenceProduct
        );


    byId(
        "confirmCancelButton"
    )
        ?.addEventListener(
            "click",
            closeConfirm
        );


    byId(
        "confirmActionButton"
    )
        ?.addEventListener(
            "click",
            async () => {

                const callback =
                    confirmCallback;


                if (
                    callback
                ) {

                    await callback();

                }

            }
        );


    document.addEventListener(
        "keydown",
        event => {

            if (
                event.key ===
                "Escape"
            ) {

                closeEditProduct();

                closeConfirm();

            }

        }
    );


    setupAdminNavigation();

}


/* =========================================================
   EXPOSE INLINE FUNCTIONS
========================================================= */

window.queueScan =
    queueScan;


window.retryScan =
    retryScan;


window.confirmDeleteScan =
    confirmDeleteScan;


window.updateProductBoolean =
    updateProductBoolean;


window.openEditProduct =
    openEditProduct;


window.setReferenceProduct =
    setReferenceProduct;


window.openProductPage =
    openProductPage;


window.confirmDeleteProduct =
    confirmDeleteProduct;


/* =========================================================
   START
========================================================= */

async function startAdmin() {

    try {

        const admin =
            await ensureAdmin();


        if (
            !admin
        ) {

            return;

        }


        setupEvents();


        await loadScans();


        await Promise.all([

            loadAccounts(),

            loadProducts(),

            loadProcessors()

        ]);

    }

    catch (
        error
    ) {

        console.error(
            "Admin startup error:",
            error
        );


        alert(
            `Unable to start admin dashboard: ${error.message}`
        );

    }

}


/* =========================================================
   RUN
========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    startAdmin
);