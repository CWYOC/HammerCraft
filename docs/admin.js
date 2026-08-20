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
        data: userData,
        error: userError
    } =
        await adminDB
            .auth
            .getUser();


    if (
        userError ||
        !userData.user
    ) {

        window.location.replace(
            "login.html"
        );

        return null;
    }


    const user =
        userData.user;


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


    container.innerHTML = `
        <div class="loading-card">
            Loading accounts...
        </div>
    `;


    const {
        data: profiles,
        error: profileError
    } =
        await adminDB
            .from(
                "profiles"
            )
            .select(
                `
                id,
                full_name,
                email,
                created_at
                `
            )
            .order(
                "created_at",
                {
                    ascending: false
                }
            );


    if (
        profileError
    ) {

        console.error(
            "Profile load:",
            profileError
        );


        container.innerHTML = `
            <div class="loading-card">
                Unable to load accounts.
            </div>
        `;


        return;
    }


    const {
        data: scans,
        error: scanError
    } =
        await adminDB
            .from(
                "ear_scans"
            )
            .select(
                `
                id,
                user_id,
                status,
                created_at
                `
            );


    if (
        scanError
    ) {

        console.error(
            scanError
        );
    }


    /*
        Because some admin_users RLS setups only
        allow a person to read their own admin row,
        failure here should not stop account loading.
    */

    const {
        data: adminRows
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
            (adminRows || [])
                .map(
                    item =>
                        item.user_id
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

                        scans:
                            userScans,

                        scan_count:
                            userScans.length,

                        complete_count:
                            userScans.filter(
                                scan =>
                                    scan.status ===
                                    "complete"
                            ).length

                    };

                }
            );


    updateAccountStats();


    renderAccounts(
        cachedAccounts
    );

}


function updateAccountStats() {

    document
        .getElementById(
            "totalAccounts"
        )
        .textContent =
        cachedAccounts.length;


    document
        .getElementById(
            "accountSummaryTotal"
        )
        .textContent =
        cachedAccounts.length;


    document
        .getElementById(
            "accountsWithScans"
        )
        .textContent =
        cachedAccounts
            .filter(
                account =>
                    account.scan_count > 0
            )
            .length;


    document
        .getElementById(
            "totalAdmins"
        )
        .textContent =
        cachedAccounts
            .filter(
                account =>
                    account.is_admin
            )
            .length;

}


