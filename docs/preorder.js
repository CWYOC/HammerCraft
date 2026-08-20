const preorderDB =
    window.hcSupabase;


let currentUser =
    null;


let currentProduct =
    null;



/* =========================================================
   INITIALISE
========================================================= */

async function initialisePreorder() {

    if (
        !preorderDB
    ) {

        showFatalError(
            "Supabase client unavailable."
        );

        return;
    }


    const slug =
        getModelSlug();


    if (
        !slug
    ) {

        showFatalError(
            "No model was selected."
        );

        return;
    }


    await loadProduct(
        slug
    );


    if (
        !currentProduct
    ) {

        return;
    }


    await loadCurrentUser();

}



/* =========================================================
   GET MODEL FROM URL
========================================================= */

function getModelSlug() {

    const params =
        new URLSearchParams(
            window.location.search
        );


    return params.get(
        "model"
    );

}



/* =========================================================
   LOAD PRODUCT
========================================================= */

async function loadProduct(
    slug
) {

    const {
        data,
        error
    } =
        await preorderDB
            .from(
                "products"
            )
            .select("*")
            .eq(
                "slug",
                slug
            )
            .maybeSingle();


    if (
        error
    ) {

        console.error(
            error
        );


        showFatalError(
            error.message
        );

        return;
    }


    if (
        !data
    ) {

        showFatalError(
            "This model could not be found."
        );

        return;
    }


    if (
        data.preorder_enabled !==
        true
    ) {

        showFatalError(
            "Preorders are not currently available for this model."
        );

        return;
    }


    currentProduct =
        data;


    renderProduct(
        data
    );

}



/* =========================================================
   RENDER PRODUCT
========================================================= */

function renderProduct(
    product
) {

    const panel =
        document.getElementById(
            "productPanel"
        );


    const hasImage =
        Boolean(
            product.image_path &&
            String(
                product.image_path
            ).trim()
        );


    const image =
        hasImage
        ? product.image_path
        : "assets/logo.png";


    const price =
        product.price_gbp == null
        ? ""
        : `£${Number(
            product.price_gbp
        ).toFixed(2)}`;


    panel.innerHTML = `

        <img
            src="${escapeHTML(image)}"
            alt="${escapeHTML(
                product.name
            )}"
            class="
                product-image
                ${
                    hasImage
                    ? ""
                    : "logo-placeholder"
                }
            "
            id="preorderProductImage"
        >


        <div class="product-details">

            <div class="product-status">
                PREORDER AVAILABLE
            </div>


            <h2>
                ${escapeHTML(
                    product.name
                )}
            </h2>


            ${
                price
                ? `

                    <div class="product-price">
                        ${price}
                    </div>

                `
                : ""
            }


            ${
                product.description
                ? `

                    <p class="product-description">

                        ${escapeHTML(
                            product.description
                        )}

                    </p>

                `
                : ""
            }

        </div>

    `;


    const imageElement =
        document.getElementById(
            "preorderProductImage"
        );


    imageElement.addEventListener(
        "error",
        () => {

            if (
                imageElement.dataset.fallback ===
                "true"
            ) {

                return;
            }


            imageElement.dataset.fallback =
                "true";


            imageElement.src =
                "assets/logo.png";


            imageElement.classList.add(
                "logo-placeholder"
            );

        }
    );

}



/* =========================================================
   USER AUTH
========================================================= */

async function loadCurrentUser() {

    const {
        data,
        error
    } =
        await preorderDB
            .auth
            .getUser();


    if (
        error ||
        !data.user
    ) {

        showLoginRequired();

        return;
    }


    currentUser =
        data.user;


    await prepareForm();

}



/* =========================================================
   LOGIN REQUIRED
========================================================= */

function showLoginRequired() {

    const loginRequired =
        document.getElementById(
            "loginRequired"
        );


    const form =
        document.getElementById(
            "preorderForm"
        );


    loginRequired.hidden =
        false;


    form.hidden =
        true;


    /*
        Bring customer back to preorder
        after logging in.
    */

    const currentURL =
        window.location.href;


    const loginButton =
        document.getElementById(
            "loginButton"
        );


    loginButton.href =
        `login.html?redirect=${
            encodeURIComponent(
                currentURL
            )
        }`;

}



/* =========================================================
   PREPARE FORM
========================================================= */

