const adminDB =
    window.hcSupabase;


let cachedAccounts = [];
let cachedScans = [];
let cachedProducts = [];

let selectedAccountUserID =
    null;

let confirmCallback =
    null;


/* =========================================================
   ADMIN AUTH
========================================================= */

async function requireAdmin() {

    const {
        data,
        error
    } =
        await adminDB
            .auth
            .getUser();


    if (
        error ||
        !data.user
    ) {

        window.location.replace(
            "login.html"
        );

        return null;
    }


    const user =
        data.user;


    const {
        data: admin,
        error: adminError
    } =
        await adminDB
            .from(
                "admin_users"
            )
            .select(
                "user_id"
            )
            .eq(
                "user_id",
                user.id
            )
            .maybeSingle();


    if (
        adminError ||
        !admin
    ) {

        window.location.replace(
            "account.html"
        );

        return null;
    }


    return user;

}


/* =========================================================
   CONFIRM MODAL
========================================================= */

function showConfirm(
    title,
    text,
    callback
) {

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


    confirmCallback =
        callback;


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


    if (
        container
    ) {

        container.innerHTML = `
            <div class="loading-card">
                Loading accounts...
            </div>
        `;

    }


    const {
        data: profiles,
        error
    } =
        await adminDB
            .from(
                "profiles"
            )
            .select(
                "id,full_name,email,created_at"
            )
            .order(
                "created_at",
                {
                    ascending: false
                }
            );


    if (
        error
    ) {

        console.error(
            error
        );


        if (
            container
        ) {

            container.innerHTML = `
                <div class="loading-card">
                    Unable to load accounts.
                </div>
            `;

        }


        return;
    }


    const {
        data: scans
    } =
        await adminDB
            .from(
                "ear_scans"
            )
            .select(
                "id,user_id,status"
            );


    const {
        data: admins
    } =
        await adminDB
            .from(
                "admin_users"
            )
            .select(
                "user_id"
            );


    const adminSet =
        new Set(
            (admins || [])
                .map(
                    admin =>
                        admin.user_id
                )
        );


    cachedAccounts =
        (profiles || [])
            .map(
                profile => {

                    const userScans =
                        (scans || [])
                            .filter(
                                scan =>
                                    scan.user_id ===
                                    profile.id
                            );


                    return {

                        ...profile,

                        is_admin:
                            adminSet.has(
                                profile.id
                            ),

                        scan_count:
                            userScans.length,

                        complete_count:
                            userScans
                                .filter(
                                    scan =>
                                        scan.status ===
                                        "complete"
                                )
                                .length

                    };

                }
            );


    updateAccountStats();


    renderAccounts(
        cachedAccounts
    );

}


/* =========================================================
   ACCOUNT STATS
========================================================= */

function updateAccountStats() {

    const totalAccounts =
        document.getElementById(
            "totalAccounts"
        );


    const accountSummaryTotal =
        document.getElementById(
            "accountSummaryTotal"
        );


    const accountsWithScans =
        document.getElementById(
            "accountsWithScans"
        );


    const totalAdmins =
        document.getElementById(
            "totalAdmins"
        );


    if (
        totalAccounts
    ) {

        totalAccounts.textContent =
            cachedAccounts.length;

    }


    if (
        accountSummaryTotal
    ) {

        accountSummaryTotal.textContent =
            cachedAccounts.length;

    }


    if (
        accountsWithScans
    ) {

        accountsWithScans.textContent =
            cachedAccounts
                .filter(
                    account =>
                        account.scan_count >
                        0
                )
                .length;

    }


    if (
        totalAdmins
    ) {

        totalAdmins.textContent =
            cachedAccounts
                .filter(
                    account =>
                        account.is_admin
                )
                .length;

    }

}


/* =========================================================
   RENDER ACCOUNTS
========================================================= */

