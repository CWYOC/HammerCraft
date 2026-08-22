/* =========================================================
   HAMMER CRAFT
   PRODUCT CATALOGUE
   product.js
========================================================= */

"use strict";


/* =========================================================
   STATE
========================================================= */

let catalogueProducts =
    [];


let activeCategory =
    "all";


/* =========================================================
   HELPERS
========================================================= */

function escapeHtml(
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
            "\"",
            "&quot;"
        )
        .replaceAll(
            "'",
            "&#039;"
        );

}


/* =========================================================
   CATEGORY LABEL
========================================================= */

function getCategoryLabel(
    category
) {

    const labels = {

        reference:
            "REFERENCE",

        custom_tune:
            "CUSTOM SOUND",

        custom_fit:
            "CUSTOM FIT",

        full_custom:
            "FULL CUSTOM"

    };


    return (
        labels[
            category
        ]
        ||
        String(
            category ?? "PRODUCT"
        )
            .replaceAll(
                "_",
                " "
            )
            .toUpperCase()
    );

}


/* =========================================================
   STATUS LABEL
========================================================= */

function getStatusLabel(
    status
) {

    const labels = {

        coming_soon:
            "COMING SOON",

        in_stock:
            "IN STOCK",

        low_stock:
            "LOW STOCK",

        out_of_stock:
            "OUT OF STOCK",

        hidden:
            "HIDDEN"

    };


    return (
        labels[
            status
        ]
        ||
        String(
            status ?? ""
        )
            .replaceAll(
                "_",
                " "
            )
            .toUpperCase()
    );

}


/* =========================================================
   FIT LABEL
========================================================= */

function getFitLabel(
    fitType
) {

    const labels = {

        universal:
            "UNIVERSAL FIT",

        ear_specific:
            "EAR-SPECIFIC FIT",

        custom:
            "CUSTOM FIT",

        custom_fit:
            "CUSTOM FIT"

    };


    return (
        labels[
            fitType
        ]
        ||
        String(
            fitType ?? ""
        )
            .replaceAll(
                "_",
                " "
            )
            .toUpperCase()
    );

}


/* =========================================================
   SOUND SIGNATURE
========================================================= */

function getSoundSignatureLabel(
    signature
) {

    const labels = {

        clear:
            "CLEAR",

        warm:
            "WARM",

        balanced:
            "BALANCED",

        classical:
            "CLASSICAL",

        vocal:
            "VOCAL",

        bass:
            "BASS FOCUSED",

        bass_focused:
            "BASS FOCUSED",

        bright:
            "BRIGHT",

        smooth:
            "SMOOTH",

        v_shape:
            "V-SHAPE",

        studio:
            "STUDIO",

        custom:
            "CUSTOM"

    };


    return (
        labels[
            signature
        ]
        ||
        String(
            signature ?? ""
        )
            .replaceAll(
                "_",
                " "
            )
            .toUpperCase()
    );

}


/* =========================================================
   RECOMMENDED FOR LABEL
========================================================= */

function getRecommendedForLabel(
    value
) {

    const labels = {

        pop:
            "POP",

        rock:
            "ROCK",

        edm:
            "EDM",

        hiphop:
            "HIP-HOP",

        hip_hop:
            "HIP-HOP",

        classical:
            "CLASSICAL",

        jazz:
            "JAZZ",

        vocal:
            "VOCAL",

        studio:
            "STUDIO",

        gaming:
            "GAMING",

        all_round:
            "ALL-ROUND",

        allround:
            "ALL-ROUND",

        acoustic:
            "ACOUSTIC",

        electronic:
            "ELECTRONIC"

    };


    return (
        labels[
            value
        ]
        ||
        String(
            value ?? ""
        )
            .replaceAll(
                "_",
                " "
            )
            .toUpperCase()
    );

}


/* =========================================================
   PRODUCT URL
========================================================= */

function getProductUrl(
    product
) {

    if (
        product.detail_page
    ) {

        return product.detail_page;

    }


    if (
        product.slug
    ) {

        return (
            `products/${product.slug}.html`
        );

    }


    return "#";

}


/* =========================================================
   PRODUCT IMAGE
========================================================= */

