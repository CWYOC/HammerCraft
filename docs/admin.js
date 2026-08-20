const adminDB =
    window.hcSupabase;


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

let confirmCallback =
    null;


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
                confirmCallback
            ) {

                const callback =
                    confirmCallback;


                closeConfirm();


                await callback();
            }

        }
    );


/* =========================================================
   PROFILE
========================================================= */

async function loadProfile(
    userID
) {

    const {
        data,
        error
    } =
        await adminDB
            .from(
                "profiles"
            )
            .select(
                "full_name,email"
            )
            .eq(
                "id",
                userID
            )
            .maybeSingle();


    if (error) {

        console.error(
            "Profile load error:",
            error
        );


        return {};
    }


    return data || {};
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
        data: scans,
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
                    ascending: false
                }
            );


    if (error) {

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


    updateScanStats(
        scans || []
    );


    if (
        !scans ||
        scans.length === 0
    ) {

        container.innerHTML = `
            <div class="loading-card">
                No scans yet.
            </div>
        `;

        return;
    }


    container.innerHTML =
        "";


    for (
        const scan
        of scans
    ) {

        const profile =
            await loadProfile(
                scan.user_id
            );


        container.appendChild(
            createScanCard(
                scan,
                profile
            )
        );
    }
}


/* =========================================================
   STATS
========================================================= */

function updateScanStats(
    scans
) {

    document
        .getElementById(
            "totalScans"
        )
        .textContent =
        scans.length;


    document
        .getElementById(
            "processingScans"
        )
        .textContent =
        scans.filter(
            scan =>
                scan.status ===
                "processing"
        ).length;


    document
        .getElementById(
            "completeScans"
        )
        .textContent =
        scans.filter(
            scan =>
                scan.status ===
                "complete"
        ).length;


    document
        .getElementById(
            "failedScans"
        )
        .textContent =
        scans.filter(
            scan =>
                scan.status ===
                "failed"
        ).length;
}


/* =========================================================
   SCAN CARD
========================================================= */

