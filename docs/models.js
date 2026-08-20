/* =========================================================
   HAMMER CRAFT
   PUBLIC PRODUCT SYSTEM
========================================================= */


console.log(
    "Hammer Craft models.js started."
);


const modelDB =
    window.hcSupabase;



/* =========================================================
   START
========================================================= */

async function initialiseModels() {

    const container =
        document.getElementById(
            "publicModelGrid"
        );


    if (!container) {

        console.error(
            "publicModelGrid does not exist."
        );

        return;
    }


    if (!modelDB) {

        showModelError(
            "Supabase client did not load."
        );

        return;
    }


    await loadPublicModels();

}



/* =========================================================
   LOAD PRODUCTS
========================================================= */

async function loadPublicModels() {

    const container =
        document.getElementById(
            "publicModelGrid"
        );


    if (!container) {
        return;
    }


    container.innerHTML = `

        <div class="model-loading">
            Loading models...
        </div>

    `;


    try {

        console.log(
            "Requesting products from Supabase..."
        );


        /*
            IMPORTANT:

            Use * here.

            This prevents the entire query from
            breaking when one newer optional
            product column does not exist yet.
        */

        const {
            data,
            error
        } =
            await modelDB
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


        console.log(
            "Supabase products result:",
            data
        );


        console.log(
            "Supabase products error:",
            error
        );


        if (error) {

            showModelError(
                error.message ||
                "Unable to read products."
            );

            return;
        }


        const products =
            (data || [])
                .filter(
                    product =>
                        product.status !==
                        "hidden"
                );


        if (
            products.length === 0
        ) {

            container.innerHTML = `

                <div class="model-loading">

                    <strong>
                        NEW MODELS COMING SOON
                    </strong>

                    <p>
                        Hammer Craft models are currently
                        being prepared.
                    </p>

                </div>

            `;

            return;
        }


        container.innerHTML =
            "";


        for (
            const product
            of products
        ) {

            container.appendChild(
                createPublicModelCard(
                    product
                )
            );

        }

    }

    catch (error) {

        console.error(
            "Unexpected model loader error:",
            error
        );


        showModelError(
            error.message ||
            "Unexpected product loading error."
        );

    }

}



/* =========================================================
   CREATE PRODUCT CARD
========================================================= */

function createPublicModelCard(
    product
) {

    const card =
        document.createElement(
            "article"
        );


    card.className =
        "public-model-card";


    /*
        IMAGE FALLBACK
    */

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


    const price =
        product.price_gbp === null ||
        product.price_gbp === undefined ||
        product.price_gbp === ""

        ? ""

        : `£${Number(
            product.price_gbp
        ).toFixed(2)}`;


    card.innerHTML = `

        <div class="model-image-wrap">

            <img
                src="${escapeHTML(
                    imageSource
                )}"
                alt="${escapeHTML(
                    product.name ||
                    "Hammer Craft"
                )}"
                class="
                    model-image
                    ${
                        hasImage
                        ? ""
                        : "model-image-placeholder"
                    }
                "
                data-model-image
            >


            <span
                class="
                    model-status
                    ${state}
                "
            >

                ${stockText(
                    product
                )}

            </span>

        </div>


        <div class="model-content">

            <div class="model-top">

                <div>

                    <div class="model-subtitle">

                        ${escapeHTML(
                            product.subtitle ||
                            "HAMMER CRAFT"
                        )}

                    </div>


                    <h3>

                        ${escapeHTML(
                            product.name ||
                            "Hammer Craft"
                        )}

                    </h3>

                </div>


                ${
                    price
                    ? `

                        <strong class="model-price">
                            ${price}
                        </strong>

                    `
                    : ""
                }

            </div>


            ${
                product.description
                ? `

                    <p>
                        ${escapeHTML(
                            product.description
                        )}
                    </p>

                `
                : ""
            }


            ${createFeatureTags(product)}


            ${createProductAction(product)}

        </div>

    `;



    /* =====================================================
       BROKEN IMAGE FALLBACK
    ===================================================== */

    const image =
        card.querySelector(
            "[data-model-image]"
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
                "model-image-placeholder"
            );

        }
    );


    return card;

}