function renderAccounts(
    accounts
) {

    const container =
        document.getElementById(
            "adminAccountList"
        );


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

            const joined =
                account.created_at
                ? new Date(
                    account.created_at
                )
                    .toLocaleDateString(
                        "en-GB"
                    )
                : "—";


            const card =
                document.createElement(
                    "article"
                );


            card.className =
                "account-card";


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


                    ${
                        !account.is_admin
                        ? `
                            <button
                                type="button"
                                class="danger"
                                data-delete-user
                            >
                                DELETE CUSTOMER
                            </button>
                        `
                        : ""
                    }

                </div>

            `;


            card
                .querySelector(
                    "[data-view-scans]"
                )
                .addEventListener(
                    "click",
                    () => {

                        filterScansByUser(
                            account.id,
                            account.full_name ||
                            account.email ||
                            "Customer"
                        );

                    }
                );


            const deleteButton =
                card.querySelector(
                    "[data-delete-user]"
                );


            if (
                deleteButton
            ) {

                deleteButton
                    .addEventListener(
                        "click",
                        () => {

                            showConfirm(

                                "Delete customer?",

                                `Permanently delete ${
                                    account.email ||
                                    "this customer"
                                } and their associated account data?`,

                                () =>
                                    deleteCustomer(
                                        account.id
                                    )

                            );

                        }
                    );

            }


            container
                .appendChild(
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
                        account.id
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
   LOAD SCANS
========================================================= */

async function loadAdminScans() {

    const container =
        document.getElementById(
            "adminScanList"
        );


    container.innerHTML = `
        <div class="loading-card">
            Loading scans...
        </div>
    `;


    const {
        data,
        error
    } =
        await adminDB
            .from(
                "ear_scans"
            )
            .select(
                `
                id,
                user_id,
                status,
                left_image_count,
                right_image_count,
                left_stl_path,
                right_stl_path,
                created_at,
                updated_at
                `
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

        console.error(
            error
        );


        container.innerHTML = `
            <div class="loading-card">
                Unable to load scans.
            </div>
        `;


        return;
    }


    cachedScans =
        data || [];


    updateScanStats();


    renderScans(
        cachedScans
    );

}


function updateScanStats() {

    document
        .getElementById(
            "totalScans"
        )
        .textContent =
        cachedScans.length;


    document
        .getElementById(
            "processingScans"
        )
        .textContent =
        cachedScans
            .filter(
                scan =>
                    scan.status ===
                    "processing"
            )
            .length;


    document
        .getElementById(
            "completeScans"
        )
        .textContent =
        cachedScans
            .filter(
                scan =>
                    scan.status ===
                    "complete"
            )
            .length;


    document
        .getElementById(
            "failedScans"
        )
        .textContent =
        cachedScans
            .filter(
                scan =>
                    scan.status ===
                    "failed"
            )
            .length;

}


/* =========================================================
   GET PROFILE
========================================================= */

function profileForUser(
    userID
) {

    return cachedAccounts
        .find(
            account =>
                account.id ===
                userID
        )
        || {};

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
                profileForUser(
                    scan.user_id
                );


            container.appendChild(
                createScanCard(
                    scan,
                    profile
                )
            );

        }
    );

}


function createScanCard(
    scan,
    profile
) {

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
            ${escapeHTML(scan.id)}

        </div>


        <div class="scan-actions">

            ${
                scan.left_stl_path
                ? `
                    <button
                        type="button"
                        data-left-stl
                    >
                        LEFT STL
                    </button>
                `
                : ""
            }


            ${
                scan.right_stl_path
                ? `
                    <button
                        type="button"
                        data-right-stl
                    >
                        RIGHT STL
                    </button>
                `
                : ""
            }


            <button
                type="button"
                class="danger"
                data-delete-scan
            >
                DELETE SCAN
            </button>

        </div>

    `;


    const leftButton =
        card.querySelector(
            "[data-left-stl]"
        );


    if (
        leftButton
    ) {

        leftButton
            .addEventListener(
                "click",
                () =>
                    openPrivateFile(
                        scan.left_stl_path
                    )
            );

    }


    const rightButton =
        card.querySelector(
            "[data-right-stl]"
        );


    if (
        rightButton
    ) {

        rightButton
            .addEventListener(
                "click",
                () =>
                    openPrivateFile(
                        scan.right_stl_path
                    )
            );

    }


    card
        .querySelector(
            "[data-delete-scan]"
        )
        .addEventListener(
            "click",
            () => {

                showConfirm(

                    "Delete scan?",

                    "This permanently removes the scan record and its stored files.",

                    () =>
                        deleteScan(
                            scan
                        )

                );

            }
        );


    return card;
}


/* =========================================================
   SCAN FILTERS
========================================================= */