function createScanCard(
    scan,
    profile
) {

    const card =
        document.createElement(
            "article"
        );


    card.className =
        "scan-card";


    const date =
        new Date(
            scan.created_at
        )
        .toLocaleString(
            "en-GB"
        );


    const name =
        profile.full_name ||
        "Customer";


    const email =
        profile.email ||
        scan.user_id;


    card.innerHTML = `

        <div class="scan-card-top">

            <span>
                ${date}
            </span>

            <strong class="scan-status">
                ${escapeHTML(scan.status).toUpperCase()}
            </strong>

        </div>


        <h3>
            ${escapeHTML(name)}
        </h3>


        <div class="scan-email">
            ${escapeHTML(email)}
        </div>


        <div class="scan-meta">

            <div>

                <span>
                    LEFT EAR
                </span>

                <strong>
                    ${scan.left_image_count}
                    IMAGES
                </strong>

            </div>


            <div>

                <span>
                    RIGHT EAR
                </span>

                <strong>
                    ${scan.right_image_count}
                    IMAGES
                </strong>

            </div>

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
                        data-right-stl
                    >
                        RIGHT STL
                    </button>
                `
                : ""
            }


            <button
                class="danger"
                data-delete-scan
            >
                DELETE SCAN
            </button>


            <button
                class="danger"
                data-delete-user
            >
                DELETE CUSTOMER
            </button>

        </div>
    `;


    const leftButton =
        card.querySelector(
            "[data-left-stl]"
        );


    if (leftButton) {

        leftButton.addEventListener(
            "click",
            () => {

                openPrivateFile(
                    scan.left_stl_path
                );

            }
        );
    }


    const rightButton =
        card.querySelector(
            "[data-right-stl]"
        );


    if (rightButton) {

        rightButton.addEventListener(
            "click",
            () => {

                openPrivateFile(
                    scan.right_stl_path
                );

            }
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

                    "This will permanently remove the scan record and every stored image/STL for this scan.",

                    () =>
                        deleteScan(
                            scan
                        )

                );

            }
        );


    card
        .querySelector(
            "[data-delete-user]"
        )
        .addEventListener(
            "click",
            () => {

                showConfirm(

                    "Delete customer account?",

                    "This removes the customer's authentication account and associated Hammer Craft data. This cannot be undone.",

                    () =>
                        deleteCustomer(
                            scan.user_id
                        )

                );

            }
        );


    return card;
}


/* =========================================================
   SIGNED STL
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
   COLLECT SCAN STORAGE FILES
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
                    limit: 1000
                }
            );


    if (error) {
        throw error;
    }


    for (
        const item
        of data || []
    ) {

        const path =
            `${folder}/${item.name}`;


        /*
            Supabase Storage list results
            representing files usually contain
            metadata.

            If there is no metadata, treat it
            as a folder and recurse.
        */

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
                error: storageError
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
                storageError
            ) {

                throw storageError;
            }

        }


        const {
            error: rowError
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
            rowError
        ) {

            throw rowError;
        }


        await loadAdminScans();

    }

    catch (
        error
    ) {

        console.error(
            "Delete scan error:",
            error
        );


        alert(
            "The scan could not be completely deleted."
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
            DO NOT use auth.admin.deleteUser()
            in this browser file.

            The Edge Function performs the
            privileged deletion.
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


        await loadAdminScans();

    }

    catch (
        error
    ) {

        console.error(
            "Delete customer error:",
            error
        );


        alert(
            "Customer deletion failed."
        );
    }
}


/* =========================================================
   LOAD PRODUCTS
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
        data: products,
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


        container.innerHTML = `
            <div class="loading-card">
                Products could not be loaded.
            </div>
        `;


        return;
    }


    container.innerHTML =
        "";


    if (
        !products ||
        products.length === 0
    ) {

        container.innerHTML = `
            <div class="loading-card">
                No products yet.
            </div>
        `;


        return;
    }


    products.forEach(
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


    card.innerHTML = `

        <div class="product-image-area">

            ${
                product.image_path
                ? `
                    <img
                        src="${escapeHTML(product.image_path)}"
                        alt="${escapeHTML(product.name)}"
                    >
                `
                : `
                    <div class="product-image-empty">
                        NO PRODUCT IMAGE
                    </div>
                `
            }


            <span class="product-status-badge">

                ${formatStatus(product.status)}

            </span>

        </div>


        <div class="product-card-content">

            <div class="product-card-top">

                <div>

                    <h3>
                        ${escapeHTML(product.name)}
                    </h3>

                    <div class="product-slug">
                        ${escapeHTML(product.slug)}
                    </div>

                </div>

            </div>


            <div class="product-editor-grid">


                <label>

                    STATUS

                    <select
                        data-status
                    >
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
                        value="${product.stock_quantity}"
                    >

                </label>


                <label>

                    PRICE GBP

                    <input
                        data-price
                        type="number"
                        min="0"
                        step="0.01"
                        value="${product.price_gbp ?? ""}"
                    >

                </label>


                <label>

                    DISPLAY ORDER

                    <input
                        data-order
                        type="number"
                        value="${product.display_order}"
                    >

                </label>


                <label>

                    SUBTITLE

                    <input
                        data-subtitle
                        type="text"
                        value="${escapeHTML(product.subtitle || "")}"
                    >

                </label>


                <label class="full-control">

                    DESCRIPTION

                    <textarea
                        data-description
                    >${escapeHTML(product.description || "")}</textarea>

                </label>

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
                    data-save
                >
                    SAVE CHANGES
                </button>


                <button
                    class="outline-button"
                    data-upload-image
                >
                    UPLOAD IMAGE
                </button>


                <button
                    class="danger-button"
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
            () => {

                saveProduct(
                    product.id,
                    card
                );

            }
        );


    card
        .querySelector(
            "[data-upload-image]"
        )
        .addEventListener(
            "click",
            () => {

                uploadProductImage(
                    product,
                    card
                );

            }
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

                    `${product.name} will be removed from the public website.`,

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
   PRODUCT STATUS
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
                        value === current
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


function formatStatus(
    status
) {

    return String(
        status
    )
        .replaceAll(
            "_",
            " "
        )
        .toUpperCase();
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
        ).value;


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

                price_gbp:
                    priceValue === ""
                    ? null
                    : Number(
                        priceValue
                    ),

                display_order:
                    Number(
                        card.querySelector(
                            "[data-order]"
                        ).value
                    ),

                subtitle:
                    card.querySelector(
                        "[data-subtitle]"
                    ).value.trim(),

                description:
                    card.querySelector(
                        "[data-description]"
                    ).value.trim(),

                updated_at:
                    new Date()
                        .toISOString()

            })
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
            "Could not save product.";


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


    if (
        ![
            "image/jpeg",
            "image/png",
            "image/webp"
        ].includes(
            file.type
        )
    ) {

        message.textContent =
            "Only JPG, PNG and WebP images are allowed.";


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
            "Image stored but product update failed.";


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
            "Product could not be deleted."
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
        document.getElementById(
            "newProductName"
        ).value.trim();


    const slug =
        document.getElementById(
            "newProductSlug"
        ).value.trim();


    if (
        !name ||
        !slug
    ) {

        message.textContent =
            "Name and slug are required.";


        return;
    }


    const priceValue =
        document.getElementById(
            "newProductPrice"
        ).value;


    const {
        data: inserted,
        error
    } =
        await adminDB
            .from(
                "products"
            )
            .insert({

                name,

                slug,

                subtitle:
                    document.getElementById(
                        "newProductSubtitle"
                    ).value.trim(),

                description:
                    document.getElementById(
                        "newProductDescription"
                    ).value.trim(),

                price_gbp:
                    priceValue === ""
                    ? null
                    : Number(
                        priceValue
                    ),

                stock_quantity:
                    Number(
                        document.getElementById(
                            "newProductStock"
                        ).value
                    ),

                status:
                    document.getElementById(
                        "newProductStatus"
                    ).value,

                display_order:
                    Number(
                        document.getElementById(
                            "newProductOrder"
                        ).value
                    )

            })
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
        document.getElementById(
            "newProductImage"
        )
        .files?.[0];


    if (
        image
    ) {

        /*
            Build a temporary card-like object
            so we can reuse uploadProductImage.
        */

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


        const fileInput =
            fakeCard.querySelector(
                "[data-image-file]"
            );


        const transfer =
            new DataTransfer();


        transfer.items.add(
            image
        );


        fileInput.files =
            transfer.files;


        await uploadProductImage(
            inserted,
            fakeCard
        );
    }


    message.textContent =
        "Product added.";


    clearNewProductForm();


    await loadProducts();
}


/* =========================================================
   CLEAR PRODUCT FORM
========================================================= */

function clearNewProductForm() {

    document
        .getElementById(
            "newProductName"
        )
        .value =
        "";


    document
        .getElementById(
            "newProductSlug"
        )
        .value =
        "";


    document
        .getElementById(
            "newProductSubtitle"
        )
        .value =
        "";


    document
        .getElementById(
            "newProductPrice"
        )
        .value =
        "";


    document
        .getElementById(
            "newProductStock"
        )
        .value =
        "0";


    document
        .getElementById(
            "newProductOrder"
        )
        .value =
        "0";


    document
        .getElementById(
            "newProductDescription"
        )
        .value =
        "";


    document
        .getElementById(
            "newProductImage"
        )
        .value =
        "";
}


/* =========================================================
   ESCAPE
========================================================= */

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
        "refreshScansButton"
    )
    .addEventListener(
        "click",
        loadAdminScans
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


    await Promise.all([

        loadAdminScans(),

        loadProducts()

    ]);
}


initialiseAdmin();