function renderAccounts(
    accounts
) {

    const container =
        document.getElementById(
            "adminAccountList"
        );


    if (
        !container
    ) {
        return;
    }


    container.innerHTML =
        "";


    if (
        accounts.length === 0
    ) {

        container.innerHTML = `
            <div class="loading-card">
                No matching accounts.
            </div>
        `;

        return;
    }


    accounts.forEach(
        account => {

            const card =
                document.createElement(
                    "article"
                );


            card.className =
                "account-card";


            const joined =
                account.created_at
                ? new Date(
                    account.created_at
                )
                    .toLocaleDateString(
                        "en-GB"
                    )
                : "—";


            card.innerHTML = `

                <div class="account-card-top">

                    <div>

                        <h3>
                            ${escapeHTML(
                                account.full_name ||
                                "Customer"
                            )}
                        </h3>

                        <div class="account-email">
                            ${escapeHTML(
                                account.email ||
                                ""
                            )}
                        </div>

                        <div class="account-id">
                            ${escapeHTML(
                                account.id
                            )}
                        </div>

                    </div>


                    <span class="
                        role-badge
                        ${
                            account.is_admin
                            ? "admin"
                            : ""
                        }
                    ">

                        ${
                            account.is_admin
                            ? "ADMIN"
                            : "CUSTOMER"
                        }

                    </span>

                </div>


                <div class="account-info">

                    <article>

                        <span>
                            JOINED
                        </span>

                        <strong>
                            ${joined}
                        </strong>

                    </article>


                    <article>

                        <span>
                            SCANS
                        </span>

                        <strong>
                            ${account.scan_count}
                        </strong>

                    </article>


                    <article>

                        <span>
                            COMPLETE
                        </span>

                        <strong>
                            ${account.complete_count}
                        </strong>

                    </article>

                </div>


                <div class="account-actions">

                    <button
                        type="button"
                        data-view-scans
                    >
                        VIEW SCANS
                    </button>

                </div>

            `;


            card
                .querySelector(
                    "[data-view-scans]"
                )
                .addEventListener(
                    "click",
                    () => {

                        selectedAccountUserID =
                            account.id;


                        const filter =
                            document.getElementById(
                                "activeScanFilter"
                            );


                        if (
                            filter
                        ) {

                            filter.hidden =
                                false;


                            filter.textContent =
                                `Showing scans for: ${
                                    account.full_name ||
                                    account.email ||
                                    "Customer"
                                }`;

                        }


                        applyScanFilters();


                        document
                            .getElementById(
                                "scans"
                            )
                            ?.scrollIntoView({
                                behavior:
                                    "smooth"
                            });

                    }
                );


            container.appendChild(
                card
            );

        }
    );

}


/* =========================================================
   ACCOUNT SEARCH
========================================================= */

function searchAccounts(
    query
) {

    query =
        query
            .trim()
            .toLowerCase();


    if (
        !query
    ) {

        renderAccounts(
            cachedAccounts
        );

        return;
    }


    const filtered =
        cachedAccounts
            .filter(
                account => {

                    const name =
                        (
                            account.full_name ||
                            ""
                        )
                        .toLowerCase();


                    const email =
                        (
                            account.email ||
                            ""
                        )
                        .toLowerCase();


                    const id =
                        (
                            account.id ||
                            ""
                        )
                        .toLowerCase();


                    return (
                        name.includes(
                            query
                        )
                        ||
                        email.includes(
                            query
                        )
                        ||
                        id.includes(
                            query
                        )
                    );

                }
            );


    renderAccounts(
        filtered
    );

}


/* =========================================================
   SCANS
========================================================= */

async function loadAdminScans() {

    const container =
        document.getElementById(
            "adminScanList"
        );


    if (
        container
    ) {

        container.innerHTML = `
            <div class="loading-card">
                Loading scans...
            </div>
        `;

    }


    const {
        data,
        error
    } =
        await adminDB
            .from(
                "ear_scans"
            )
            .select("*")
            .order(
                "created_at",
                {
                    ascending: false
                }
            );


    if (
        error
    ) {

        console.error(
            error
        );


        if (
            container
        ) {

            container.innerHTML = `
                <div class="loading-card">
                    Unable to load scans.
                </div>
            `;

        }


        return;
    }


    cachedScans =
        data || [];


    updateScanStats();


    renderScans(
        cachedScans
    );

}


/* =========================================================
   SCAN STATS
========================================================= */

