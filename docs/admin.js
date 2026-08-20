const adminDB =
    window.hcSupabase;


/* =========================================================
   REQUIRE ADMIN
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
   SCANS
========================================================= */

async function loadAdminScans() {

    const list =
        document.getElementById(
            "adminScanList"
        );


    list.innerHTML = `
        <div class="admin-loading">
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

        console.error(error);

        list.innerHTML = `
            <div class="admin-loading">
                Unable to load scans.
            </div>
        `;

        return;
    }


    updateStats(
        scans || []
    );


    if (
        !scans ||
        scans.length === 0
    ) {

        list.innerHTML = `
            <div class="admin-loading">
                No ear scans yet.
            </div>
        `;

        return;
    }


    list.innerHTML =
        "";


    for (
        const scan
        of scans
    ) {

        const profile =
            await loadProfile(
                scan.user_id
            );


        list.appendChild(
            createScanCard(
                scan,
                profile
            )
        );
    }

}


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

        console.error(error);

        return {};
    }


    return data || {};
}


function updateStats(
    scans
) {

    document.getElementById(
        "totalScans"
    ).textContent =
        scans.length;


    document.getElementById(
        "processingScans"
    ).textContent =
        scans.filter(
            scan =>
                scan.status ===
                "processing"
        ).length;


    document.getElementById(
        "completeScans"
    ).textContent =
        scans.filter(
            scan =>
                scan.status ===
                "complete"
        ).length;


    document.getElementById(
        "failedScans"
    ).textContent =
        scans.filter(
            scan =>
                scan.status ===
                "failed"
        ).length;
}


function createScanCard(
    scan,
    profile
) {

    const card =
        document.createElement(
            "article"
        );


    card.className =
        "admin-scan-card";


    const date =
        new Date(
            scan.created_at
        )
        .toLocaleString(
            "en-GB"
        );


    card.innerHTML = `

        <div class="admin-card-top">

            <span>
                ${date}
            </span>

            <strong>
                ${String(scan.status).toUpperCase()}
            </strong>

        </div>


        <h3>
            ${profile.full_name || "Customer"}
        </h3>


        <div class="admin-customer">
            ${profile.email || scan.user_id}
        </div>


        <div class="admin-scan-meta">

            <div>

                <span>
                    LEFT EAR
                </span>

                <strong>
                    ${scan.left_image_count} IMAGES
                </strong>

            </div>


            <div>

                <span>
                    RIGHT EAR
                </span>

                <strong>
                    ${scan.right_image_count} IMAGES
                </strong>

            </div>

        </div>


        <div class="admin-scan-id">
            SCAN: ${scan.id}
        </div>


        <div class="admin-downloads">

            ${
                scan.left_stl_path
                ? `
                    <button
                        data-file="${scan.left_stl_path}"
                    >
                        DOWNLOAD LEFT STL
                    </button>
                `
                : ""
            }

            ${
                scan.right_stl_path
                ? `
                    <button
                        data-file="${scan.right_stl_path}"
                    >
                        DOWNLOAD RIGHT STL
                    </button>
                `
                : ""
            }

        </div>
    `;


    card
        .querySelectorAll(
            "[data-file]"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {
                        openPrivateFile(
                            button.dataset.file
                        );
                    }
                );

            }
        );


    return card;
}


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

        alert(
            "Unable to create download link."
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
   PRODUCTS
========================================================= */

async function loadProducts() {

    const container =
        document.getElementById(
            "adminProductList"
        );


    container.innerHTML = `
        <div class="admin-loading">
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


    if (error) {

        console.error(error);

        container.innerHTML = `
            <div class="admin-loading">
                Unable to load products.
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
            <div class="admin-loading">
                No products yet.
            </div>
        `;

        return;
    }


    products.forEach(
        product => {

            container.appendChild(
                createProductAdminCard(
                    product
                )
            );

        }
    );

}


function createProductAdminCard(
    product
) {

    const card =
        document.createElement(
            "article"
        );


    card.className =
        "admin-product-card";


    card.innerHTML = `

        <div class="admin-product-top">

            <div>

                <h3 class="admin-product-name">
                    ${product.name}
                </h3>

                <div class="admin-product-slug">
                    ${product.slug}
                </div>

            </div>

            <strong>
                ${formatProductStatus(product.status)}
            </strong>

        </div>


        <div class="admin-product-controls">


            <div class="admin-control">

                <label>
                    STATUS
                </label>

                <select
                    data-product-status
                >

                    ${statusOption(
                        "in_stock",
                        "In stock",
                        product.status
                    )}

                    ${statusOption(
                        "low_stock",
                        "Low stock",
                        product.status
                    )}

                    ${statusOption(
                        "out_of_stock",
                        "Out of stock",
                        product.status
                    )}

                    ${statusOption(
                        "coming_soon",
                        "Coming soon",
                        product.status
                    )}

                    ${statusOption(
                        "hidden",
                        "Hidden",
                        product.status
                    )}

                </select>

            </div>


            <div class="admin-control">

                <label>
                    STOCK QUANTITY
                </label>

                <input
                    data-product-stock
                    type="number"
                    min="0"
                    step="1"
                    value="${product.stock_quantity}"
                >

            </div>


            <div class="admin-control">

                <label>
                    PRICE GBP
                </label>

                <input
                    data-product-price
                    type="number"
                    min="0"
                    step="0.01"
                    value="${product.price_gbp ?? ""}"
                >

            </div>


            <div class="admin-control">

                <label>
                    DISPLAY ORDER
                </label>

                <input
                    data-product-order
                    type="number"
                    step="1"
                    value="${product.display_order}"
                >

            </div>


            <div class="admin-control">

                <label>
                    SUBTITLE
                </label>

                <input
                    data-product-subtitle
                    type="text"
                    value="${escapeHTML(product.subtitle || "")}"
                >

            </div>


            <div class="admin-control">

                <label>
                    IMAGE PATH
                </label>

                <input
                    data-product-image
                    type="text"
                    value="${escapeHTML(product.image_path || "")}"
                >

            </div>


            <div class="admin-control full">

                <label>
                    DESCRIPTION
                </label>

                <textarea
                    data-product-description
                >${escapeHTML(product.description || "")}</textarea>

            </div>


        </div>


        <button
            class="admin-save-product"
        >
            SAVE CHANGES
        </button>


        <button
            class="admin-delete-product"
        >
            DELETE PRODUCT
        </button>


        <div
            class="admin-product-message"
        ></div>
    `;


    card
        .querySelector(
            ".admin-save-product"
        )
        .addEventListener(
            "click",
            async () => {

                await saveProduct(
                    product.id,
                    card
                );

            }
        );


    card
        .querySelector(
            ".admin-delete-product"
        )
        .addEventListener(
            "click",
            async () => {

                await deleteProduct(
                    product.id,
                    product.name
                );

            }
        );


    return card;
}


