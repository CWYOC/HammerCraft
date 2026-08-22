/* =========================================================
   HAMMER CRAFT
   ADMIN DASHBOARD
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
   HELPERS
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


    return date.toLocaleString();

}


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
        message;


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
        !window.hcSupabase
    ) {

        throw new Error(
            "Supabase client unavailable."
        );

    }


    const {
        data,
        error
    } =
        await window.hcSupabase
            .auth
            .getSession();


    if (
        error
    ) {

        throw error;

    }


    if (
        !data.session
    ) {

        window.location.href =
            "account.html?next=admin";


        return false;

    }


    currentAdminUser =
        data.session.user;


    document
        .getElementById(
            "adminEmail"
        )
        .textContent =
            currentAdminUser.email
            ||
            "ADMIN";


    /*
     * Change the following admin check if
     * your schema stores admin permissions
     * somewhere else.
     */

    const {
        data: profile,
        error: profileError
    } =
        await window.hcSupabase
            .from(
                "profiles"
            )
            .select(
                "is_admin"
            )
            .eq(
                "id",
                currentAdminUser.id
            )
            .maybeSingle();


    if (
        profileError
    ) {

        throw profileError;

    }


    if (
        !profile
        ||
        profile.is_admin !==
            true
    ) {

        alert(
            "This account does not have admin access."
        );


        window.location.href =
            "index.html";


        return false;

    }


    return true;

}


/* =========================================================
   LOGOUT
========================================================= */

async function logoutAdmin() {

    await window.hcSupabase
        .auth
        .signOut();


    window.location.href =
        "index.html";

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


    document
        .getElementById(
            "confirmTitle"
        )
        .textContent =
            title;


    document
        .getElementById(
            "confirmText"
        )
        .textContent =
            text;


    document
        .getElementById(
            "confirmModal"
        )
        .classList
        .add(
            "open"
        );

}


function closeConfirm() {

    confirmCallback =
        null;


    document
        .getElementById(
            "confirmModal"
        )
        .classList
        .remove(
            "open"
        );

}


/* =========================================================
   ACCOUNTS
========================================================= */