function getProductImage(
    product
) {

    if (
        product.image_url
    ) {

        return product.image_url;

    }


    if (
        product.image_path
    ) {

        return product.image_path;

    }


    return "";

}


/* =========================================================
   PRODUCT DESCRIPTION
========================================================= */

function getProductDescription(
    product
) {

    return (
        product.short_description
        ||
        product.subtitle
        ||
        product.description
        ||
        ""
    );

}


/* =========================================================
   PRODUCT PRICE
========================================================= */

function getProductPrice(
    product
) {

    if (
        product.price_gbp ===
            null
        ||
        product.price_gbp ===
            undefined
        ||
        product.price_gbp ===
            ""
    ) {

        return "TBC";

    }


    const price =
        Number(
            product.price_gbp
        );


    if (
        !Number.isFinite(
            price
        )
    ) {

        return "TBC";

    }


    return (
        `£${price.toFixed(2)}`
    );

}


/* =========================================================
   PRODUCT ACTION TEXT
========================================================= */

function getProductActionText(
    product
) {

    if (
        product.status ===
        "coming_soon"
    ) {

        return "LEARN MORE →";

    }


    return "VIEW PRODUCT →";

}


/* =========================================================
   SOUND SIGNATURE FALLBACK
========================================================= */

function getProductSoundSignature(
    product
) {

    if (
        product.sound_signature
    ) {

        return product.sound_signature;

    }


    /*
     * Custom products display CUSTOM if no explicit
     * sound signature has been assigned.
     */

    if (
        product.tuning_type ===
            "custom"
        ||
        product.category ===
            "custom_tune"
        ||
        product.category ===
            "full_custom"
    ) {

        return "custom";

    }


    return "";

}


/* =========================================================
   NORMALISE RECOMMENDED FOR
========================================================= */

function getProductRecommendedFor(
    product
) {

    const value =
        product.recommended_for;


    if (
        Array.isArray(
            value
        )
    ) {

        return value
            .filter(
                Boolean
            )
            .map(
                item =>
                    String(
                        item
                    )
                        .trim()
                        .toLowerCase()
            );

    }


    /*
     * This fallback also supports a comma-separated
     * string if one ever exists in the database.
     */

    if (
        typeof value ===
        "string"
    ) {

        return value
            .split(
                ","
            )
            .map(
                item =>
                    item
                        .trim()
                        .toLowerCase()
            )
            .filter(
                Boolean
            );

    }


    return [];

}


/* =========================================================
   RENDER RECOMMENDED FOR
========================================================= */

function renderRecommendedFor(
    product
) {

    const recommendations =
        getProductRecommendedFor(
            product
        );


    if (
        recommendations.length ===
        0
    ) {

        return "";

    }


    return `

        <div class="dynamic-product-recommended">

            <span class="recommended-title">
                RECOMMENDED FOR
            </span>


            <div class="recommended-tags">

                ${
                    recommendations
                        .map(
                            recommendation => `

                                <span>

                                    ${
                                        escapeHtml(
                                            getRecommendedForLabel(
                                                recommendation
                                            )
                                        )
                                    }

                                </span>

                            `
                        )
                        .join("")
                }

            </div>

        </div>

    `;

}


/* =========================================================
   RENDER PRODUCT CARD
========================================================= */