function updateScanStats() {

    const total =
        document.getElementById(
            "totalScans"
        );


    const processing =
        document.getElementById(
            "processingScans"
        );


    const complete =
        document.getElementById(
            "completeScans"
        );


    const failed =
        document.getElementById(
            "failedScans"
        );


    if (
        total
    ) {

        total.textContent =
            cachedScans.length;

    }


    if (
        processing
    ) {

        processing.textContent =
            cachedScans
                .filter(
                    scan =>
                        scan.status ===
                        "processing"
                )
                .length;

    }


    if (
        complete
    ) {

        complete.textContent =
            cachedScans
                .filter(
                    scan =>
                        scan.status ===
                        "complete"
                )
                .length;

    }


    if (
        failed
    ) {

        failed.textContent =
            cachedScans
                .filter(
                    scan =>
                        scan.status ===
                        "failed"
                )
                .length;

    }

}


/* =========================================================
   RENDER SCANS
========================================================= */

function renderScans(
    scans
) {

    const container =
        document.getElementById(
            "adminScanList"
        );


    if (
        !container
    ) {
        return;
    }


    container.innerHTML =
        "";


    if (
        scans.length === 0
    ) {

        container.innerHTML = `
            <div class="loading-card">
                No matching scans.
            </div>
        `;

        return;
    }


    scans.forEach(
        scan => {

            const profile =
                cachedAccounts
                    .find(
                        account =>
                            account.id ===
                            scan.user_id
                    )
                || {};


            const date =
                scan.created_at
                ? new Date(
                    scan.created_at
                )
                    .toLocaleString(
                        "en-GB"
                    )
                : "—";


            const card =
                document.createElement(
                    "article"
                );


            card.className =
                "scan-card";


            card.innerHTML = `

                <div class="scan-card-top">

                    <span>
                        ${date}
                    </span>

                    <strong class="scan-status">
                        ${escapeHTML(
                            String(
                                scan.status ||
                                ""
                            )
                            .toUpperCase()
                        )}
                    </strong>

                </div>


                <h3>
                    ${escapeHTML(
                        profile.full_name ||
                        "Customer"
                    )}
                </h3>


                <div class="scan-email">
                    ${escapeHTML(
                        profile.email ||
                        scan.user_id
                    )}
                </div>


                <div class="scan-meta">

                    <article>

                        <span>
                            LEFT EAR
                        </span>

                        <strong>
                            ${
                                scan.left_image_count ??
                                0
                            }
                            IMAGES
                        </strong>

                    </article>


                    <article>

                        <span>
                            RIGHT EAR
                        </span>

                        <strong>
                            ${
                                scan.right_image_count ??
                                0
                            }
                            IMAGES
                        </strong>

                    </article>

                </div>


                <div class="scan-id">
                    SCAN:
                    ${escapeHTML(
                        scan.id
                    )}
                </div>

            `;


            container.appendChild(
                card
            );

        }
    );

}


/* =========================================================
   SCAN FILTER
========================================================= */

function applyScanFilters() {

    let scans =
        [...cachedScans];


    const status =
        document
            .getElementById(
                "scanStatusFilter"
            )
            ?.value
        || "";


    if (
        status
    ) {

        scans =
            scans.filter(
                scan =>
                    scan.status ===
                    status
            );

    }


    if (
        selectedAccountUserID
    ) {

        scans =
            scans.filter(
                scan =>
                    scan.user_id ===
                    selectedAccountUserID
            );

    }


    renderScans(
        scans
    );

}


function clearScanFilters() {

    selectedAccountUserID =
        null;


    const statusFilter =
        document.getElementById(
            "scanStatusFilter"
        );


    if (
        statusFilter
    ) {

        statusFilter.value =
            "";

    }


    const activeFilter =
        document.getElementById(
            "activeScanFilter"
        );


    if (
        activeFilter
    ) {

        activeFilter.hidden =
            true;

    }


    renderScans(
        cachedScans
    );

}


/* =========================================================
   PRODUCTS
========================================================= */