function applyScanFilters() {

    let scans =
        [...cachedScans];


    const status =
        document
            .getElementById(
                "scanStatusFilter"
            )
            .value;


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


function filterScansByUser(
    userID,
    label
) {

    selectedAccountUserID =
        userID;


    const active =
        document
            .getElementById(
                "activeScanFilter"
            );


    active.hidden =
        false;


    active.textContent =
        `Showing scans for: ${label}`;


    applyScanFilters();


    document
        .getElementById(
            "scans"
        )
        .scrollIntoView({
            behavior:
                "smooth"
        });

}


function clearScanFilters() {

    selectedAccountUserID =
        null;


    document
        .getElementById(
            "scanStatusFilter"
        )
        .value =
        "";


    document
        .getElementById(
            "activeScanFilter"
        )
        .hidden =
        true;


    renderScans(
        cachedScans
    );

}


/* =========================================================
   PRIVATE FILE
========================================================= */

async function openPrivateFile(
    path
) {

    const {
        data,
        error
    } =
        await adminDB
            .storage
            .from(
                "ear-scans"
            )
            .createSignedUrl(
                path,
                600
            );


    if (
        error ||
        !data?.signedUrl
    ) {

        console.error(
            error
        );


        alert(
            "Unable to open file."
        );


        return;
    }


    window.open(
        data.signedUrl,
        "_blank",
        "noopener"
    );

}


/* =========================================================
   STORAGE RECURSION
========================================================= */

async function collectStorageFiles(
    folder,
    paths = []
) {

    const {
        data,
        error
    } =
        await adminDB
            .storage
            .from(
                "ear-scans"
            )
            .list(
                folder,
                {
                    limit:
                        1000
                }
            );


    if (
        error
    ) {

        throw error;
    }


    for (
        const item
        of data || []
    ) {

        if (
            !item.name
        ) {

            continue;
        }


        const path =
            `${folder}/${item.name}`;


        if (
            item.metadata
        ) {

            paths.push(
                path
            );

        } else {

            await collectStorageFiles(
                path,
                paths
            );

        }

    }


    return paths;

}


/* =========================================================
   DELETE SCAN
========================================================= */

async function deleteScan(
    scan
) {

    try {

        const root =
            `${scan.user_id}/${scan.id}`;


        const files =
            await collectStorageFiles(
                root
            );


        if (
            files.length > 0
        ) {

            const {
                error
            } =
                await adminDB
                    .storage
                    .from(
                        "ear-scans"
                    )
                    .remove(
                        files
                    );


            if (
                error
            ) {

                throw error;
            }

        }


        const {
            error
        } =
            await adminDB
                .from(
                    "ear_scans"
                )
                .delete()
                .eq(
                    "id",
                    scan.id
                );


        if (
            error
        ) {

            throw error;
        }


        await Promise.all([
            loadAdminScans(),
            loadAccounts()
        ]);

    }

    catch (
        error
    ) {

        console.error(
            error
        );


        alert(
            "Scan deletion failed."
        );

    }

}


/* =========================================================
   DELETE CUSTOMER
========================================================= */

async function deleteCustomer(
    userID
) {

    try {

        /*
            Privileged Auth deletion stays
            inside the Edge Function.
        */

        const {
            data,
            error
        } =
            await adminDB
                .functions
                .invoke(
                    "delete-customer",
                    {
                        body: {
                            user_id:
                                userID
                        }
                    }
                );


        if (
            error
        ) {

            throw error;
        }


        if (
            data?.error
        ) {

            throw new Error(
                data.error
            );
        }


        await Promise.all([
            loadAccounts(),
            loadAdminScans()
        ]);

    }

    catch (
        error
    ) {

        console.error(
            error
        );


        alert(
            "Customer deletion failed."
        );

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


    container.innerHTML = `
        <div class="loading-card">
            Loading products...
        </div>
    `;


    const {
        data,
        error
    } =
        await adminDB
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

        console.error(
            error
        );


        container.innerHTML = `
            <div class="loading-card">
                Unable to load products.
            </div>
        `;


        return;
    }


    cachedProducts =
        data || [];


    updateProductStats();


    renderProducts();

}


/* =========================================================
   PRODUCT STATS
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


    const stock =
        Number(
            product.stock_quantity ||
            0
        );


    const threshold =
        Number(
            product.low_stock_threshold ||
            0
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


function updateProductStats() {

    document
        .getElementById(
            "totalProducts"
        )
        .textContent =
        cachedProducts.length;


    document
        .getElementById(
            "productsInStock"
        )
        .textContent =
        cachedProducts
            .filter(
                product =>
                    effectiveStockState(
                        product
                    ) ===
                    "in_stock"
            )
            .length;


    document
        .getElementById(
            "productsLowStock"
        )
        .textContent =
        cachedProducts
            .filter(
                product =>
                    effectiveStockState(
                        product
                    ) ===
                    "low_stock"
            )
            .length;


    document
        .getElementById(
            "productsOutStock"
        )
        .textContent =
        cachedProducts
            .filter(
                product =>
                    effectiveStockState(
                        product
                    ) ===
                    "out_of_stock"
            )
            .length;


    document
        .getElementById(
            "productsComingSoon"
        )
        .textContent =
        cachedProducts
            .filter(
                product =>
                    product.status ===
                    "coming_soon"
            )
            .length;

}


/* =========================================================
   RENDER PRODUCTS
========================================================= */

function renderProducts() {

    const container =
        document.getElementById(
            "adminProductList"
        );


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


    cachedProducts
        .forEach(
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


    const stockState =
        effectiveStockState(
            product
        );


    card.innerHTML = `

        <div class="product-image-area">

            <img
                src="${
                    product.image_path
                        ? escapeHTML(product.image_path)
                        : "assets/logo.png"
                }"
                alt="${escapeHTML(product.name)}"
                class="${
                    product.image_path
                        ? "product-image"
                        : "product-image product-image-placeholder"
                }"
                onerror="
                    this.onerror=null;
                    this.src='assets/logo.png';
                    this.classList.add('product-image-placeholder');
                "
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
                            product.name
                        )}
                    </h3>

                    <div class="product-slug">

                        ${escapeHTML(
                            product.sku ||
                            "NO SKU"
                        )}

                        /

                        ${escapeHTML(
                            product.slug
                        )}

                    </div>

                </div>


                <span class="
                    inventory-indicator
                    ${inventoryClass(
                        stockState
                    )}
                ">

                    ${inventoryText(
                        product
                    )}

                </span>

            </div>


            <div class="product-editor-grid">

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
                        data-low-threshold
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

                    MAX PER ORDER

                    <input
                        data-max-order
                        type="number"
                        min="1"
                        value="${
                            product.max_order_quantity ??
                            1
                        }"
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

                    LAUNCH DATE

                    <input
                        data-launch
                        type="datetime-local"
                        value="${toLocalInputDate(
                            product.launch_date
                        )}"
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
                        accept="image/png,image/jpeg,image/webp"
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
                    data-upload-image
                >
                    UPLOAD IMAGE
                </button>


                <button
                    class="danger-button"
                    type="button"
                    data-delete-product
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


    card
        .querySelector(
            "[data-upload-image]"
        )
        .addEventListener(
            "click",
            () =>
                uploadProductImage(
                    product,
                    card
                )
        );


    card
        .querySelector(
            "[data-delete-product]"
        )
        .addEventListener(
            "click",
            () => {

                showConfirm(

                    "Delete product?",

                    `${product.name} will be permanently removed from the catalog.`,

                    () =>
                        deleteProduct(
                            product
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
   INVENTORY LABEL
========================================================= */

function inventoryClass(
    state
) {

    switch (
        state
    ) {

        case "in_stock":
            return "inventory-good";

        case "low_stock":
            return "inventory-low";

        default:
            return "inventory-empty";

    }

}


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
            product.stock_quantity
        } LEFT`;
    }


    return `${
        product.stock_quantity
    } IN STOCK`;

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
            ([value, label]) => `

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

            `
        )
        .join("");

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


    const priceValue =
        card.querySelector(
            "[data-price]"
        )
        .value;


    const launchValue =
        card.querySelector(
            "[data-launch]"
        )
        .value;


    const payload = {

        status:
            card.querySelector(
                "[data-status]"
            ).value,

        stock_quantity:
            Number(
                card.querySelector(
                    "[data-stock]"
                ).value
            ),

        low_stock_threshold:
            Number(
                card.querySelector(
                    "[data-low-threshold]"
                ).value
            ),

        price_gbp:
            priceValue === ""
            ? null
            : Number(
                priceValue
            ),

        max_order_quantity:
            Number(
                card.querySelector(
                    "[data-max-order]"
                ).value
            ),

        display_order:
            Number(
                card.querySelector(
                    "[data-order]"
                ).value
            ),

        sku:
            card.querySelector(
                "[data-sku]"
            )
            .value
            .trim(),

        launch_date:
            launchValue
            ? new Date(
                launchValue
            )
                .toISOString()
            : null,

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
            ).checked,

        ordering_enabled:
            card.querySelector(
                "[data-ordering]"
            ).checked,

        preorder_enabled:
            card.querySelector(
                "[data-preorder]"
            ).checked,

        custom_fit_available:
            card.querySelector(
                "[data-custom-fit]"
            ).checked,

        custom_tuning_available:
            card.querySelector(
                "[data-custom-tuning]"
            ).checked,

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
            "Could not save.";


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

    const input =
        card.querySelector(
            "[data-image-file]"
        );


    const message =
        card.querySelector(
            "[data-message]"
        );


    const file =
        input.files?.[0];


    if (
        !file
    ) {

        message.textContent =
            "Choose an image first.";


        return;
    }


    const allowed = [
        "image/jpeg",
        "image/png",
        "image/webp"
    ];


    if (
        !allowed.includes(
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
            "Image upload failed.";


        return;
    }


    const {
        data: publicData
    } =
        adminDB
            .storage
            .from(
                "product-images"
            )
            .getPublicUrl(
                path
            );


    const publicURL =
        publicData.publicUrl;


    const {
        error: updateError
    } =
        await adminDB
            .from(
                "products"
            )
            .update({

                image_path:
                    publicURL,

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
            "Image uploaded but database update failed.";


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
    product
) {

    try {

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
                    product.id
                );


        if (
            error
        ) {

            throw error;
        }


        await loadProducts();

    }

    catch (
        error
    ) {

        console.error(
            error
        );


        alert(
            "Product deletion failed."
        );

    }

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
        !name ||
        !slug
    ) {

        message.textContent =
            "Name and slug are required.";


        return;
    }


    const priceValue =
        document
            .getElementById(
                "newProductPrice"
            )
            .value;


    const launchValue =
        document
            .getElementById(
                "newProductLaunchDate"
            )
            .value;


    const payload = {

        name,

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
            priceValue === ""
            ? null
            : Number(
                priceValue
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
            launchValue
            ? new Date(
                launchValue
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

        await uploadNewProductImage(
            product,
            image
        );

    }


    message.textContent =
        "Product created.";


    clearNewProductForm();


    await loadProducts();

}


/* =========================================================
   UPLOAD INITIAL PRODUCT IMAGE
========================================================= */

async function uploadNewProductImage(
    product,
    file
) {

    const extension =
        file.name
            .split(".")
            .pop()
            .toLowerCase();


    const path =
        `${product.id}/main-${Date.now()}.${extension}`;


    const {
        error
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
        error
    ) {

        throw error;
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


    await adminDB
        .from(
            "products"
        )
        .update({
            image_path:
                data.publicUrl
        })
        .eq(
            "id",
            product.id
        );

}


/* =========================================================
   CLEAR NEW PRODUCT FORM
========================================================= */

function clearNewProductForm() {

    const textFields = [
        "newProductName",
        "newProductSku",
        "newProductSlug",
        "newProductPrice",
        "newProductLaunchDate",
        "newProductSubtitle",
        "newProductDescription"
    ];


    textFields.forEach(
        id => {

            document
                .getElementById(
                    id
                )
                .value =
                "";

        }
    );


    document
        .getElementById(
            "newProductStock"
        )
        .value =
        "0";


    document
        .getElementById(
            "newProductLowThreshold"
        )
        .value =
        "3";


    document
        .getElementById(
            "newProductOrder"
        )
        .value =
        "0";


    document
        .getElementById(
            "newProductMaxOrder"
        )
        .value =
        "1";


    document
        .getElementById(
            "newProductStatus"
        )
        .value =
        "coming_soon";


    [
        "newProductFeatured",
        "newProductOrdering",
        "newProductPreorder",
        "newProductCustomFit",
        "newProductCustomTuning"
    ]
        .forEach(
            id => {

                document
                    .getElementById(
                        id
                    )
                    .checked =
                    false;

            }
        );


    document
        .getElementById(
            "newProductImage"
        )
        .value =
        "";

}


/* =========================================================
   HELPERS
========================================================= */

function formatStatus(
    status
) {

    return String(
        status ||
        ""
    )
        .replaceAll(
            "_",
            " "
        )
        .toUpperCase();

}


function toLocalInputDate(
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


    const offset =
        date.getTimezoneOffset();


    const adjusted =
        new Date(
            date.getTime() -
            offset * 60000
        );


    return adjusted
        .toISOString()
        .slice(
            0,
            16
        );

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
        "confirmCancelButton"
    )
    .addEventListener(
        "click",
        closeConfirm
    );


document
    .getElementById(
        "confirmActionButton"
    )
    .addEventListener(
        "click",
        async () => {

            if (
                !confirmCallback
            ) {

                return;
            }


            const callback =
                confirmCallback;


            closeConfirm();


            await callback();

        }
    );


document
    .getElementById(
        "accountSearchInput"
    )
    .addEventListener(
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
    .addEventListener(
        "click",
        loadAccounts
    );


document
    .getElementById(
        "refreshScansButton"
    )
    .addEventListener(
        "click",
        loadAdminScans
    );


document
    .getElementById(
        "scanStatusFilter"
    )
    .addEventListener(
        "change",
        applyScanFilters
    );


document
    .getElementById(
        "clearScanFilterButton"
    )
    .addEventListener(
        "click",
        clearScanFilters
    );


document
    .getElementById(
        "refreshProductsButton"
    )
    .addEventListener(
        "click",
        loadProducts
    );


document
    .getElementById(
        "addProductButton"
    )
    .addEventListener(
        "click",
        addProduct
    );


document
    .getElementById(
        "adminLogoutButton"
    )
    .addEventListener(
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


    document
        .getElementById(
            "adminEmail"
        )
        .textContent =
        user.email;


    /*
        Load profiles first so scan cards can
        immediately resolve customer names.
    */

    await loadAccounts();


    await Promise.all([
        loadAdminScans(),
        loadProducts()
    ]);

}


initialiseAdmin();