function renderProductCard(
    product
) {

    const url =
        getProductUrl(
            product
        );


    const image =
        getProductImage(
            product
        );


    const description =
        getProductDescription(
            product
        );


    const price =
        getProductPrice(
            product
        );


    const actionText =
        getProductActionText(
            product
        );


    const soundSignature =
        getProductSoundSignature(
            product
        );


    const categoryLabel =
        getCategoryLabel(
            product.category
        );


    const statusLabel =
        getStatusLabel(
            product.status
        );


    const fitLabel =
        getFitLabel(
            product.fit_type
        );


    return `

        <article
            class="dynamic-product-card"
            data-category="${
                escapeHtml(
                    product.category
                    ||
                    ""
                )
            }"
        >

            <!-- =============================================
                 IMAGE
            ============================================== -->

            <a
                href="${
                    escapeHtml(
                        url
                    )
                }"
                class="dynamic-product-image"
                aria-label="View ${
                    escapeHtml(
                        product.name
                        ||
                        "product"
                    )
                }"
            >

                ${
                    image
                    ?
                    `

                        <img
                            src="${
                                escapeHtml(
                                    image
                                )
                            }"
                            alt="${
                                escapeHtml(
                                    product.name
                                    ||
                                    "Hammer Craft IEM"
                                )
                            }"
                            loading="lazy"

                            onerror="
                                this.style.display='none';
                                this.parentElement.classList.add('image-missing');
                            "
                        >

                    `
                    :
                    ""
                }


                <div class="dynamic-product-image-fallback">

                    <span>

                        ${
                            escapeHtml(
                                categoryLabel
                            )
                        }

                    </span>


                    <strong>

                        ${
                            escapeHtml(
                                product.name
                                ||
                                "Hammer Craft"
                            )
                        }

                    </strong>

                </div>

            </a>



            <!-- =============================================
                 PRODUCT INFORMATION
            ============================================== -->

            <div class="dynamic-product-body">


                <!-- TOP LINE -->

                <div class="dynamic-product-topline">

                    <span>

                        ${
                            escapeHtml(
                                categoryLabel
                            )
                        }

                    </span>


                    <span>

                        ${
                            escapeHtml(
                                statusLabel
                            )
                        }

                    </span>

                </div>



                <!-- PRODUCT NAME -->

                <h2>

                    ${
                        escapeHtml(
                            product.name
                            ||
                            "Unnamed product"
                        )
                    }

                </h2>



                <!-- SUBTITLE -->

                ${
                    product.subtitle
                    ?
                    `

                        <span class="dynamic-product-subtitle">

                            ${
                                escapeHtml(
                                    product.subtitle
                                )
                            }

                        </span>

                    `
                    :
                    ""
                }



                <!-- DESCRIPTION -->

                ${
                    description
                    ?
                    `

                        <p>

                            ${
                                escapeHtml(
                                    description
                                )
                            }

                        </p>

                    `
                    :
                    ""
                }



                <!-- =========================================
                     MAIN PRODUCT TAGS
                ========================================== -->

                <div class="dynamic-product-tags">


                    <!-- SOUND SIGNATURE -->

                    ${
                        soundSignature
                        ?
                        `

                            <span
                                class="sound-signature-tag"
                            >

                                ${
                                    escapeHtml(
                                        getSoundSignatureLabel(
                                            soundSignature
                                        )
                                    )
                                }

                            </span>

                        `
                        :
                        ""
                    }



                    <!-- FIT -->

                    ${
                        product.fit_type
                        ?
                        `

                            <span>

                                ${
                                    escapeHtml(
                                        fitLabel
                                    )
                                }

                            </span>

                        `
                        :
                        ""
                    }

                </div>



                <!-- =========================================
                     RECOMMENDED FOR
                ========================================== -->

                ${
                    renderRecommendedFor(
                        product
                    )
                }



                <!-- =========================================
                     OPTIONAL CAPABILITIES
                ========================================== -->

                <div class="dynamic-product-capabilities">

                    ${
                        product.custom_tuning ===
                            true
                        ||
                        product.custom_tuning_available ===
                            true
                        ?
                        `

                            <span>
                                CUSTOM SOUND AVAILABLE
                            </span>

                        `
                        :
                        ""
                    }


                    ${
                        product.custom_fit ===
                            true
                        ||
                        product.custom_fit_available ===
                            true
                        ?
                        `

                            <span>
                                CUSTOM FIT AVAILABLE
                            </span>

                        `
                        :
                        ""
                    }

                </div>



                <!-- =========================================
                     FOOTER
                ========================================== -->

                <div class="dynamic-product-footer">

                    <strong>

                        ${price}

                    </strong>


                    <a
                        href="${
                            escapeHtml(
                                url
                            )
                        }"
                    >

                        ${actionText}

                    </a>

                </div>

            </div>

        </article>

    `;

}


/* =========================================================
   RENDER CATALOGUE
========================================================= */

