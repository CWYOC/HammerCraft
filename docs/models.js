const modelDB =
    window.hcSupabase;


/* =========================================================
   LOAD PUBLIC MODELS
========================================================= */

async function loadPublicModels() {

    const container =
        document.getElementById(
            "publicModelGrid"
        );


    if (!container) {
        return;
    }


    const {
        data: products,
        error
    } =
        await modelDB
            .from(
                "products"
            )
            .select(
                `
                id,
                slug,
                name,
                subtitle,
                description,
                image_path,
                price_gbp,
                stock_quantity,
                status,
                display_order
                `
            )
            .neq(
                "status",
                "hidden"
            )
            .order(
                "display_order",
                {
                    ascending: true
                }
            );


    if (error) {

        console.error(error);

        container.innerHTML = `
            <div class="model-loading">
                Models currently unavailable.
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
            <div class="model-loading">
                New models are coming soon.
            </div>
        `;

        return;
    }


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


/* =========================================================
   CARD
========================================================= */

function createPublicModelCard(
    product
) {

    const card =
        document.createElement(
            "article"
        );


    card.className =
        `public-model-card status-${product.status}`;


    const price =
        product.price_gbp === null
        ? ""
        : `£${Number(product.price_gbp).toFixed(2)}`;


    card.innerHTML = `

        <div class="model-image-wrap">

            ${
                product.image_path
                ? `
                    <img
                        src="${escapePublicHTML(product.image_path)}"
                        alt="${escapePublicHTML(product.name)}"
                    >
                `
                : `
                    <div class="model-image-placeholder">
                        HAMMER CRAFT
                    </div>
                `
            }


            <div class="
                model-status
                ${product.status}
            ">
                ${publicStatusText(product)}
            </div>

        </div>


        <div class="model-content">

            <div class="model-top">

                <div>

                    <div class="model-subtitle">
                        ${
                            escapePublicHTML(
                                product.subtitle ||
                                "HAMMER CRAFT"
                            )
                        }
                    </div>

                    <h3>
                        ${escapePublicHTML(product.name)}
                    </h3>

                </div>


                <strong class="model-price">
                    ${price}
                </strong>

            </div>


            <p>
                ${
                    escapePublicHTML(
                        product.description ||
                        ""
                    )
                }
            </p>


            ${modelAction(product)}

        </div>
    `;


    return card;
}


/* =========================================================
   STATUS TEXT
========================================================= */

function publicStatusText(
    product
) {

    switch (product.status) {

        case "in_stock":

            return product.stock_quantity > 0
                ? "IN STOCK"
                : "OUT OF STOCK";


        case "low_stock":

            return product.stock_quantity > 0
                ? `ONLY ${product.stock_quantity} LEFT`
                : "OUT OF STOCK";


        case "out_of_stock":

            return "OUT OF STOCK";


        case "coming_soon":

            return "COMING SOON";


        default:

            return "";
    }

}


/* =========================================================
   BUTTON
========================================================= */

function modelAction(
    product
) {

    if (
        product.status ===
        "coming_soon"
    ) {

        return `
            <button
                class="model-button disabled"
                disabled
            >
                COMING SOON
            </button>
        `;
    }


    if (
        product.status ===
        "out_of_stock"
        ||
        product.stock_quantity <= 0
    ) {

        return `
            <button
                class="model-button disabled"
                disabled
            >
                OUT OF STOCK
            </button>
        `;
    }


    return `
        <a
            href="product.html?model=${encodeURIComponent(product.slug)}"
            class="model-button"
        >
            EXPLORE MODEL →
        </a>
    `;
}


/* =========================================================
   HTML ESCAPE
========================================================= */

function escapePublicHTML(
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
   REALTIME UPDATE
========================================================= */

const productChannel =
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

                loadPublicModels();

            }

        )
        .subscribe();


loadPublicModels();