async function prepareForm() {

    const form =
        document.getElementById(
            "preorderForm"
        );


    const loginRequired =
        document.getElementById(
            "loginRequired"
        );


    loginRequired.hidden =
        true;


    form.hidden =
        false;


    document
        .getElementById(
            "customerEmail"
        )
        .value =
        currentUser.email ||
        "";


    /*
        Load profile name.
    */

    const {
        data: profile
    } =
        await preorderDB
            .from(
                "profiles"
            )
            .select(
                "full_name"
            )
            .eq(
                "id",
                currentUser.id
            )
            .maybeSingle();


    if (
        profile?.full_name
    ) {

        document
            .getElementById(
                "customerName"
            )
            .value =
            profile.full_name;

    }


    /*
        Disable custom options if
        admin has not enabled them.
    */

    const customFit =
        document.getElementById(
            "customFit"
        );


    const customTuning =
        document.getElementById(
            "customTuning"
        );


    if (
        currentProduct
            .custom_fit_available !==
        true
    ) {

        customFit.checked =
            false;


        customFit.disabled =
            true;

    }


    if (
        currentProduct
            .custom_tuning_available !==
        true
    ) {

        customTuning.checked =
            false;


        customTuning.disabled =
            true;

    }


    /*
        Apply admin maximum quantity.
    */

    const quantity =
        document.getElementById(
            "quantity"
        );


    if (
        currentProduct
            .max_order_quantity
    ) {

        quantity.max =
            Number(
                currentProduct
                    .max_order_quantity
            );

    }

}



/* =========================================================
   SUBMIT PREORDER
========================================================= */

async function submitPreorder(
    event
) {

    event.preventDefault();


    if (
        !currentUser ||
        !currentProduct
    ) {

        return;
    }


    const message =
        document.getElementById(
            "formMessage"
        );


    const button =
        document.getElementById(
            "submitPreorderButton"
        );


    const name =
        document
            .getElementById(
                "customerName"
            )
            .value
            .trim();


    const email =
        currentUser.email;


    const quantity =
        Number(
            document
                .getElementById(
                    "quantity"
                )
                .value
        );


    const customFit =
        document
            .getElementById(
                "customFit"
            )
            .checked;


    const customTuning =
        document
            .getElementById(
                "customTuning"
            )
            .checked;


    const notes =
        document
            .getElementById(
                "notes"
            )
            .value
            .trim();


    if (
        !name
    ) {

        message.textContent =
            "Please enter your name.";

        return;
    }


    if (
        quantity < 1
    ) {

        message.textContent =
            "Quantity must be at least 1.";

        return;
    }


    if (
        currentProduct
            .max_order_quantity &&
        quantity >
        Number(
            currentProduct
                .max_order_quantity
        )
    ) {

        message.textContent =
            `Maximum preorder quantity is ${
                currentProduct
                    .max_order_quantity
            }.`;

        return;
    }


    button.disabled =
        true;


    button.textContent =
        "SUBMITTING...";


    message.textContent =
        "";


    const {
        data,
        error
    } =
        await preorderDB
            .from(
                "preorders"
            )
            .insert({

                user_id:
                    currentUser.id,

                product_id:
                    currentProduct.id,

                customer_name:
                    name,

                customer_email:
                    email,

                quantity:
                    quantity,

                custom_fit:
                    customFit,

                custom_tuning:
                    customTuning,

                notes:
                    notes,

                status:
                    "pending"

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


        button.disabled =
            false;


        button.textContent =
            "SUBMIT PREORDER →";


        return;
    }


    showSuccess(
        data
    );

}



/* =========================================================
   SUCCESS
========================================================= */

function showSuccess(
    preorder
) {

    const panel =
        document.querySelector(
            ".form-panel"
        );


    panel.innerHTML = `

        <div class="notice-box">

            <strong>
                PREORDER RECEIVED
            </strong>


            <h2
                style="
                    margin-top:12px;
                    font-size:36px;
                "
            >

                Thank you.

            </h2>


            <p>

                Your Hammer Craft preorder request
                has been received.

            </p>


            <p>

                Reference:

                <strong>
                    ${escapeHTML(
                        preorder.id
                    )}
                </strong>

            </p>


            <p>

                We will review your request before
                confirming payment or production.

            </p>


            <a
                href="account.html"
                class="primary-button"
            >

                MY ACCOUNT →

            </a>

        </div>

    `;

}



/* =========================================================
   ERROR
========================================================= */

function showFatalError(
    message
) {

    const productPanel =
        document.getElementById(
            "productPanel"
        );


    productPanel.innerHTML = `

        <div class="notice-box">

            <strong>
                PREORDER UNAVAILABLE
            </strong>

            <p>
                ${escapeHTML(
                    message
                )}
            </p>


            <a
                href="index.html#models"
                class="primary-button"
            >
                RETURN TO MODELS
            </a>

        </div>

    `;


    document
        .querySelector(
            ".form-panel"
        )
        .innerHTML =
        "";

}



/* =========================================================
   HTML ESCAPE
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
        "preorderForm"
    )
    .addEventListener(
        "submit",
        submitPreorder
    );



/* =========================================================
   START
========================================================= */

initialisePreorder();