function renderCatalogue() {

    const grid =
        document.getElementById(
            "dynamicProductGrid"
        );


    const status =
        document.getElementById(
            "catalogueStatus"
        );


    if (
        !grid
        ||
        !status
    ) {

        return;

    }


    const visibleProducts =
        catalogueProducts.filter(
            product => {

                if (
                    activeCategory ===
                    "all"
                ) {

                    return true;

                }


                return (
                    product.category ===
                    activeCategory
                );

            }
        );


    if (
        visibleProducts.length ===
        0
    ) {

        grid.innerHTML =
            "";


        status.hidden =
            false;


        status.textContent =
            activeCategory ===
            "all"

            ?
            "No public products are currently available."

            :
            "No products are currently available in this category.";


        return;

    }


    status.hidden =
        true;


    status.textContent =
        "";


    grid.innerHTML =
        visibleProducts
            .map(
                product =>
                    renderProductCard(
                        product
                    )
            )
            .join("");

}


/* =========================================================
   LOAD PRODUCTS FROM SUPABASE
========================================================= */

async function loadCatalogueProducts() {

    const status =
        document.getElementById(
            "catalogueStatus"
        );


    if (
        !status
    ) {

        return;

    }


    status.hidden =
        false;


    status.textContent =
        "Loading products...";


    if (
        !window.hcSupabase
    ) {

        console.error(
            "Hammer Craft Supabase client is unavailable."
        );


        status.textContent =
            "Unable to connect to the product catalogue.";


        return;

    }


    try {

        const {
            data,
            error
        } =
            await window.hcSupabase
                .from(
                    "products"
                )
                .select("*")
                .eq(
                    "public_visible",
                    true
                )
                .order(
                    "display_order",
                    {
                        ascending:
                            true
                    }
                )
                .order(
                    "name",
                    {
                        ascending:
                            true
                    }
                );


        if (
            error
        ) {

            throw error;

        }


        /*
         * COMING SOON REMAINS PUBLIC.
         *
         * Only hidden products are excluded.
         */

        catalogueProducts =
            (
                data
                ||
                []
            )
                .filter(
                    product => {

                        return (

                            product.public_visible ===
                                true

                            &&

                            product.status !==
                                "hidden"

                        );

                    }
                );


        console.log(
            "Hammer Craft catalogue:",
            catalogueProducts
        );


        renderCatalogue();

    }

    catch (
        error
    ) {

        console.error(
            "Unable to load catalogue:",
            error
        );


        status.hidden =
            false;


        status.textContent =
            "Product catalogue is temporarily unavailable.";

    }

}


/* =========================================================
   PRODUCT FILTER
========================================================= */

function setCatalogueCategory(
    category
) {

    activeCategory =
        category
        ||
        "all";


    document
        .querySelectorAll(
            ".catalogue-filter-button"
        )
        .forEach(
            button => {

                button.classList.toggle(

                    "active",

                    button.dataset.category ===
                    activeCategory

                );

            }
        );


    renderCatalogue();

}


/* =========================================================
   FILTER EVENTS
========================================================= */

function setupCatalogueFilters() {

    document
        .querySelectorAll(
            ".catalogue-filter-button"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        setCatalogueCategory(
                            button.dataset.category
                            ||
                            "all"
                        );

                    }
                );

            }
        );

}


/* =========================================================
   URL CATEGORY
========================================================= */

function loadCategoryFromUrl() {

    const params =
        new URLSearchParams(
            window.location.search
        );


    const requestedCategory =
        params.get(
            "category"
        );


    const validCategories =
        new Set([

            "all",

            "reference",

            "custom_tune",

            "custom_fit",

            "full_custom"

        ]);


    if (
        requestedCategory
        &&
        validCategories.has(
            requestedCategory
        )
    ) {

        activeCategory =
            requestedCategory;

    }

}


/* =========================================================
   START
========================================================= */

async function startProductCatalogue() {

    loadCategoryFromUrl();


    setupCatalogueFilters();


    setCatalogueCategory(
        activeCategory
    );


    await loadCatalogueProducts();

}


document.addEventListener(
    "DOMContentLoaded",
    startProductCatalogue
);