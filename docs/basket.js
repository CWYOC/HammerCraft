/* =========================================================
   HAMMER CRAFT
   CUSTOMER BASKET
========================================================= */


const basketDB =
    window.hcSupabase;


let basketUser =
    null;


let basketRows =
    [];



/* =========================================================
   START
========================================================= */

async function initialiseBasket() {

    if (
        !basketDB
    ) {

        showBasketMessage(
            "Supabase client unavailable."
        );

        return;
    }


    const {
        data,
        error
    } =
        await basketDB
            .auth
            .getUser();


    if (
        error
    ) {

        console.error(
            error
        );

    }


    basketUser =
        data?.user ||
        null;


    if (
        !basketUser
    ) {

        showLoginRequired();

        return;
    }


    document
        .getElementById(
            "basketContent"
        )
        .hidden =
        false;


    await loadBasket();

}



/* =========================================================
   LOGIN
========================================================= */

function showLoginRequired() {

    const panel =
        document.getElementById(
            "basketLoginRequired"
        );


    panel.hidden =
        false;


    const button =
        document.getElementById(
            "basketLoginButton"
        );


    button.href =
        `login.html?redirect=${
            encodeURIComponent(
                window.location.href
            )
        }`;

}



/* =========================================================
   LOAD BASKET
========================================================= */

async function loadBasket() {

    const {
        data,
        error
    } =
        await basketDB
            .from(
                "basket_items"
            )
            .select(`
                id,
                user_id,
                product_id,
                quantity,
                order_type,
                custom_fit,
                custom_tuning,
                created_at,
                products (
                    id,
                    name,
                    sku,
                    slug,
                    price_gbp,
                    image_path,
                    stock_quantity,
                    low_stock_threshold,
                    max_order_quantity,
                    custom_fit_available,
                    custom_tuning_available,
                    preorder_enabled,
                    ordering_enabled,
                    status
                )
            `)
            .eq(
                "user_id",
                basketUser.id
            )
            .order(
                "created_at",
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


        showBasketMessage(
            error.message
        );

        return;
    }


    basketRows =
        data ||
        [];


    renderBasket();

}



/* =========================================================
   RENDER
========================================================= */

function renderBasket() {

    const container =
        document.getElementById(
            "basketItems"
        );


    container.innerHTML =
        "";


    const checkoutButton =
        document.getElementById(
            "checkoutButton"
        );


    if (
        basketRows.length ===
        0
    ) {

        container.innerHTML = `

            <div class="empty-basket">

                Your basket is empty.

                <br><br>

                <a href="index.html#models">
                    Browse Hammer Craft models →
                </a>

            </div>

        `;


        checkoutButton.disabled =
            true;


        updateSummary();


        return;
    }


    checkoutButton.disabled =
        false;


    basketRows.forEach(
        row => {

            const product =
                row.products;


            if (
                !product
            ) {

                return;
            }


            const hasImage =
                Boolean(
                    product.image_path
                );


            const image =
                hasImage
                ? product.image_path
                : "assets/logo.png";


            const lineTotal =
                Number(
                    product.price_gbp ||
                    0
                )
                *
                Number(
                    row.quantity
                );


            const item =
                document.createElement(
                    "article"
                );


            item.className =
                "basket-item";


            item.innerHTML = `

                <img
                    src="${escapeHTML(
                        image
                    )}"

                    alt="${escapeHTML(
                        product.name
                    )}"

                    class="
                        basket-item-image
                        ${
                            hasImage
                            ? ""
                            : "placeholder"
                        }
                    "

                    data-basket-image
                >


                <div>

                    <div class="basket-item-header">

                        <div>

                            <h2 class="basket-item-title">

                                ${escapeHTML(
                                    product.name
                                )}

                            </h2>


                            <div class="basket-item-type">

                                ${
                                    row.order_type ===
                                    "preorder"

                                    ? "PREORDER"

                                    : "STANDARD ORDER"
                                }

                            </div>

                        </div>


                        <strong class="basket-item-price">

                            £${lineTotal.toFixed(
                                2
                            )}

                        </strong>

                    </div>


                    <div class="basket-controls">


                        <div class="quantity-control">

                            <button
                                data-minus
                                type="button"
                            >
                                −
                            </button>


                            <span>
                                ${row.quantity}
                            </span>


                            <button
                                data-plus
                                type="button"
                            >
                                +
                            </button>

                        </div>


                        ${
                            product
                                .custom_fit_available
                            ? `

                                <label class="option-control">

                                    <input
                                        data-custom-fit
                                        type="checkbox"
                                        ${
                                            row.custom_fit
                                            ? "checked"
                                            : ""
                                        }
                                    >

                                    CUSTOM FIT

                                </label>

                            `
                            : ""
                        }


                        ${
                            product
                                .custom_tuning_available
                            ? `

                                <label class="option-control">

                                    <input
                                        data-custom-tuning
                                        type="checkbox"
                                        ${
                                            row.custom_tuning
                                            ? "checked"
                                            : ""
                                        }
                                    >

                                    CUSTOM TUNING

                                </label>

                            `
                            : ""
                        }


                        <button
                            data-remove
                            class="remove-button"
                            type="button"
                        >

                            REMOVE

                        </button>

                    </div>

                </div>

            `;



            /* IMAGE FALLBACK */

            const imageElement =
                item.querySelector(
                    "[data-basket-image]"
                );


            imageElement
                .addEventListener(
                    "error",
                    () => {

                        if (
                            imageElement
                                .dataset
                                .fallback ===
                            "true"
                        ) {

                            return;
                        }


                        imageElement
                            .dataset
                            .fallback =
                            "true";


                        imageElement.src =
                            "assets/logo.png";


                        imageElement
                            .classList
                            .add(
                                "placeholder"
                            );

                    }
                );



            /* MINUS */

            item
                .querySelector(
                    "[data-minus]"
                )
                .addEventListener(
                    "click",
                    () =>
                        changeQuantity(
                            row,
                            -1
                        )
                );



            /* PLUS */

            item
                .querySelector(
                    "[data-plus]"
                )
                .addEventListener(
                    "click",
                    () =>
                        changeQuantity(
                            row,
                            1
                        )
                );



            /* REMOVE */

            item
                .querySelector(
                    "[data-remove]"
                )
                .addEventListener(
                    "click",
                    () =>
                        removeBasketItem(
                            row.id
                        )
                );



            /* CUSTOM FIT */

            item
                .querySelector(
                    "[data-custom-fit]"
                )
                ?.addEventListener(
                    "change",
                    event =>
                        updateBasketOptions(
                            row.id,
                            {

                                custom_fit:
                                    event.target
                                        .checked

                            }
                        )
                );



            /* CUSTOM TUNING */

            item
                .querySelector(
                    "[data-custom-tuning]"
                )
                ?.addEventListener(
                    "change",
                    event =>
                        updateBasketOptions(
                            row.id,
                            {

                                custom_tuning:
                                    event.target
                                        .checked

                            }
                        )
                );


            container.appendChild(
                item
            );

        }
    );


    updateSummary();

}