async function loadProducts() {

    const container =
        document.getElementById(
            "adminProductList"
        );


    if (
        container
    ) {

        container.innerHTML = `
            <div class="loading-card">
                Loading products...
            </div>
        `;

    }


    const {
        data,
        error
    } =
        await adminDB
            .from(
                "products"
            )
            .select("*")
            .order(
                "display_order",
                {
                    ascending: true
                }
            );


    if (
        error
    ) {

        console.error(
            error
        );


        if (
            container
        ) {

            container.innerHTML = `
                <div class="loading-card">
                    Unable to load products.
                </div>
            `;

        }


        return;
    }


    cachedProducts =
        data || [];


    updateProductStats();


    renderProducts();

}


/* =========================================================
   EFFECTIVE STOCK
========================================================= */

function effectiveStockState(
    product
) {

    if (
        product.status ===
        "coming_soon"
    ) {

        return "coming_soon";

    }


    if (
        product.status ===
        "hidden"
    ) {

        return "hidden";

    }


    if (
        product.status ===
        "out_of_stock"
    ) {

        return "out_of_stock";

    }


    const stock =
        Number(
            product.stock_quantity ??
            0
        );


    const threshold =
        Number(
            product.low_stock_threshold ??
            3
        );


    if (
        stock <= 0
    ) {

        return "out_of_stock";

    }


    if (
        stock <= threshold
    ) {

        return "low_stock";

    }


    return "in_stock";

}


/* =========================================================
   PRODUCT STATS
========================================================= */

function updateProductStats() {

    const total =
        document.getElementById(
            "totalProducts"
        );


    const inStock =
        document.getElementById(
            "productsInStock"
        );


    const lowStock =
        document.getElementById(
            "productsLowStock"
        );


    const outStock =
        document.getElementById(
            "productsOutStock"
        );


    const comingSoon =
        document.getElementById(
            "productsComingSoon"
        );


    if (
        total
    ) {

        total.textContent =
            cachedProducts.length;

    }


    if (
        inStock
    ) {

        inStock.textContent =
            cachedProducts
                .filter(
                    product =>
                        effectiveStockState(
                            product
                        ) ===
                        "in_stock"
                )
                .length;

    }


    if (
        lowStock
    ) {

        lowStock.textContent =
            cachedProducts
                .filter(
                    product =>
                        effectiveStockState(
                            product
                        ) ===
                        "low_stock"
                )
                .length;

    }


    if (
        outStock
    ) {

        outStock.textContent =
            cachedProducts
                .filter(
                    product =>
                        effectiveStockState(
                            product
                        ) ===
                        "out_of_stock"
                )
                .length;

    }


    if (
        comingSoon
    ) {

        comingSoon.textContent =
            cachedProducts
                .filter(
                    product =>
                        product.status ===
                        "coming_soon"
                )
                .length;

    }

}


/* =========================================================
   PRODUCT LIST
========================================================= */

function renderProducts() {

    const container =
        document.getElementById(
            "adminProductList"
        );


    if (
        !container
    ) {
        return;
    }


    container.innerHTML =
        "";


    if (
        cachedProducts.length === 0
    ) {

        container.innerHTML = `
            <div class="loading-card">
                No products yet.
            </div>
        `;

        return;
    }


    cachedProducts.forEach(
        product => {

            container.appendChild(
                createProductCard(
                    product
                )
            );

        }
    );

}


/* =========================================================
   PRODUCT CARD
========================================================= */

