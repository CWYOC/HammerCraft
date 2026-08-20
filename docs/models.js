/* =========================================================
   HAMMER CRAFT
   PRODUCT + BASKET SYSTEM
========================================================= */


const modelDB =
    window.hcSupabase;


let currentModelUser =
    null;



/* =========================================================
   START
========================================================= */

async function initialiseModels() {

    if (!modelDB) {

        showModelError(
            "Supabase client unavailable."
        );

        return;
    }


    await loadCurrentModelUser();

    await loadPublicModels();

    await updateBasketCount();

}



/* =========================================================
   USER
========================================================= */

async function loadCurrentModelUser() {

    const {
        data
    } =
        await modelDB
            .auth
            .getUser();


    currentModelUser =
        data.user ||
        null;

}



/* =========================================================
   PRODUCTS
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
                        ascending:
                            true
                    }
                );


        if (error) {

            throw error;

        }


        const products =
            (data || [])
                .filter(
                    product =>
                        product.status !==
                        "hidden"
                );


        if (
            products.length ===
            0
        ) {

            container.innerHTML = `

                <div class="model-loading">

                    <strong>
                        NEW MODELS COMING SOON
                    </strong>

                    <p>

                        Hammer Craft models
                        are currently being prepared.

                    </p>

                </div>

            `;


            return;
        }


        container.innerHTML =
            "";


        products.forEach(
            product => {

                container.appendChild(
                    createPublicModelCard(
                        product
                    )
                );

            }
        );

    }

    catch (error) {

        console.error(
            error
        );


        showModelError(
            error.message ||
            "Unable to load products."
        );

    }

}



/* =========================================================
   PRODUCT CARD
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


    const hasImage =
        Boolean(
            product.image_path &&
            String(
                product.image_path
            )
            .trim()
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
        product.price_gbp ==
        null

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


            ${createFeatureTags(
                product
            )}


            <div class="model-action-area">

                ${createProductAction(
                    product
                )}

            </div>


            <div
                class="model-card-message"
                data-card-message
            ></div>

        </div>

    `;



    /* IMAGE FALLBACK */

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



    /* BASKET */

    const basketButton =
        card.querySelector(
            "[data-add-basket]"
        );


    if (
        basketButton
    ) {

        basketButton
            .addEventListener(
                "click",
                async () => {

                    await addProductToBasket(
                        product,
                        basketButton,
                        card
                    );

                }
            );

    }


    return card;

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



function stockText(
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


    return "IN STOCK";

}



/* =========================================================
   TAGS
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
        tags.length ===
        0
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
   BUTTON
========================================================= */

function createProductAction(
    product
) {

    const state =
        effectiveStockState(
            product
        );


    if (
        product.preorder_enabled ===
        true
    ) {

        return `

            <button
                type="button"
                class="model-button"
                data-add-basket
                data-order-type="preorder"
            >

                ADD PREORDER TO BASKET →

            </button>

        `;

    }


    if (
        state ===
        "coming_soon"
    ) {

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


    if (
        product.ordering_enabled ===
        true
    ) {

        return `

            <button
                type="button"
                class="model-button"
                data-add-basket
                data-order-type="standard"
            >

                ADD TO BASKET →

            </button>

        `;

    }


    return `

        <a
            href="product.html?model=${
                encodeURIComponent(
                    product.slug ||
                    ""
                )
            }"
            class="model-button"
        >

            EXPLORE MODEL →

        </a>

    `;

}



/* =========================================================
   ADD TO BASKET
========================================================= */

async function addProductToBasket(
    product,
    button,
    card
) {

    const message =
        card.querySelector(
            "[data-card-message]"
        );


    if (
        !currentModelUser
    ) {

        window.location.href =
            `login.html?redirect=${
                encodeURIComponent(
                    window.location.href
                )
            }`;


        return;
    }


    const orderType =
        button.dataset.orderType ||
        "standard";


    button.disabled =
        true;


    button.textContent =
        "ADDING...";


    message.textContent =
        "";


    try {

        const {
            data: existing,
            error: existingError
        } =
            await modelDB
                .from(
                    "basket_items"
                )
                .select(
                    "id,quantity"
                )
                .eq(
                    "user_id",
                    currentModelUser.id
                )
                .eq(
                    "product_id",
                    product.id
                )
                .eq(
                    "order_type",
                    orderType
                )
                .eq(
                    "custom_fit",
                    false
                )
                .eq(
                    "custom_tuning",
                    false
                )
                .maybeSingle();


        if (
            existingError
        ) {

            throw existingError;

        }


        if (
            existing
        ) {

            const next =
                Number(
                    existing.quantity
                )
                +
                1;


            const max =
                Number(
                    product.max_order_quantity ||
                    99
                );


            if (
                next >
                max
            ) {

                throw new Error(
                    `Maximum quantity is ${max}.`
                );

            }


            const {
                error
            } =
                await modelDB
                    .from(
                        "basket_items"
                    )
                    .update({

                        quantity:
                            next,

                        updated_at:
                            new Date()
                                .toISOString()

                    })
                    .eq(
                        "id",
                        existing.id
                    );


            if (
                error
            ) {

                throw error;

            }

        }

        else {

            const {
                error
            } =
                await modelDB
                    .from(
                        "basket_items"
                    )
                    .insert({

                        user_id:
                            currentModelUser.id,

                        product_id:
                            product.id,

                        quantity:
                            1,

                        order_type:
                            orderType,

                        custom_fit:
                            false,

                        custom_tuning:
                            false

                    });


            if (
                error
            ) {

                throw error;

            }

        }


        button.textContent =
            "ADDED ✓";


        message.textContent =
            "Added to your basket.";


        await updateBasketCount();

    }

    catch (error) {

        console.error(
            error
        );


        message.textContent =
            error.message ||
            "Unable to add item.";

    }


    setTimeout(
        () => {

            button.disabled =
                false;


            button.textContent =
                orderType ===
                "preorder"

                ? "ADD PREORDER TO BASKET →"

                : "ADD TO BASKET →";


            message.textContent =
                "";

        },
        1500
    );

}



/* =========================================================
   BASKET COUNT
========================================================= */

async function updateBasketCount() {

    const countElement =
        document.getElementById(
            "basketCount"
        );


    if (
        !countElement
    ) {

        return;
    }


    if (
        !currentModelUser
    ) {

        countElement.textContent =
            "0";

        return;
    }


    const {
        data,
        error
    } =
        await modelDB
            .from(
                "basket_items"
            )
            .select(
                "quantity"
            );


    if (
        error
    ) {

        console.error(
            error
        );

        return;
    }


    const total =
        (data || [])
            .reduce(
                (
                    sum,
                    item
                ) =>
                    sum +
                    Number(
                        item.quantity ||
                        0
                    ),
                0
            );


    countElement.textContent =
        total;

}



/* =========================================================
   ERROR
========================================================= */

function showModelError(
    message
) {

    const container =
        document.getElementById(
            "publicModelGrid"
        );


    if (
        !container
    ) {

        return;
    }


    container.innerHTML = `

        <div
            class="
                model-loading
                model-error
            "
        >

            <strong>
                PRODUCT SYSTEM ERROR
            </strong>


            <small>

                ${escapeHTML(
                    message
                )}

            </small>

        </div>

    `;

}



/* =========================================================
   ESCAPE
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
   START
========================================================= */

initialiseModels();