/* =========================================================
   QUANTITY
========================================================= */

async function changeQuantity(
    row,
    amount
) {

    const product =
        row.products;


    let next =
        Number(
            row.quantity
        )
        +
        amount;


    if (
        next < 1
    ) {

        await removeBasketItem(
            row.id
        );

        return;
    }


    const max =
        Number(
            product
                ?.max_order_quantity ||
            99
        );


    if (
        next > max
    ) {

        showBasketMessage(
            `Maximum quantity for ${product.name} is ${max}.`
        );

        return;
    }


    if (
        row.order_type ===
        "standard"
    ) {

        const stock =
            Number(
                product
                    ?.stock_quantity ||
                0
            );


        if (
            next > stock
        ) {

            showBasketMessage(
                `Only ${stock} currently available.`
            );

            return;
        }

    }


    const {
        error
    } =
        await basketDB
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
                row.id
            );


    if (
        error
    ) {

        showBasketMessage(
            error.message
        );

        return;
    }


    await loadBasket();

}



/* =========================================================
   OPTIONS
========================================================= */

async function updateBasketOptions(
    id,
    payload
) {

    const {
        error
    } =
        await basketDB
            .from(
                "basket_items"
            )
            .update({

                ...payload,

                updated_at:
                    new Date()
                        .toISOString()

            })
            .eq(
                "id",
                id
            );


    if (
        error
    ) {

        showBasketMessage(
            error.message
        );

        return;
    }


    await loadBasket();

}



/* =========================================================
   REMOVE
========================================================= */

async function removeBasketItem(
    id
) {

    const {
        error
    } =
        await basketDB
            .from(
                "basket_items"
            )
            .delete()
            .eq(
                "id",
                id
            );


    if (
        error
    ) {

        showBasketMessage(
            error.message
        );

        return;
    }


    await loadBasket();

}



/* =========================================================
   SUMMARY
========================================================= */

function updateSummary() {

    const itemCount =
        basketRows
            .reduce(
                (
                    total,
                    row
                ) =>
                    total +
                    Number(
                        row.quantity ||
                        0
                    ),
                0
            );


    const subtotal =
        basketRows
            .reduce(
                (
                    total,
                    row
                ) => {

                    const price =
                        Number(
                            row.products
                                ?.price_gbp ||
                            0
                        );


                    return (
                        total +
                        price *
                        Number(
                            row.quantity ||
                            0
                        )
                    );

                },
                0
            );


    document
        .getElementById(
            "basketItemCount"
        )
        .textContent =
        itemCount;


    document
        .getElementById(
            "basketSubtotal"
        )
        .textContent =
        `£${subtotal.toFixed(
            2
        )}`;

}



/* =========================================================
   CHECKOUT
========================================================= */

async function checkoutBasket() {

    if (
        basketRows.length ===
        0
    ) {

        return;
    }


    const button =
        document.getElementById(
            "checkoutButton"
        );


    button.disabled =
        true;


    button.textContent =
        "OPENING PAYPAL...";


    showBasketMessage(
        ""
    );


    const {
        data,
        error
    } =
        await basketDB
            .functions
            .invoke(
                "paypal-create-basket-order",
                {
                    body: {}
                }
            );


    if (
        error ||
        !data?.approval_url
    ) {

        console.error(
            error,
            data
        );


        showBasketMessage(
            data?.error ||
            error?.message ||
            "Unable to start checkout."
        );


        button.disabled =
            false;


        button.textContent =
            "CHECKOUT WITH PAYPAL →";


        return;
    }


    window.location.href =
        data.approval_url;

}



/* =========================================================
   MESSAGE
========================================================= */

function showBasketMessage(
    message
) {

    const element =
        document.getElementById(
            "basketMessage"
        );


    if (
        element
    ) {

        element.textContent =
            message ||
            "";

    }

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
   EVENT
========================================================= */

document
    .getElementById(
        "checkoutButton"
    )
    .addEventListener(
        "click",
        checkoutBasket
    );



/* =========================================================
   START
========================================================= */

initialiseBasket();