function createProductCard(
    product
) {

    const card =
        document.createElement(
            "article"
        );


    card.className =
        "product-card";


    const hasImage =
        Boolean(
            product.image_path &&
            String(
                product.image_path
            ).trim()
        );


    const imageSource =
        hasImage
        ? product.image_path
        : "assets/logo.png";


    const state =
        effectiveStockState(
            product
        );


    card.innerHTML = `

        <div class="product-image-area">

            <img
                src="${escapeHTML(
                    imageSource
                )}"
                alt="${escapeHTML(
                    product.name ||
                    "Hammer Craft"
                )}"
                class="
                    product-image
                    ${
                        hasImage
                        ? ""
                        : "product-image-placeholder"
                    }
                "
                data-product-image
            >


            <span class="product-status-badge">
                ${formatStatus(
                    product.status
                )}
            </span>

        </div>


        <div class="product-card-content">

            <div class="product-card-top">

                <div>

                    <h3>
                        ${escapeHTML(
                            product.name ||
                            "Unnamed model"
                        )}
                    </h3>


                    <div class="product-slug">

                        ${escapeHTML(
                            product.sku ||
                            "NO SKU"
                        )}

                        /

                        ${escapeHTML(
                            product.slug ||
                            ""
                        )}

                    </div>

                </div>


                <span class="
                    inventory-indicator
                    ${inventoryClass(
                        state
                    )}
                ">

                    ${inventoryText(
                        product
                    )}

                </span>

            </div>



            <div class="product-editor-grid">


                <!-- NEW: EDIT PRODUCT NAME -->

                <label class="full-control">

                    MODEL NAME

                    <input
                        data-name
                        type="text"
                        value="${escapeHTML(
                            product.name ||
                            ""
                        )}"
                    >

                </label>



                <label>

                    STATUS

                    <select data-status>
                        ${productStatusOptions(
                            product.status
                        )}
                    </select>

                </label>



                <label>

                    STOCK

                    <input
                        data-stock
                        type="number"
                        min="0"
                        value="${
                            product.stock_quantity ??
                            0
                        }"
                    >

                </label>



                <label>

                    LOW STOCK AT

                    <input
                        data-threshold
                        type="number"
                        min="0"
                        value="${
                            product.low_stock_threshold ??
                            3
                        }"
                    >

                </label>



                <label>

                    PRICE GBP

                    <input
                        data-price
                        type="number"
                        min="0"
                        step="0.01"
                        value="${
                            product.price_gbp ??
                            ""
                        }"
                    >

                </label>



                <label>

                    SKU

                    <input
                        data-sku
                        type="text"
                        value="${escapeHTML(
                            product.sku ||
                            ""
                        )}"
                    >

                </label>



                <label>

                    DISPLAY ORDER

                    <input
                        data-order
                        type="number"
                        value="${
                            product.display_order ??
                            0
                        }"
                    >

                </label>



                <label class="full-control">

                    SUBTITLE

                    <input
                        data-subtitle
                        type="text"
                        value="${escapeHTML(
                            product.subtitle ||
                            ""
                        )}"
                    >

                </label>



                <label class="full-control">

                    DESCRIPTION

                    <textarea
                        data-description
                    >${escapeHTML(
                        product.description ||
                        ""
                    )}</textarea>

                </label>

            </div>



            <div class="product-switch-grid">

                ${productSwitch(
                    "data-featured",
                    "FEATURED",
                    product.featured
                )}


                ${productSwitch(
                    "data-ordering",
                    "ORDERING ENABLED",
                    product.ordering_enabled
                )}


                ${productSwitch(
                    "data-preorder",
                    "PREORDER",
                    product.preorder_enabled
                )}


                ${productSwitch(
                    "data-custom-fit",
                    "CUSTOM FIT",
                    product.custom_fit_available
                )}


                ${productSwitch(
                    "data-custom-tuning",
                    "CUSTOM TUNING",
                    product.custom_tuning_available
                )}

            </div>



            <div class="product-image-upload">

                <label>

                    CHANGE PRODUCT IMAGE

                    <input
                        data-image-file
                        type="file"
                        accept="
                            image/png,
                            image/jpeg,
                            image/webp
                        "
                    >

                </label>

            </div>



            <div class="product-card-actions">

                <button
                    class="primary-button"
                    type="button"
                    data-save
                >
                    SAVE CHANGES
                </button>


                <button
                    class="outline-button"
                    type="button"
                    data-upload
                >
                    UPLOAD IMAGE
                </button>


                <button
                    class="danger-button"
                    type="button"
                    data-delete
                >
                    DELETE PRODUCT
                </button>

            </div>


            <div
                class="admin-message"
                data-message
            ></div>

        </div>

    `;



    /* =====================================================
       IMAGE FALLBACK
    ===================================================== */

    const image =
        card.querySelector(
            "[data-product-image]"
        );


    image.addEventListener(
        "error",
        () => {

            if (
                image.dataset.fallback ===
                "true"
            ) {

                return;
            }


            image.dataset.fallback =
                "true";


            image.src =
                "assets/logo.png";


            image.classList.add(
                "product-image-placeholder"
            );

        }
    );



    /* =====================================================
       SAVE
    ===================================================== */

    card
        .querySelector(
            "[data-save]"
        )
        .addEventListener(
            "click",
            () =>
                saveProduct(
                    product.id,
                    card
                )
        );



    /* =====================================================
       IMAGE
    ===================================================== */

    card
        .querySelector(
            "[data-upload]"
        )
        .addEventListener(
            "click",
            () =>
                uploadProductImage(
                    product,
                    card
                )
        );



    /* =====================================================
       DELETE
    ===================================================== */

    card
        .querySelector(
            "[data-delete]"
        )
        .addEventListener(
            "click",
            () => {

                showConfirm(

                    "Delete product?",

                    `${product.name} will be permanently removed.`,

                    () =>
                        deleteProduct(
                            product.id
                        )

                );

            }
        );


    return card;

}