async function loadAccounts() {

    const container =
        document.getElementById(
            "adminAccountList"
        );


    container.innerHTML =
        `<div class="loading-card">Loading accounts...</div>`;


    try {

        /*
         * This assumes you have a profiles table.
         */

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
        document.getElementById(
            "adminAccountList"
        );


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

                                ${formatDate(
                                    account.created_at
                                )}

                            </span>

                        </div>

                    </article>

                `
            )
            .join("");

}


async function updateAccountStats() {

    document
        .getElementById(
            "totalAccounts"
        )
        .textContent =
            allAccounts.length;


    document
        .getElementById(
            "accountSummaryTotal"
        )
        .textContent =
            allAccounts.length;


    const admins =
        allAccounts.filter(
            account =>
                account.is_admin ===
                true
        );


    document
        .getElementById(
            "totalAdmins"
        )
        .textContent =
            admins.length;


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


    document
        .getElementById(
            "accountsWithScans"
        )
        .textContent =
            usersWithScans.size;

}


/* =========================================================
   SCANS
========================================================= */

async function loadScans() {

    const container =
        document.getElementById(
            "adminScanList"
        );


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
                .select(`
                    *
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
        document.getElementById(
            "adminScanList"
        );


    const filter =
        document
            .getElementById(
                "scanStatusFilter"
            )
            .value;


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

                            <span class="status-badge ${escapeHtml(scan.status)}">

                                ${
                                    escapeHtml(
                                        scan.status
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

    document
        .getElementById(
            "totalScans"
        )
        .textContent =
            allScans.length;


    document
        .getElementById(
            "processingScans"
        )
        .textContent =

            allScans.filter(
                scan =>
                    scan.status ===
                    "processing"
            ).length;


    document
        .getElementById(
            "completeScans"
        )
        .textContent =

            allScans.filter(
                scan =>
                    scan.status ===
                    "complete"
            ).length;


    document
        .getElementById(
            "failedScans"
        )
        .textContent =

            allScans.filter(
                scan =>
                    scan.status ===
                    "failed"
            ).length;

}


async function queueScan(
    scanId
) {

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

        alert(
            error.message
        );


        return;

    }


    await loadScans();

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

        "This will permanently delete the scan database entry and attempt to remove its storage files.",

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
                    item.id ===
                    scanId
            );


        /*
         * If you store a storage prefix on the scan,
         * delete objects under it here.
         *
         * Database deletion still works even if the
         * scan has no known prefix.
         */

        if (
            scan
            &&
            scan.storage_prefix
        ) {

            try {

                const {
                    data: files
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
                    files
                    &&
                    files.length >
                        0
                ) {

                    const paths =
                        files.map(
                            file =>
                                `${scan.storage_prefix}/${file.name}`
                        );


                    await window.hcSupabase
                        .storage
                        .from(
                            "ear-scans"
                        )
                        .remove(
                            paths
                        );

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

async function loadProcessors() {

    const container =
        document.getElementById(
            "processorList"
        );


    container.innerHTML =
        `<div class="loading-card">Loading processors...</div>`;


    try {

        const {
            data,
            error
        } =
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
                            new Date(
                                processor.last_seen_at
                            );


                        const age =
                            Date.now()
                            -
                            lastSeen.getTime();


                        const online =
                            age <
                            30000;


                        return `

                            <article class="processor-card">

                                <span class="status-badge ${
                                    online
                                    ?
                                    "complete"
                                    :
                                    "failed"
                                }">

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
                                            "Processor"
                                        )
                                    }

                                </h3>


                                <p>

                                    ${
                                        escapeHtml(
                                            processor.platform
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
        document.getElementById(
            "adminProductList"
        );


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
        document.getElementById(
            "adminProductList"
        );


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
                product => `

                    <article class="admin-product-card">

                        <div class="admin-product-image">

                            ${
                                product.image_url
                                ?
                                `

                                    <img
                                        src="${escapeHtml(product.image_url)}"
                                        alt="${escapeHtml(product.name)}"
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
                                            product.category
                                            ||
                                            "reference"
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
                                    )
                                }

                            </h3>


                            <p>

                                ${
                                    escapeHtml(
                                        product.subtitle
                                        ||
                                        ""
                                    )
                                }

                            </p>


                            <div class="product-admin-meta">

                                <span>

                                    £${
                                        safeNumber(
                                            product.price_gbp
                                        ).toFixed(2)
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
                                            product.status
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
                                        onchange="updateProductBoolean(
                                            '${product.id}',
                                            'public_visible',
                                            this.checked
                                        )"
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
                                        onchange="updateProductBoolean(
                                            '${product.id}',
                                            'ordering_enabled',
                                            this.checked
                                        )"
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
                                        onchange="updateProductBoolean(
                                            '${product.id}',
                                            'featured',
                                            this.checked
                                        )"
                                    >

                                    FEATURED

                                </label>

                            </div>


                            <div class="scan-actions">

                                <button
                                    type="button"
                                    onclick="setReferenceProduct('${product.id}')"
                                >
                                    SET REFERENCE
                                </button>


                                <button
                                    type="button"
                                    onclick="openProductPage('${product.id}')"
                                >
                                    VIEW
                                </button>


                                <button
                                    type="button"
                                    class="danger-button"
                                    onclick="confirmDeleteProduct('${product.id}')"
                                >
                                    DELETE
                                </button>

                            </div>

                        </div>

                    </article>

                `
            )
            .join("");

}


/* =========================================================
   PRODUCT STATS
========================================================= */

function updateProductStats() {

    document
        .getElementById(
            "totalProducts"
        )
        .textContent =
            allProducts.length;


    document
        .getElementById(
            "productsInStock"
        )
        .textContent =

            allProducts.filter(
                product =>
                    product.status ===
                    "in_stock"
            ).length;


    document
        .getElementById(
            "productsLowStock"
        )
        .textContent =

            allProducts.filter(
                product =>
                    product.status ===
                    "low_stock"
            ).length;


    document
        .getElementById(
            "productsOutStock"
        )
        .textContent =

            allProducts.filter(
                product =>
                    product.status ===
                    "out_of_stock"
            ).length;


    document
        .getElementById(
            "productsComingSoon"
        )
        .textContent =

            allProducts.filter(
                product =>
                    product.status ===
                    "coming_soon"
            ).length;

}


/* =========================================================
   CREATE PRODUCT
========================================================= */

async function createProduct() {

    setMessage(
        "addProductMessage",
        ""
    );


    const name =
        document
            .getElementById(
                "newProductName"
            )
            .value
            .trim();


    let slug =
        document
            .getElementById(
                "newProductSlug"
            )
            .value
            .trim();


    if (
        !name
    ) {

        setMessage(
            "addProductMessage",
            "Product name is required.",
            "error"
        );


        return;

    }


    if (
        !slug
    ) {

        slug =
            slugify(
                name
            );

    }


    const referenceRequested =
        document
            .getElementById(
                "newProductReferenceTarget"
            )
            .checked;


    try {

        const payload = {

            name:
                name,

            sku:
                document
                    .getElementById(
                        "newProductSku"
                    )
                    .value
                    .trim()
                ||
                null,

            slug:
                slug,

            category:
                document
                    .getElementById(
                        "newProductCategory"
                    )
                    .value,

            fit_type:
                document
                    .getElementById(
                        "newProductFitType"
                    )
                    .value,

            tuning_type:
                document
                    .getElementById(
                        "newProductTuningType"
                    )
                    .value,

            price_gbp:
                safeNumber(
                    document
                        .getElementById(
                            "newProductPrice"
                        )
                        .value,
                    0
                ),

            stock_quantity:
                safeNumber(
                    document
                        .getElementById(
                            "newProductStock"
                        )
                        .value,
                    0
                ),

            low_stock_threshold:
                safeNumber(
                    document
                        .getElementById(
                            "newProductLowThreshold"
                        )
                        .value,
                    3
                ),

            status:
                document
                    .getElementById(
                        "newProductStatus"
                    )
                    .value,

            display_order:
                safeNumber(
                    document
                        .getElementById(
                            "newProductOrder"
                        )
                        .value,
                    0
                ),

            max_per_order:
                safeNumber(
                    document
                        .getElementById(
                            "newProductMaxOrder"
                        )
                        .value,
                    1
                ),

            featured:
                document
                    .getElementById(
                        "newProductFeatured"
                    )
                    .checked,

            ordering_enabled:
                document
                    .getElementById(
                        "newProductOrdering"
                    )
                    .checked,

            preorder_enabled:
                document
                    .getElementById(
                        "newProductPreorder"
                    )
                    .checked,

            custom_fit:
                document
                    .getElementById(
                        "newProductCustomFit"
                    )
                    .checked,

            custom_tuning:
                document
                    .getElementById(
                        "newProductCustomTuning"
                    )
                    .checked,

            public_visible:
                document
                    .getElementById(
                        "newProductPublicVisible"
                    )
                    .checked,

            is_reference_target:
                false,

            subtitle:
                document
                    .getElementById(
                        "newProductSubtitle"
                    )
                    .value
                    .trim()
                ||
                null,

            short_description:
                document
                    .getElementById(
                        "newProductShortDescription"
                    )
                    .value
                    .trim()
                ||
                null,

            description:
                document
                    .getElementById(
                        "newProductDescription"
                    )
                    .value
                    .trim()
                ||
                null,

            detail_page:
                document
                    .getElementById(
                        "newProductDetailPage"
                    )
                    .value
                    .trim()
                ||
                null

        };


        const launchValue =
            document
                .getElementById(
                    "newProductLaunchDate"
                )
                .value;


        if (
            launchValue
        ) {

            payload.launch_date =
                new Date(
                    launchValue
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


        const imageFile =
            document
                .getElementById(
                    "newProductImage"
                )
                .files[
                    0
                ];


        if (
            imageFile
        ) {

            await uploadProductImage(
                data,
                imageFile
            );

        }


        if (
            referenceRequested
        ) {

            await setReferenceProduct(
                data.id,
                false
            );

        }


        setMessage(
            "addProductMessage",
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


        setMessage(
            "addProductMessage",
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
                    data.publicUrl

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
            "featured"

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

        alert(
            error.message
        );


        await loadProducts();

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
        allProducts.find(
            item =>
                item.id ===
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
        allProducts.find(
            item =>
                item.id ===
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
        `products/${product.slug}.html`;


    window.open(
        url,
        "_blank"
    );

}


/* =========================================================
   RESET PRODUCT FORM
========================================================= */

function resetProductForm() {

    const ids = [

        "newProductName",
        "newProductSku",
        "newProductSlug",
        "newProductPrice",
        "newProductSubtitle",
        "newProductShortDescription",
        "newProductDescription",
        "newProductDetailPage"

    ];


    ids.forEach(
        id => {

            const element =
                document.getElementById(
                    id
                );


            if (
                element
            ) {

                element.value =
                    "";

            }

        }
    );


    document
        .getElementById(
            "newProductStock"
        )
        .value =
            0;


    document
        .getElementById(
            "newProductLowThreshold"
        )
        .value =
            3;


    document
        .getElementById(
            "newProductOrder"
        )
        .value =
            0;


    document
        .getElementById(
            "newProductMaxOrder"
        )
        .value =
            1;


    document
        .getElementById(
            "newProductStatus"
        )
        .value =
            "coming_soon";


    document
        .getElementById(
            "newProductCategory"
        )
        .value =
            "reference";


    document
        .getElementById(
            "newProductFitType"
        )
        .value =
            "universal";


    document
        .getElementById(
            "newProductTuningType"
        )
        .value =
            "reference";


    document
        .getElementById(
            "newProductImage"
        )
        .value =
            "";


    document
        .querySelectorAll(
            ".create-product-panel input[type='checkbox']"
        )
        .forEach(
            checkbox => {

                checkbox.checked =
                    checkbox.id ===
                    "newProductPublicVisible";

            }
        );

}


/* =========================================================
   AUTO SLUG
========================================================= */

function handleProductNameInput() {

    const name =
        document
            .getElementById(
                "newProductName"
            )
            .value;


    const slugInput =
        document.getElementById(
            "newProductSlug"
        );


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
   FREQUENCY RESPONSE
========================================================= */

function populateFrProductSelect() {

    const select =
        document.getElementById(
            "frProductSelect"
        );


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

                        <option
                            value="${product.id}"
                        >

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
                product.id ===
                current
        )
    ) {

        select.value =
            current;

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
        text
            .split(
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
            rawLine
                .trim();


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


    /*
     * Remove duplicate frequencies.
     */

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
            points.length - 1
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
            points.length - 1;
        index++
    ) {

        const left =
            points[
                index
            ];


        const right =
            points[
                index + 1
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

    const file =
        document
            .getElementById(
                "frFileInput"
            )
            .files[
                0
            ];


    if (
        !file
    ) {

        setMessage(
            "frMessage",
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


        document
            .getElementById(
                "saveFrButton"
            )
            .disabled =
                false;


        setMessage(
            "frMessage",
            `${points.length} measurement points loaded.`,
            "success"
        );

    }

    catch (
        error
    ) {

        parsedFrequencyResponse =
            [];


        document
            .getElementById(
                "saveFrButton"
            )
            .disabled =
                true;


        setMessage(
            "frMessage",
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
        document.getElementById(
            "adminFrCanvas"
        );


    const ctx =
        canvas.getContext(
            "2d"
        );


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


    const normalization =
        document
            .getElementById(
                "frNormalization"
            )
            .value;


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
                displayPoints.length - 1
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


    /* GRID */

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
            "rgba(255,255,255,0.10)";


        ctx.moveTo(
            left,
            y
        );


        ctx.lineTo(
            width - right,
            y
        );


        ctx.stroke();


        ctx.fillStyle =
            "#8e8e8e";


        ctx.fillText(
            `${db > 0 ? "+" : ""}${db}`,
            15,
            y + 5
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
                "rgba(255,255,255,0.07)";


            ctx.moveTo(
                x,
                top
            );


            ctx.lineTo(
                x,
                height - bottom
            );


            ctx.stroke();


            ctx.fillStyle =
                "#8e8e8e";


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
                x - 15,
                height - 20
            );

        }
    );


    /* CURVE */

    ctx.beginPath();


    ctx.strokeStyle =
        "#ff6a00";


    ctx.lineWidth =
        4;


    displayPoints.forEach(
        (
            point,
            index
        ) => {

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
                index ===
                0
            ) {

                ctx.moveTo(
                    x,
                    y
                );

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

    document
        .getElementById(
            "frPointCount"
        )
        .textContent =
            points.length;


    document
        .getElementById(
            "frMinFrequency"
        )
        .textContent =
            `${points[0].frequency.toFixed(1)} Hz`;


    document
        .getElementById(
            "frMaxFrequency"
        )
        .textContent =
            `${
                points[
                    points.length - 1
                ]
                .frequency
                .toFixed(1)
            } Hz`;


    document
        .getElementById(
            "frOneKhzLevel"
        )
        .textContent =
            `${
                interpolateResponse(
                    points,
                    1000
                )
                .toFixed(2)
            } dB`;

}


/* =========================================================
   SAVE FR
========================================================= */

async function saveFrequencyResponse() {

    const productId =
        document
            .getElementById(
                "frProductSelect"
            )
            .value;


    if (
        !productId
    ) {

        setMessage(
            "frMessage",
            "Select a product first.",
            "error"
        );


        return;

    }


    if (
        parsedFrequencyResponse.length ===
        0
    ) {

        setMessage(
            "frMessage",
            "Preview a valid measurement first.",
            "error"
        );


        return;

    }


    try {

        /*
         * Delete old response first.
         */

        const {
            error: deleteError
        } =
            await window.hcSupabase
                .from(
                    "product_frequency_response"
                )
                .delete()
                .eq(
                    "product_id",
                    productId
                );


        if (
            deleteError
        ) {

            throw deleteError;

        }


        /*
         * Store ORIGINAL measured values.
         *
         * Normalisation is done during comparison/display.
         */

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


        /*
         * Insert in batches so a large measurement
         * does not create an oversized request.
         */

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
                    index + batchSize
                );


            const {
                error
            } =
                await window.hcSupabase
                    .from(
                        "product_frequency_response"
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


        setMessage(
            "frMessage",
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
            "frMessage",
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
        document
            .getElementById(
                "frProductSelect"
            )
            .value;


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

        const {
            data,
            error
        } =
            await window.hcSupabase
                .from(
                    "product_frequency_response"
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
                );


        if (
            error
        ) {

            throw error;

        }


        const points =
            (
                data
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


            document
                .getElementById(
                    "saveFrButton"
                )
                .disabled =
                    false;


            setMessage(
                "frMessage",
                `${points.length} existing measurement points loaded.`,
                "success"
            );

        }

        else {

            drawAdminFrChart(
                []
            );


            document
                .getElementById(
                    "saveFrButton"
                )
                .disabled =
                    true;


            setMessage(
                "frMessage",
                "No frequency response saved for this product."
            );

        }

    }

    catch (
        error
    ) {

        console.error(
            error
        );


        setMessage(
            "frMessage",
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
        document
            .getElementById(
                "frProductSelect"
            )
            .value;


    if (
        !productId
    ) {

        setMessage(
            "frMessage",
            "Select a product first.",
            "error"
        );


        return;

    }


    showConfirm(

        "Delete frequency response?",

        "The product will no longer be available to the public tuning matcher until new measurement data is uploaded.",

        async () => {

            const {
                error
            } =
                await window.hcSupabase
                    .from(
                        "product_frequency_response"
                    )
                    .delete()
                    .eq(
                        "product_id",
                        productId
                    );


            if (
                error
            ) {

                alert(
                    error.message
                );


                return;

            }


            parsedFrequencyResponse =
                [];


            drawAdminFrChart(
                []
            );


            document
                .getElementById(
                    "saveFrButton"
                )
                .disabled =
                    true;


            setMessage(
                "frMessage",
                "Frequency response deleted.",
                "success"
            );


            closeConfirm();

        }

    );

}


/* =========================================================
   EVENTS
========================================================= */

document
    .getElementById(
        "adminLogoutButton"
    )
    ?.addEventListener(
        "click",
        logoutAdmin
    );


document
    .getElementById(
        "refreshAccountsButton"
    )
    ?.addEventListener(
        "click",
        loadAccounts
    );


document
    .getElementById(
        "refreshScansButton"
    )
    ?.addEventListener(
        "click",
        loadScans
    );


document
    .getElementById(
        "refreshProcessorsButton"
    )
    ?.addEventListener(
        "click",
        loadProcessors
    );


document
    .getElementById(
        "refreshProductsButton"
    )
    ?.addEventListener(
        "click",
        loadProducts
    );


document
    .getElementById(
        "scanStatusFilter"
    )
    ?.addEventListener(
        "change",
        renderScans
    );


document
    .getElementById(
        "clearScanFilterButton"
    )
    ?.addEventListener(
        "click",
        () => {

            document
                .getElementById(
                    "scanStatusFilter"
                )
                .value =
                    "";


            renderScans();

        }
    );


document
    .getElementById(
        "accountSearchInput"
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


document
    .getElementById(
        "newProductName"
    )
    ?.addEventListener(
        "input",
        handleProductNameInput
    );


document
    .getElementById(
        "newProductSlug"
    )
    ?.addEventListener(
        "input",
        event => {

            event.target.dataset.manual =
                event.target.value
                ?
                "true"
                :
                "";

        }
    );


document
    .getElementById(
        "addProductButton"
    )
    ?.addEventListener(
        "click",
        createProduct
    );


document
    .getElementById(
        "previewFrButton"
    )
    ?.addEventListener(
        "click",
        previewFrequencyResponse
    );


document
    .getElementById(
        "saveFrButton"
    )
    ?.addEventListener(
        "click",
        saveFrequencyResponse
    );


document
    .getElementById(
        "deleteFrButton"
    )
    ?.addEventListener(
        "click",
        confirmDeleteFrequencyResponse
    );


document
    .getElementById(
        "frProductSelect"
    )
    ?.addEventListener(
        "change",
        loadExistingFrequencyResponse
    );


document
    .getElementById(
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


document
    .getElementById(
        "confirmCancelButton"
    )
    ?.addEventListener(
        "click",
        closeConfirm
    );


document
    .getElementById(
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


        await Promise.all([

            loadScans(),

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


startAdmin();