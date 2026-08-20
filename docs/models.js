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
   CONFIRM
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


    if (error) {

        console.error(error);

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
                            userScans.filter(
                                scan =>
                                    scan.status ===
                                    "complete"
                            ).length

                    };

                }
            );


    renderAccounts(
        cachedAccounts
    );


    updateAccountStats();

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
        cachedAccounts.filter(
            account =>
                account.scan_count > 0
        ).length;


    document
        .getElementById(
            "totalAdmins"
        )
        .textContent =
        cachedAccounts.filter(
            account =>
                account.is_admin
        ).length;

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


    accounts.forEach(
        account => {

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
                        data-view-scans
                        type="button"
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
                );


            container.appendChild(
                card
            );

        }
    );

}


/* =========================================================
   SCANS
========================================================= */

async function loadAdminScans() {

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


    if (error) {

        console.error(error);

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
        cachedScans.filter(
            scan =>
                scan.status ===
                "processing"
        ).length;


    document
        .getElementById(
            "completeScans"
        )
        .textContent =
        cachedScans.filter(
            scan =>
                scan.status ===
                "complete"
        ).length;


    document
        .getElementById(
            "failedScans"
        )
        .textContent =
        cachedScans.filter(
            scan =>
                scan.status ===
                "failed"
        ).length;

}


function renderScans(
    scans
) {

    const container =
        document.getElementById(
            "adminScanList"
        );


    container.innerHTML =
        "";


    scans.forEach(
        scan => {

            const profile =
                cachedAccounts.find(
                    account =>
                        account.id ===
                        scan.user_id
                ) || {};


            const card =
                document.createElement(
                    "article"
                );


            card.className =
                "scan-card";


            card.innerHTML = `

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
                            LEFT
                        </span>

                        <strong>

                            ${
                                scan.left_image_count ||
                                0
                            }
                            IMAGES

                        </strong>

                    </article>


                    <article>

                        <span>
                            RIGHT
                        </span>

                        <strong>

                            ${
                                scan.right_image_count ||
                                0
                            }
                            IMAGES

                        </strong>

                    </article>

                </div>


                <div class="scan-id">
                    ${escapeHTML(scan.id)}
                </div>

            `;


            container.appendChild(
                card
            );

        }
    );

}


function applyScanFilters() {

    let result =
        [...cachedScans];


    const status =
        document
            .getElementById(
                "scanStatusFilter"
            )
            .value;


    if (status) {

        result =
            result.filter(
                scan =>
                    scan.status ===
                    status
            );

    }


    if (
        selectedAccountUserID
    ) {

        result =
            result.filter(
                scan =>
                    scan.user_id ===
                    selectedAccountUserID
            );

    }


    renderScans(
        result
    );

}


/* =========================================================
   PRODUCTS
========================================================= */

async function loadProducts() {

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


    if (error) {

        console.error(error);

        return;
    }


    cachedProducts =
        data || [];


    updateProductStats();


    renderProducts();

}


/* =========================================================
   STOCK
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


    const quantity =
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
        quantity <= 0
    ) {
        return "out_of_stock";
    }


    if (
        quantity <= threshold
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
        cachedProducts.filter(
            product =>
                effectiveStockState(
                    product
                ) ===
                "in_stock"
        ).length;


    document
        .getElementById(
            "productsLowStock"
        )
        .textContent =
        cachedProducts.filter(
            product =>
                effectiveStockState(
                    product
                ) ===
                "low_stock"
        ).length;


    document
        .getElementById(
            "productsOutStock"
        )
        .textContent =
        cachedProducts.filter(
            product =>
                effectiveStockState(
                    product
                ) ===
                "out_of_stock"
        ).length;


    document
        .getElementById(
            "productsComingSoon"
        )
        .textContent =
        cachedProducts.filter(
            product =>
                product.status ===
                "coming_soon"
        ).length;

}


/* =========================================================
   PRODUCT CARD
========================================================= */

function renderProducts() {

    const container =
        document.getElementById(
            "adminProductList"
        );


    container.innerHTML =
        "";


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
            product.image_path
        );


    const imageSource =
        hasImage
        ? product.image_path
        : "assets/logo.png";


    card.innerHTML = `

        <div class="product-image-area">

            <img
                src="${escapeHTML(
                    imageSource
                )}"
                alt="${escapeHTML(
                    product.name
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

            </div>


            <div class="product-editor-grid">

                <label>

                    STATUS

                    <select data-status>

                        <option
                            value="in_stock"
                            ${
                                product.status ===
                                "in_stock"
                                ? "selected"
                                : ""
                            }
                        >
                            In stock
                        </option>

                        <option
                            value="low_stock"
                            ${
                                product.status ===
                                "low_stock"
                                ? "selected"
                                : ""
                            }
                        >
                            Low stock
                        </option>

                        <option
                            value="out_of_stock"
                            ${
                                product.status ===
                                "out_of_stock"
                                ? "selected"
                                : ""
                            }
                        >
                            Out of stock
                        </option>

                        <option
                            value="coming_soon"
                            ${
                                product.status ===
                                "coming_soon"
                                ? "selected"
                                : ""
                            }
                        >
                            Coming soon
                        </option>

                        <option
                            value="hidden"
                            ${
                                product.status ===
                                "hidden"
                                ? "selected"
                                : ""
                            }
                        >
                            Hidden
                        </option>

                    </select>

                </label>


                <label>

                    STOCK

                    <input
                        data-stock
                        type="number"
                        min="0"
                        value="${
                            product.stock_quantity ||
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
                            product.low_stock_threshold ||
                            3
                        }"
                    >

                </label>


                <label>

                    PRICE

                    <input
                        data-price
                        type="number"
                        step="0.01"
                        value="${
                            product.price_gbp ||
                            ""
                        }"
                    >

                </label>

            </div>


            <div class="product-image-upload">

                <input
                    data-image-file
                    type="file"
                    accept="
                        image/jpeg,
                        image/png,
                        image/webp
                    "
                >

            </div>


            <div class="product-card-actions">

                <button
                    data-save
                    class="primary-button"
                >
                    SAVE CHANGES
                </button>


                <button
                    data-upload
                    class="outline-button"
                >
                    CHANGE IMAGE
                </button>

            </div>


            <div
                data-message
                class="admin-message"
            ></div>

        </div>

    `;


    /*
        BROKEN IMAGE FALLBACK
    */

    const image =
        card.querySelector(
            "[data-product-image]"
        );


    image.addEventListener(
        "error",
        () => {

            if (
                image.dataset.fallbackApplied ===
                "true"
            ) {
                return;
            }


            image.dataset.fallbackApplied =
                "true";


            image.src =
                "assets/logo.png";


            image.classList.add(
                "product-image-placeholder"
            );

        }
    );


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


    return card;

}