/* =========================================================
   PRODUCT SWITCH
========================================================= */

function productSwitch(
    attribute,
    label,
    checked
) {

    return `

        <label class="product-switch">

            <input
                ${attribute}
                type="checkbox"
                ${
                    checked
                    ? "checked"
                    : ""
                }
            >

            <span>
                ${label}
            </span>

        </label>

    `;

}


/* =========================================================
   STATUS OPTIONS
========================================================= */

function productStatusOptions(
    current
) {

    const options = [

        [
            "in_stock",
            "In stock"
        ],

        [
            "low_stock",
            "Low stock"
        ],

        [
            "out_of_stock",
            "Out of stock"
        ],

        [
            "coming_soon",
            "Coming soon"
        ],

        [
            "hidden",
            "Hidden"
        ]

    ];


    return options
        .map(
            option => {

                const [
                    value,
                    label
                ] =
                    option;


                return `

                    <option
                        value="${value}"
                        ${
                            current ===
                            value
                            ? "selected"
                            : ""
                        }
                    >
                        ${label}
                    </option>

                `;

            }
        )
        .join("");

}


/* =========================================================
   INVENTORY TEXT
========================================================= */

function inventoryText(
    product
) {

    const state =
        effectiveStockState(
            product
        );


    if (
        state ===
        "coming_soon"
    ) {

        return "COMING SOON";

    }


    if (
        state ===
        "hidden"
    ) {

        return "HIDDEN";

    }


    if (
        state ===
        "out_of_stock"
    ) {

        return "OUT OF STOCK";

    }


    if (
        state ===
        "low_stock"
    ) {

        return `ONLY ${
            Number(
                product.stock_quantity ??
                0
            )
        } LEFT`;

    }


    return `${
        Number(
            product.stock_quantity ??
            0
        )
    } IN STOCK`;

}


function inventoryClass(
    state
) {

    if (
        state ===
        "in_stock"
    ) {

        return "inventory-good";

    }


    if (
        state ===
        "low_stock"
    ) {

        return "inventory-low";

    }


    return "inventory-empty";

}


/* =========================================================
   SAVE PRODUCT
========================================================= */