/* =========================================================
   STOCK STATE
========================================================= */

function effectiveStockState(
    product
) {

    /*
        Coming soon has priority.
    */

    if (
        product.status ===
        "coming_soon"
    ) {

        return "coming_soon";

    }


    /*
        Explicit out-of-stock has priority.
    */

    if (
        product.status ===
        "out_of_stock"
    ) {

        return "out_of_stock";

    }


    const quantity =
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



/* =========================================================
   STOCK LABEL
========================================================= */

function stockText(
    product
) {

    const state =
        effectiveStockState(
            product
        );


    switch (state) {

        case "coming_soon":

            return "COMING SOON";


        case "out_of_stock":

            return "OUT OF STOCK";


        case "low_stock":

            return `ONLY ${
                Number(
                    product.stock_quantity ??
                    0
                )
            } LEFT`;


        default:

            return "IN STOCK";

    }

}



/* =========================================================
   OPTIONAL FEATURE TAGS
========================================================= */

function createFeatureTags(
    product
) {

    const tags =
        [];


    if (
        product.featured ===
        true
    ) {

        tags.push(
            "FEATURED"
        );

    }


    if (
        product.custom_fit_available ===
        true
    ) {

        tags.push(
            "CUSTOM FIT"
        );

    }


    if (
        product.custom_tuning_available ===
        true
    ) {

        tags.push(
            "CUSTOM TUNING"
        );

    }


    if (
        product.preorder_enabled ===
        true
    ) {

        tags.push(
            "PREORDER"
        );

    }


    if (
        tags.length === 0
    ) {

        return "";

    }


    return `

        <div class="model-feature-list">

            ${
                tags
                    .map(
                        tag => `

                            <span>
                                ${tag}
                            </span>

                        `
                    )
                    .join("")
            }

        </div>

    `;

}



/* =========================================================
   PRODUCT BUTTON
========================================================= */

function createProductAction(
    product
) {

    const state =
        effectiveStockState(
            product
        );


    const slug =
        encodeURIComponent(
            product.slug ||
            ""
        );


    /*
        Coming soon
    */

    if (
        state ===
        "coming_soon"
    ) {

        if (
            product.preorder_enabled ===
            true
        ) {

            return `

                <a
                    href="product.html?model=${slug}"
                    class="model-button"
                >

                    VIEW PREORDER →

                </a>

            `;

        }


        return `

            <button
                class="
                    model-button
                    disabled
                "
                disabled
            >

                COMING SOON

            </button>

        `;

    }


    /*
        Out of stock
    */

    if (
        state ===
        "out_of_stock"
    ) {

        return `

            <button
                class="
                    model-button
                    disabled
                "
                disabled
            >

                OUT OF STOCK

            </button>

        `;

    }


    /*
        Normal product
    */

    return `

        <a
            href="product.html?model=${slug}"
            class="model-button"
        >

            EXPLORE MODEL →

        </a>

    `;

}



/* =========================================================
   ERROR DISPLAY
========================================================= */

function showModelError(
    message
) {

    const container =
        document.getElementById(
            "publicModelGrid"
        );


    if (!container) {
        return;
    }


    container.innerHTML = `

        <div class="
            model-loading
            model-error
        ">

            <strong>
                PRODUCT SYSTEM ERROR
            </strong>

            <p>
                The Hammer Craft product database
                could not be loaded.
            </p>

            <small>
                ${escapeHTML(message)}
            </small>

        </div>

    `;

}



/* =========================================================
   HTML SAFETY
========================================================= */

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
   INITIAL LOAD
========================================================= */

initialiseModels();


/* =========================================================
   REALTIME PRODUCT UPDATES
========================================================= */

if (
    modelDB
) {

    try {

        modelDB
            .channel(
                "hammer-craft-products"
            )
            .on(

                "postgres_changes",

                {
                    event: "*",
                    schema: "public",
                    table: "products"
                },

                () => {

                    console.log(
                        "Product change detected."
                    );


                    loadPublicModels();

                }

            )
            .subscribe();

    }

    catch (error) {

        /*
            Realtime failing should NOT stop
            the actual products from loading.
        */

        console.warn(
            "Realtime unavailable:",
            error
        );

    }

}