function statusOption(
    value,
    text,
    current
) {

    return `
        <option
            value="${value}"
            ${
                value === current
                ? "selected"
                : ""
            }
        >
            ${text}
        </option>
    `;
}


async function saveProduct(
    productID,
    card
) {

    const message =
        card.querySelector(
            ".admin-product-message"
        );


    message.textContent =
        "Saving...";


    const status =
        card.querySelector(
            "[data-product-status]"
        ).value;


    const stock =
        Number(
            card.querySelector(
                "[data-product-stock]"
            ).value
        );


    const priceValue =
        card.querySelector(
            "[data-product-price]"
        ).value;


    const price =
        priceValue === ""
        ? null
        : Number(priceValue);


    const displayOrder =
        Number(
            card.querySelector(
                "[data-product-order]"
            ).value
        );


    const subtitle =
        card.querySelector(
            "[data-product-subtitle]"
        ).value.trim();


    const imagePath =
        card.querySelector(
            "[data-product-image]"
        ).value.trim();


    const description =
        card.querySelector(
            "[data-product-description]"
        ).value.trim();


    const {
        error
    } =
        await adminDB
            .from(
                "products"
            )
            .update({

                status,
                stock_quantity:
                    stock,

                price_gbp:
                    price,

                display_order:
                    displayOrder,

                subtitle,
                image_path:
                    imagePath,

                description,

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

        message.textContent =
            "Could not save.";

        return;
    }


    message.textContent =
        "Saved.";


    await loadProducts();
}


async function deleteProduct(
    productID,
    productName
) {

    const confirmed =
        confirm(
            `Delete ${productName}?`
        );


    if (!confirmed) {
        return;
    }


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


    if (error) {

        alert(
            "Could not delete product."
        );

        return;
    }


    await loadProducts();
}


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


    const subtitle =
        document.getElementById(
            "newProductSubtitle"
        ).value.trim();


    const imagePath =
        document.getElementById(
            "newProductImage"
        ).value.trim();


    const priceValue =
        document.getElementById(
            "newProductPrice"
        ).value;


    const price =
        priceValue === ""
        ? null
        : Number(priceValue);


    const stock =
        Number(
            document.getElementById(
                "newProductStock"
            ).value
        );


    const status =
        document.getElementById(
            "newProductStatus"
        ).value;


    const displayOrder =
        Number(
            document.getElementById(
                "newProductOrder"
            ).value
        );


    const description =
        document.getElementById(
            "newProductDescription"
        ).value.trim();


    message.textContent =
        "Adding product...";


    const {
        error
    } =
        await adminDB
            .from(
                "products"
            )
            .insert({

                name,
                slug,
                subtitle,
                description,

                image_path:
                    imagePath,

                price_gbp:
                    price,

                stock_quantity:
                    stock,

                status,

                display_order:
                    displayOrder

            });


    if (error) {

        console.error(error);

        message.textContent =
            error.message;

        return;
    }


    message.textContent =
        "Product added.";


    document.getElementById(
        "newProductName"
    ).value = "";


    document.getElementById(
        "newProductSlug"
    ).value = "";


    document.getElementById(
        "newProductSubtitle"
    ).value = "";


    document.getElementById(
        "newProductImage"
    ).value = "";


    document.getElementById(
        "newProductPrice"
    ).value = "";


    document.getElementById(
        "newProductStock"
    ).value = "0";


    document.getElementById(
        "newProductDescription"
    ).value = "";


    await loadProducts();
}


function formatProductStatus(
    status
) {

    switch (status) {

        case "in_stock":
            return "IN STOCK";

        case "low_stock":
            return "LOW STOCK";

        case "out_of_stock":
            return "OUT OF STOCK";

        case "coming_soon":
            return "COMING SOON";

        case "hidden":
            return "HIDDEN";

        default:
            return String(status).toUpperCase();
    }
}


function escapeHTML(
    value
) {

    return String(value)
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


document
    .getElementById(
        "refreshAdminButton"
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


    await Promise.all([

        loadAdminScans(),

        loadProducts()

    ]);
}


initialiseAdmin();