async function saveProduct(
    productID,
    card
) {

    const message =
        card.querySelector(
            "[data-message]"
        );


    message.textContent =
        "Saving...";


    const name =
        card.querySelector(
            "[data-name]"
        )
        .value
        .trim();


    if (
        !name
    ) {

        message.textContent =
            "Product name cannot be empty.";

        return;
    }


    const priceRaw =
        card.querySelector(
            "[data-price]"
        )
        .value;


    const payload = {

        /*
            NEW:
            PRODUCT NAME IS NOW EDITABLE
        */

        name:
            name,


        status:
            card.querySelector(
                "[data-status]"
            )
            .value,


        stock_quantity:
            Number(
                card.querySelector(
                    "[data-stock]"
                )
                .value
            ),


        low_stock_threshold:
            Number(
                card.querySelector(
                    "[data-threshold]"
                )
                .value
            ),


        price_gbp:
            priceRaw === ""
            ? null
            : Number(
                priceRaw
            ),


        sku:
            card.querySelector(
                "[data-sku]"
            )
            .value
            .trim(),


        display_order:
            Number(
                card.querySelector(
                    "[data-order]"
                )
                .value
            ),


        subtitle:
            card.querySelector(
                "[data-subtitle]"
            )
            .value
            .trim(),


        description:
            card.querySelector(
                "[data-description]"
            )
            .value
            .trim(),


        featured:
            card.querySelector(
                "[data-featured]"
            )
            .checked,


        ordering_enabled:
            card.querySelector(
                "[data-ordering]"
            )
            .checked,


        preorder_enabled:
            card.querySelector(
                "[data-preorder]"
            )
            .checked,


        custom_fit_available:
            card.querySelector(
                "[data-custom-fit]"
            )
            .checked,


        custom_tuning_available:
            card.querySelector(
                "[data-custom-tuning]"
            )
            .checked,


        updated_at:
            new Date()
                .toISOString()

    };


    const {
        error
    } =
        await adminDB
            .from(
                "products"
            )
            .update(
                payload
            )
            .eq(
                "id",
                productID
            );


    if (
        error
    ) {

        console.error(
            error
        );


        message.textContent =
            error.message;


        return;
    }


    message.textContent =
        "Saved.";


    await loadProducts();

}


/* =========================================================
   UPLOAD PRODUCT IMAGE
========================================================= */

async function uploadProductImage(
    product,
    card
) {

    const file =
        card.querySelector(
            "[data-image-file]"
        )
        .files?.[0];


    const message =
        card.querySelector(
            "[data-message]"
        );


    if (
        !file
    ) {

        message.textContent =
            "Choose an image first.";

        return;
    }


    const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp"
    ];


    if (
        !allowedTypes.includes(
            file.type
        )
    ) {

        message.textContent =
            "Use JPG, PNG or WebP.";

        return;
    }


    message.textContent =
        "Uploading image...";


    const extension =
        file.name
            .split(".")
            .pop()
            .toLowerCase();


    const path =
        `${product.id}/main-${Date.now()}.${extension}`;


    const {
        error: uploadError
    } =
        await adminDB
            .storage
            .from(
                "product-images"
            )
            .upload(
                path,
                file,
                {
                    contentType:
                        file.type,

                    upsert:
                        false
                }
            );


    if (
        uploadError
    ) {

        console.error(
            uploadError
        );


        message.textContent =
            uploadError.message;


        return;
    }


    const {
        data
    } =
        adminDB
            .storage
            .from(
                "product-images"
            )
            .getPublicUrl(
                path
            );


    const {
        error: updateError
    } =
        await adminDB
            .from(
                "products"
            )
            .update({

                image_path:
                    data.publicUrl,

                updated_at:
                    new Date()
                        .toISOString()

            })
            .eq(
                "id",
                product.id
            );


    if (
        updateError
    ) {

        console.error(
            updateError
        );


        message.textContent =
            updateError.message;


        return;
    }


    message.textContent =
        "Image updated.";


    await loadProducts();

}


/* =========================================================
   DELETE PRODUCT
========================================================= */

async function deleteProduct(
    productID
) {

    const {
        error
    } =
        await adminDB
            .from(
                "products"
            )
            .delete()
            .eq(
                "id",
                productID
            );


    if (
        error
    ) {

        console.error(
            error
        );


        alert(
            error.message
        );


        return;
    }


    await loadProducts();

}


/* =========================================================
   ADD PRODUCT
========================================================= */