/* =========================================================
   SAVE
========================================================= */

async function saveProduct(
    productID,
    card
) {

    const {
        error
    } =
        await adminDB
            .from(
                "products"
            )
            .update({

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
                            "[data-threshold]"
                        ).value
                    ),

                price_gbp:
                    Number(
                        card.querySelector(
                            "[data-price]"
                        ).value
                    ),

                updated_at:
                    new Date()
                        .toISOString()

            })
            .eq(
                "id",
                productID
            );


    if (error) {

        console.error(error);

        return;
    }


    await loadProducts();

}


/* =========================================================
   IMAGE UPLOAD
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


    if (!file) {

        alert(
            "Choose an image first."
        );

        return;
    }


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
                        file.type
                }
            );


    if (error) {

        console.error(error);

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


    await loadProducts();

}


/* =========================================================
   ADD PRODUCT
========================================================= */

async function addProduct() {

    const {
        error
    } =
        await adminDB
            .from(
                "products"
            )
            .insert({

                name:
                    document
                        .getElementById(
                            "newProductName"
                        )
                        .value
                        .trim(),

                slug:
                    document
                        .getElementById(
                            "newProductSlug"
                        )
                        .value
                        .trim(),

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
                    Number(
                        document
                            .getElementById(
                                "newProductPrice"
                            )
                            .value
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

            });


    if (error) {

        console.error(error);

        alert(
            error.message
        );

        return;
    }


    await loadProducts();

}


/* =========================================================
   HELPERS
========================================================= */

function formatStatus(
    value
) {

    return String(
        value || ""
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
    .addEventListener(
        "input",
        event => {

            const query =
                event.target.value
                    .toLowerCase();


            renderAccounts(

                cachedAccounts
                    .filter(
                        account =>

                            (
                                account.full_name ||
                                ""
                            )
                            .toLowerCase()
                            .includes(query)

                            ||

                            (
                                account.email ||
                                ""
                            )
                            .toLowerCase()
                            .includes(query)

                    )

            );

        }
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
        () => {

            selectedAccountUserID =
                null;


            document
                .getElementById(
                    "scanStatusFilter"
                )
                .value =
                "";


            renderScans(
                cachedScans
            );

        }
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


    if (!user) {
        return;
    }


    document
        .getElementById(
            "adminEmail"
        )
        .textContent =
        user.email;


    await loadAccounts();


    await Promise.all([
        loadAdminScans(),
        loadProducts()
    ]);

}


initialiseAdmin();