async function addProduct() {

    const message =
        document.getElementById(
            "addProductMessage"
        );


    const name =
        document
            .getElementById(
                "newProductName"
            )
            .value
            .trim();


    const slug =
        document
            .getElementById(
                "newProductSlug"
            )
            .value
            .trim();


    if (
        !name
    ) {

        message.textContent =
            "Product name is required.";

        return;
    }


    if (
        !slug
    ) {

        message.textContent =
            "Slug is required.";

        return;
    }


    const priceRaw =
        document
            .getElementById(
                "newProductPrice"
            )
            .value;


    const launchRaw =
        document
            .getElementById(
                "newProductLaunchDate"
            )
            .value;


    const payload = {

        name:
            name,

        slug:
            slug,

        sku:
            document
                .getElementById(
                    "newProductSku"
                )
                .value
                .trim(),

        subtitle:
            document
                .getElementById(
                    "newProductSubtitle"
                )
                .value
                .trim(),

        description:
            document
                .getElementById(
                    "newProductDescription"
                )
                .value
                .trim(),

        price_gbp:
            priceRaw === ""
            ? null
            : Number(
                priceRaw
            ),

        stock_quantity:
            Number(
                document
                    .getElementById(
                        "newProductStock"
                    )
                    .value
            ),

        low_stock_threshold:
            Number(
                document
                    .getElementById(
                        "newProductLowThreshold"
                    )
                    .value
            ),

        status:
            document
                .getElementById(
                    "newProductStatus"
                )
                .value,

        display_order:
            Number(
                document
                    .getElementById(
                        "newProductOrder"
                    )
                    .value
            ),

        launch_date:
            launchRaw
            ? new Date(
                launchRaw
            )
                .toISOString()
            : null,

        max_order_quantity:
            Number(
                document
                    .getElementById(
                        "newProductMaxOrder"
                    )
                    .value
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

        custom_fit_available:
            document
                .getElementById(
                    "newProductCustomFit"
                )
                .checked,

        custom_tuning_available:
            document
                .getElementById(
                    "newProductCustomTuning"
                )
                .checked

    };


    message.textContent =
        "Creating product...";


    const {
        data: product,
        error
    } =
        await adminDB
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

        console.error(
            error
        );


        message.textContent =
            error.message;


        return;
    }


    const image =
        document
            .getElementById(
                "newProductImage"
            )
            .files?.[0];


    if (
        image
    ) {

        const fakeCard =
            document.createElement(
                "div"
            );


        fakeCard.innerHTML = `

            <input
                data-image-file
                type="file"
            >

            <div
                data-message
            ></div>

        `;

    }


    message.textContent =
        `Created ${product.name}.`;


    await loadProducts();

}


/* =========================================================
   HELPERS
========================================================= */

function formatStatus(
    value
) {

    return String(
        value ||
        ""
    )
        .replaceAll(
            "_",
            " "
        )
        .toUpperCase();

}


function escapeHTML(
    value
) {

    return String(
        value ??
        ""
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
            '"',
            "&quot;"
        )
        .replaceAll(
            "'",
            "&#039;"
        );

}


/* =========================================================
   EVENTS
========================================================= */

document
    .getElementById(
        "accountSearchInput"
    )
    ?.addEventListener(
        "input",
        event =>
            searchAccounts(
                event.target.value
            )
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
        loadAdminScans
    );


document
    .getElementById(
        "scanStatusFilter"
    )
    ?.addEventListener(
        "change",
        applyScanFilters
    );


document
    .getElementById(
        "clearScanFilterButton"
    )
    ?.addEventListener(
        "click",
        clearScanFilters
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
        "addProductButton"
    )
    ?.addEventListener(
        "click",
        addProduct
    );


document
    .getElementById(
        "adminLogoutButton"
    )
    ?.addEventListener(
        "click",
        async () => {

            await adminDB
                .auth
                .signOut();


            window.location.replace(
                "index.html"
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

            if (
                !confirmCallback
            ) {
                return;
            }


            const action =
                confirmCallback;


            closeConfirm();


            await action();

        }
    );


/* =========================================================
   INITIALISE
========================================================= */

async function initialiseAdmin() {

    const user =
        await requireAdmin();


    if (
        !user
    ) {
        return;
    }


    const adminEmail =
        document.getElementById(
            "adminEmail"
        );


    if (
        adminEmail
    ) {

        adminEmail.textContent =
            user.email;

    }


    await loadAccounts();


    await Promise.all([
        loadAdminScans(),
        loadProducts()
    ]);

}


initialiseAdmin();