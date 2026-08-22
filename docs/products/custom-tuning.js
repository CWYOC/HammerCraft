/* =========================================================
   HAMMER CRAFT
   PUBLIC CUSTOM TUNING ENGINE
========================================================= */


/* =========================================================
   CUSTOMER CONTROL FREQUENCIES
========================================================= */

const tuningFrequencies = [

    20,
    30,
    50,
    80,
    120,
    200,
    300,
    500,
    800,
    1000,
    1500,
    2000,
    3000,
    4000,
    6000,
    8000,
    10000,
    12000,
    16000

];


/* =========================================================
   PERCEPTUAL MATCHING WEIGHTS
========================================================= */

const frequencyWeights = [

    1.0,   // 20
    1.0,   // 30
    1.2,   // 50
    1.3,   // 80
    1.3,   // 120
    1.2,   // 200
    1.1,   // 300
    1.0,   // 500
    1.1,   // 800
    1.2,   // 1k
    1.4,   // 1.5k
    1.5,   // 2k
    1.6,   // 3k
    1.5,   // 4k
    1.1,   // 6k
    0.9,   // 8k
    0.7,   // 10k
    0.6,   // 12k
    0.4    // 16k

];


/* =========================================================
   STATE
========================================================= */

let tuningAdjustments =
    tuningFrequencies.map(
        () => 0
    );


let selectedPointIndex =
    tuningFrequencies.indexOf(
        1000
    );


let tuningMode =
    null;


let dragging =
    false;


/*
 * Real products loaded from Supabase.
 */
let hammerCraftProducts =
    [];


/*
 * Reference product.
 *
 * Later we identify it from Supabase by
 * is_reference_target = true.
 */
let referenceProduct =
    null;


let guidedPreferences = {

    bass:
        0,

    bassCharacter:
        "natural",

    warmth:
        0,

    vocals:
        0,

    treble:
        0,

    sensitivity:
        "normal",

    music:
        []

};


/* =========================================================
   DOM
========================================================= */

const guidedPanel =
    document.getElementById(
        "guidedTuningPanel"
    );


const advancedPanel =
    document.getElementById(
        "advancedTuningPanel"
    );


const resultPanel =
    document.getElementById(
        "tuningResult"
    );


const recommendationPanel =
    document.getElementById(
        "tuningRecommendations"
    );


const canvas =
    document.getElementById(
        "tuningGraph"
    );


const context =
    canvas
        ?
        canvas.getContext(
            "2d"
        )
        :
        null;


/* =========================================================
   DB HELPERS
========================================================= */

function quantizeDb(
    value
) {

    return (

        Math.round(
            Number(
                value
            )
            *
            10
        )

        /
        10

    );

}


function clampDb(
    value
) {

    return Math.max(

        -6,

        Math.min(

            6,

            quantizeDb(
                value
            )

        )

    );

}


/* =========================================================
   LOAD PRODUCTS FROM SUPABASE
========================================================= */

async function loadHammerCraftProducts() {

    if (
        !window.hcSupabase
    ) {

        console.error(
            "Supabase client not available."
        );


        return;

    }


    try {

        /* -------------------------------------------------
           PRODUCTS
        ------------------------------------------------- */

        const {
            data: products,
            error: productError
        } =

            await window.hcSupabase
                .from(
                    "products"
                )
                .select(`
                    id,
                    name,
                    slug,
                    subtitle,
                    status,
                    image_url,
                    price_gbp,
                    is_reference_target
                `)
                .neq(
                    "status",
                    "hidden"
                )
                .order(
                    "display_order",
                    {
                        ascending:
                            true
                    }
                );


        if (
            productError
        ) {

            throw productError;

        }


        if (
            !products
            ||
            products.length ===
                0
        ) {

            console.warn(
                "No public Hammer Craft products found."
            );


            hammerCraftProducts =
                [];


            renderNoProductMeasurements();


            return;

        }


        /* -------------------------------------------------
           RESPONSE DATA
        ------------------------------------------------- */

        const productIds =
            products.map(
                product =>
                    product.id
            );


        const {
            data: responsePoints,
            error: responseError
        } =

            await window.hcSupabase
                .from(
                    "product_frequency_response"
                )
                .select(`
                    product_id,
                    frequency_hz,
                    db
                `)
                .in(
                    "product_id",
                    productIds
                )
                .order(
                    "frequency_hz",
                    {
                        ascending:
                            true
                    }
                );


        if (
            responseError
        ) {

            throw responseError;

        }


        /* -------------------------------------------------
           GROUP FR BY PRODUCT
        ------------------------------------------------- */

        const responsesByProduct =
            {};


        for (
            const point
            of
            responsePoints
            ||
            []
        ) {

            if (
                !responsesByProduct[
                    point.product_id
                ]
            ) {

                responsesByProduct[
                    point.product_id
                ] =
                    [];

            }


            responsesByProduct[
                point.product_id
            ].push({

                frequency:
                    Number(
                        point.frequency_hz
                    ),

                db:
                    Number(
                        point.db
                    )

            });

        }


        /* -------------------------------------------------
           BUILD PRODUCT OBJECTS
        ------------------------------------------------- */

        hammerCraftProducts =

            products

                .map(
                    product => {

                        const measurement =
                            responsesByProduct[
                                product.id
                            ]
                            ||
                            [];


                        if (
                            measurement.length <
                            2
                        ) {

                            return null;

                        }


                        const normalized =
                            normalizeMeasurement(
                                measurement
                            );


                        const comparisonCurve =
                            tuningFrequencies.map(
                                frequency =>

                                    interpolateMeasurement(

                                        normalized,

                                        frequency

                                    )
                            );


                        return {

                            id:
                                product.id,

                            name:
                                product.name,

                            slug:
                                product.slug,

                            subtitle:
                                product.subtitle
                                ||
                                "",

                            price:
                                product.price_gbp,

                            imageUrl:
                                product.image_url
                                ||
                                null,

                            url:
                                `products/${product.slug}.html`,

                            isReference:
                                product
                                    .is_reference_target ===
                                    true,

                            measurement:
                                normalized,

                            curve:
                                comparisonCurve

                        };

                    }
                )

                .filter(
                    Boolean
                );


        /* -------------------------------------------------
           REFERENCE
        ------------------------------------------------- */

        referenceProduct =
            hammerCraftProducts.find(
                product =>
                    product.isReference
            )
            ||
            hammerCraftProducts[
                0
            ]
            ||
            null;


        console.log(
            "Loaded real Hammer Craft products:",
            hammerCraftProducts
        );


        updateProductRecommendations();


        drawTuningGraph();

    }

    catch (
        error
    ) {

        console.error(
            "Unable to load product measurements:",
            error
        );


        renderProductLoadError();

    }

}


/* =========================================================
   NORMALISE MEASUREMENT

   Product comparison uses 1 kHz as 0 dB.
========================================================= */

function normalizeMeasurement(
    measurement
) {

    if (
        !measurement
        ||
        measurement.length <
            2
    ) {

        return [];

    }


    const referenceDb =
        interpolateMeasurement(
            measurement,
            1000
        );


    return measurement.map(
        point => ({

            frequency:
                point.frequency,

            db:
                point.db
                -
                referenceDb

        })
    );

}


/* =========================================================
   LOG-FREQUENCY INTERPOLATION
========================================================= */

function interpolateMeasurement(
    measurement,
    targetFrequency
) {

    if (
        !measurement
        ||
        measurement.length ===
            0
    ) {

        return 0;

    }


    if (
        targetFrequency <=
        measurement[
            0
        ].frequency
    ) {

        return measurement[
            0
        ].db;

    }


    const last =
        measurement[
            measurement.length - 1
        ];


    if (
        targetFrequency >=
        last.frequency
    ) {

        return last.db;

    }


    for (
        let index = 0;
        index <
            measurement.length - 1;
        index++
    ) {

        const left =
            measurement[
                index
            ];


        const right =
            measurement[
                index + 1
            ];


        if (
            targetFrequency >=
                left.frequency
            &&
            targetFrequency <=
                right.frequency
        ) {

            const leftLog =
                Math.log10(
                    left.frequency
                );


            const rightLog =
                Math.log10(
                    right.frequency
                );


            const targetLog =
                Math.log10(
                    targetFrequency
                );


            const ratio =
                (
                    targetLog
                    -
                    leftLog
                )
                /
                (
                    rightLog
                    -
                    leftLog
                );


            return (

                left.db

                +

                (
                    right.db
                    -
                    left.db
                )

                *
                ratio

            );

        }

    }


    return 0;

}


/* =========================================================
   BUILD CUSTOMER TARGET

   Customer adjustments are relative to the
   Hammer Craft reference product.
========================================================= */

function getCustomerTargetCurve() {

    if (
        !referenceProduct
    ) {

        return [
            ...tuningAdjustments
        ];

    }


    return referenceProduct
        .curve
        .map(
            (
                referenceDb,
                index
            ) =>

                referenceDb
                +
                tuningAdjustments[
                    index
                ]
        );

}


/* =========================================================
   MODES
========================================================= */

function openGuidedTuning() {

    tuningMode =
        "guided";


    if (
        guidedPanel
    ) {

        guidedPanel.hidden =
            false;

    }


    if (
        advancedPanel
    ) {

        advancedPanel.hidden =
            true;

    }


    if (
        resultPanel
    ) {

        resultPanel.hidden =
            true;

    }


    guidedPanel
        ?.scrollIntoView({

            behavior:
                "smooth",

            block:
                "start"

        });

}


function openAdvancedTuning() {

    tuningMode =
        "advanced";


    if (
        guidedPanel
    ) {

        guidedPanel.hidden =
            true;

    }


    if (
        advancedPanel
    ) {

        advancedPanel.hidden =
            false;

    }


    if (
        resultPanel
    ) {

        resultPanel.hidden =
            true;

    }


    drawTuningGraph();


    updateProductRecommendations();


    advancedPanel
        ?.scrollIntoView({

            behavior:
                "smooth",

            block:
                "start"

        });

}


function closeTuningPanels() {

    if (
        guidedPanel
    ) {

        guidedPanel.hidden =
            true;

    }


    if (
        advancedPanel
    ) {

        advancedPanel.hidden =
            true;

    }

}


/* =========================================================
   GUIDED BUTTONS
========================================================= */

document
    .querySelectorAll(
        ".choice-grid"
    )
    .forEach(
        group => {

            group
                .querySelectorAll(
                    "button"
                )
                .forEach(
                    button => {

                        button.addEventListener(
                            "click",
                            () => {

                                group
                                    .querySelectorAll(
                                        "button"
                                    )
                                    .forEach(
                                        option => {

                                            option
                                                .classList
                                                .remove(
                                                    "selected"
                                                );

                                        }
                                    );


                                button
                                    .classList
                                    .add(
                                        "selected"
                                    );


                                const setting =
                                    group.dataset.setting;


                                const raw =
                                    button.dataset.value;


                                const numeric =
                                    Number(
                                        raw
                                    );


                                guidedPreferences[
                                    setting
                                ] =

                                    raw !==
                                        ""

                                    &&
                                    Number.isFinite(
                                        numeric
                                    )

                                    ?
                                    numeric

                                    :
                                    raw;

                            }
                        );

                    }
                );

        }
    );


/* =========================================================
   MUSIC
========================================================= */

document
    .querySelectorAll(
        "#musicChoices button"
    )
    .forEach(
        button => {

            button.addEventListener(
                "click",
                () => {

                    button
                        .classList
                        .toggle(
                            "selected"
                        );


                    guidedPreferences.music =

                        Array
                            .from(

                                document
                                    .querySelectorAll(
                                        "#musicChoices button.selected"
                                    )

                            )
                            .map(
                                item =>
                                    item.dataset.value
                            );

                }
            );

        }
    );


/* =========================================================
   GUIDED TARGET
========================================================= */

function generateGuidedTarget() {

    tuningAdjustments =
        tuningFrequencies.map(
            () => 0
        );


    const bass =
        Number(
            guidedPreferences.bass
        )
        ||
        0;


    const warmth =
        Number(
            guidedPreferences.warmth
        )
        ||
        0;


    const vocals =
        Number(
            guidedPreferences.vocals
        )
        ||
        0;


    const treble =
        Number(
            guidedPreferences.treble
        )
        ||
        0;


    tuningFrequencies.forEach(
        (
            frequency,
            index
        ) => {

            let value =
                0;


            /* ---------------------------------------------
               BASS AMOUNT
            --------------------------------------------- */

            if (
                frequency <=
                200
            ) {

                value +=
                    bass;

            }


            /* ---------------------------------------------
               BASS CHARACTER
            --------------------------------------------- */

            if (
                guidedPreferences
                    .bassCharacter ===
                "subbass"
            ) {

                if (
                    frequency <=
                    80
                ) {

                    value +=
                        1.5;

                }


                if (
                    frequency >=
                    120
                    &&
                    frequency <=
                    300
                ) {

                    value -=
                        0.5;

                }

            }


            if (
                guidedPreferences
                    .bassCharacter ===
                "warm"
            ) {

                if (
                    frequency >=
                    120
                    &&
                    frequency <=
                    500
                ) {

                    value +=
                        1.0;

                }

            }


            if (
                guidedPreferences
                    .bassCharacter ===
                "tight"
            ) {

                if (
                    frequency >=
                    120
                    &&
                    frequency <=
                    300
                ) {

                    value -=
                        0.8;

                }

            }


            /* ---------------------------------------------
               WARMTH
            --------------------------------------------- */

            if (
                frequency >=
                200
                &&
                frequency <=
                600
            ) {

                value +=
                    warmth;

            }


            /* ---------------------------------------------
               VOCALS
            --------------------------------------------- */

            if (
                frequency >=
                1000
                &&
                frequency <=
                4000
            ) {

                value +=
                    vocals;

            }


            /* ---------------------------------------------
               TREBLE
            --------------------------------------------- */

            if (
                frequency >=
                6000
            ) {

                value +=
                    treble;

            }


            /* ---------------------------------------------
               TREBLE SENSITIVITY
            --------------------------------------------- */

            if (
                guidedPreferences
                    .sensitivity ===
                "sensitive"
                &&
                frequency >=
                3000
            ) {

                value -=
                    1.0;

            }


            if (
                guidedPreferences
                    .sensitivity ===
                "energetic"
                &&
                frequency >=
                2500
                &&
                frequency <=
                8000
            ) {

                value +=
                    0.8;

            }


            /* ---------------------------------------------
               MUSIC
            --------------------------------------------- */

            if (
                guidedPreferences
                    .music
                    .includes(
                        "edm"
                    )
                &&
                frequency <=
                100
            ) {

                value +=
                    0.8;

            }


            if (
                guidedPreferences
                    .music
                    .includes(
                        "vocal"
                    )
                &&
                frequency >=
                1000
                &&
                frequency <=
                3000
            ) {

                value +=
                    0.5;

            }


            if (
                guidedPreferences
                    .music
                    .includes(
                        "studio"
                    )
            ) {

                value *=
                    0.75;

            }


            tuningAdjustments[
                index
            ] =
                clampDb(
                    value
                );

        }
    );


    smoothTarget();


    tuningMode =
        "guided";


    showGuidedResult();


    updateProductRecommendations();

}


/* =========================================================
   SMOOTH CUSTOMER ADJUSTMENT
========================================================= */

function smoothTarget() {

    const original =
        [
            ...tuningAdjustments
        ];


    for (
        let index = 1;
        index <
            original.length - 1;
        index++
    ) {

        tuningAdjustments[
            index
        ] =
            clampDb(

                (
                    original[
                        index - 1
                    ]

                    +

                    original[
                        index
                    ]
                    *
                    2

                    +

                    original[
                        index + 1
                    ]
                )

                /
                4

            );

    }

}


/* =========================================================
   GUIDED RESULT
========================================================= */

function showGuidedResult() {

    if (
        guidedPanel
    ) {

        guidedPanel.hidden =
            true;

    }


    if (
        resultPanel
    ) {

        resultPanel.hidden =
            false;

    }


    const text =
        document.getElementById(
            "tuningResultText"
        );


    if (
        text
    ) {

        text.textContent =

            "Your preferences have been converted into "
            +
            "a target relative to the Hammer Craft "
            +
            "reference response. Existing products have "
            +
            "also been compared against your target.";

    }


    resultPanel
        ?.scrollIntoView({

            behavior:
                "smooth",

            block:
                "start"

        });

}


/* =========================================================
   GRAPH
========================================================= */

function frequencyToX(
    frequency
) {

    const padding =
        60;


    const width =
        canvas.width
        -
        padding * 2;


    const min =
        Math.log10(
            20
        );


    const max =
        Math.log10(
            16000
        );


    return (

        padding

        +

        (
            (
                Math.log10(
                    frequency
                )
                -
                min
            )

            /

            (
                max
                -
                min
            )
        )

        *
        width

    );

}


function dbToY(
    db
) {

    const padding =
        50;


    const height =
        canvas.height
        -
        padding * 2;


    return (

        padding

        +

        (
            6
            -
            db
        )

        /
        12

        *
        height

    );

}


function yToDb(
    y
) {

    const padding =
        50;


    const height =
        canvas.height
        -
        padding * 2;


    const ratio =
        (
            y
            -
            padding
        )
        /
        height;


    return clampDb(

        6

        -

        ratio
        *
        12

    );

}


/* =========================================================
   DRAW GRAPH
========================================================= */

function drawTuningGraph() {

    if (
        !canvas
        ||
        !context
    ) {

        return;

    }


    context.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );


    context.font =
        "18px Arial";


    /* -----------------------------------------------------
       GRID
    ----------------------------------------------------- */

    for (
        let db = -6;
        db <= 6;
        db += 2
    ) {

        const y =
            dbToY(
                db
            );


        context.beginPath();


        context.strokeStyle =
            "rgba(0,0,0,0.12)";


        context.lineWidth =
            1;


        context.moveTo(
            60,
            y
        );


        context.lineTo(
            canvas.width - 60,
            y
        );


        context.stroke();


        context.fillStyle =
            "#706b64";


        context.fillText(

            `${db > 0 ? "+" : ""}${db} dB`,

            5,

            y + 5

        );

    }


    /* -----------------------------------------------------
       ZERO / REFERENCE LINE
    ----------------------------------------------------- */

    context.beginPath();


    context.strokeStyle =
        "#aaa";


    context.lineWidth =
        3;


    tuningFrequencies.forEach(
        (
            frequency,
            index
        ) => {

            const x =
                frequencyToX(
                    frequency
                );


            const y =
                dbToY(
                    0
                );


            if (
                index ===
                0
            ) {

                context.moveTo(
                    x,
                    y
                );

            }

            else {

                context.lineTo(
                    x,
                    y
                );

            }

        }
    );


    context.stroke();


    /* -----------------------------------------------------
       CUSTOMER ADJUSTMENT
    ----------------------------------------------------- */

    context.beginPath();


    context.strokeStyle =
        "#252321";


    context.lineWidth =
        5;


    tuningFrequencies.forEach(
        (
            frequency,
            index
        ) => {

            const x =
                frequencyToX(
                    frequency
                );


            const y =
                dbToY(
                    tuningAdjustments[
                        index
                    ]
                );


            if (
                index ===
                0
            ) {

                context.moveTo(
                    x,
                    y
                );

            }

            else {

                context.lineTo(
                    x,
                    y
                );

            }

        }
    );


    context.stroke();


    /* -----------------------------------------------------
       POINTS
    ----------------------------------------------------- */

    tuningFrequencies.forEach(
        (
            frequency,
            index
        ) => {

            const x =
                frequencyToX(
                    frequency
                );


            const y =
                dbToY(
                    tuningAdjustments[
                        index
                    ]
                );


            context.beginPath();


            context.arc(

                x,
                y,

                index ===
                    selectedPointIndex
                ?
                10
                :
                7,

                0,

                Math.PI * 2

            );


            context.fillStyle =

                index ===
                    selectedPointIndex

                ?
                "#ff6a00"

                :
                "#252321";


            context.fill();

        }
    );


    updateSelectedPointUI();

}


/* =========================================================
   FIND POINT
========================================================= */

function findNearestPoint(
    mouseX,
    mouseY
) {

    let closest =
        0;


    let smallest =
        Infinity;


    tuningFrequencies.forEach(
        (
            frequency,
            index
        ) => {

            const x =
                frequencyToX(
                    frequency
                );


            const y =
                dbToY(
                    tuningAdjustments[
                        index
                    ]
                );


            const distance =
                Math.hypot(

                    mouseX - x,

                    mouseY - y

                );


            if (
                distance <
                smallest
            ) {

                smallest =
                    distance;


                closest =
                    index;

            }

        }
    );


    return closest;

}


/* =========================================================
   DRAGGING
========================================================= */

if (
    canvas
) {

    canvas.addEventListener(
        "mousedown",
        event => {

            const rect =
                canvas
                    .getBoundingClientRect();


            const x =

                (
                    event.clientX
                    -
                    rect.left
                )

                *
                canvas.width

                /
                rect.width;


            const y =

                (
                    event.clientY
                    -
                    rect.top
                )

                *
                canvas.height

                /
                rect.height;


            selectedPointIndex =
                findNearestPoint(
                    x,
                    y
                );


            dragging =
                true;


            tuningMode =
                "advanced";


            tuningAdjustments[
                selectedPointIndex
            ] =
                yToDb(
                    y
                );


            drawTuningGraph();


            updateProductRecommendations();

        }
    );


    canvas.addEventListener(
        "mousemove",
        event => {

            if (
                !dragging
            ) {

                return;

            }


            const rect =
                canvas
                    .getBoundingClientRect();


            const y =

                (
                    event.clientY
                    -
                    rect.top
                )

                *
                canvas.height

                /
                rect.height;


            tuningAdjustments[
                selectedPointIndex
            ] =
                yToDb(
                    y
                );


            drawTuningGraph();


            updateProductRecommendations();

        }
    );


    window.addEventListener(
        "mouseup",
        () => {

            dragging =
                false;

        }
    );

}


/* =========================================================
   SELECTED POINT
========================================================= */

function updateSelectedPointUI() {

    const frequency =
        tuningFrequencies[
            selectedPointIndex
        ];


    const adjustment =
        tuningAdjustments[
            selectedPointIndex
        ];


    const frequencyElement =
        document.getElementById(
            "selectedFrequency"
        );


    const adjustmentElement =
        document.getElementById(
            "selectedAdjustment"
        );


    const input =
        document.getElementById(
            "dbAdjustmentInput"
        );


    if (
        frequencyElement
    ) {

        frequencyElement.textContent =

            frequency >=
                1000

            ?
            `${frequency / 1000} kHz`

            :
            `${frequency} Hz`;

    }


    if (
        adjustmentElement
    ) {

        adjustmentElement.textContent =

            `${
                adjustment > 0
                ?
                "+"
                :
                ""
            }${adjustment.toFixed(1)} dB`;

    }


    if (
        input
    ) {

        input.value =
            adjustment.toFixed(
                1
            );

    }

}


/* =========================================================
   CHANGE DB
========================================================= */

function modifySelectedDb(
    amount
) {

    tuningMode =
        "advanced";


    tuningAdjustments[
        selectedPointIndex
    ] =
        clampDb(

            tuningAdjustments[
                selectedPointIndex
            ]

            +

            amount

        );


    drawTuningGraph();


    updateProductRecommendations();

}


/* =========================================================
   MATCHING
========================================================= */

function calculateProductMatch(
    customerCurve,
    productCurve
) {

    let weightedSquaredError =
        0;


    let totalWeight =
        0;


    for (
        let index = 0;
        index <
            customerCurve.length;
        index++
    ) {

        const weight =
            frequencyWeights[
                index
            ]
            ??
            1;


        const difference =

            customerCurve[
                index
            ]

            -

            productCurve[
                index
            ];


        weightedSquaredError +=

            difference
            *
            difference
            *
            weight;


        totalWeight +=
            weight;

    }


    const rmse =
        Math.sqrt(

            weightedSquaredError

            /
            totalWeight

        );


    /*
     * This converts RMSE to a UI score.
     *
     * It is deliberately described as a
     * similarity score rather than a scientific
     * probability.
     */

    const score =
        100
        -
        rmse * 15;


    return Math.round(

        Math.max(

            0,

            Math.min(
                100,
                score
            )

        )

    );

}


function getMatchDescription(
    score
) {

    if (
        score >=
        95
    ) {

        return "Extremely close";

    }


    if (
        score >=
        90
    ) {

        return "Very close";

    }


    if (
        score >=
        80
    ) {

        return "Similar";

    }


    if (
        score >=
        70
    ) {

        return "Some similarities";

    }


    return "Different tuning";

}


function findClosestProducts() {

    if (
        hammerCraftProducts.length ===
        0
    ) {

        return [];

    }


    const customerCurve =
        getCustomerTargetCurve();


    return hammerCraftProducts

        .map(
            product => ({

                ...product,

                match:
                    calculateProductMatch(

                        customerCurve,

                        product.curve

                    )

            })
        )

        .sort(
            (
                first,
                second
            ) =>

                second.match
                -
                first.match
        )

        .slice(
            0,
            3
        );

}


/* =========================================================
   RECOMMENDATIONS
========================================================= */

function updateProductRecommendations() {

    if (
        !recommendationPanel
    ) {

        return;

    }


    const list =
        document.getElementById(
            "tuningRecommendationList"
        );


    if (
        !list
    ) {

        return;

    }


    const products =
        findClosestProducts();


    if (
        products.length ===
        0
    ) {

        recommendationPanel.hidden =
            false;


        list.innerHTML = `

            <div class="recommendation-empty">

                Product measurements have not yet been
                added to the Hammer Craft database.

            </div>

        `;


        return;

    }


    recommendationPanel.hidden =
        false;


    list.innerHTML =

        products
            .map(
                (
                    product,
                    index
                ) => `

                    <article class="recommendation-card">

                        <div class="recommendation-rank">

                            #${index + 1}

                        </div>


                        <span class="panel-label">

                            ${
                                escapeHtml(
                                    product.name
                                )
                            }

                        </span>


                        <h4>

                            ${
                                escapeHtml(
                                    product.name
                                )
                            }

                        </h4>


                        <div class="match-score">

                            ${product.match}%

                        </div>


                        <strong>

                            ${
                                getMatchDescription(
                                    product.match
                                )
                            }

                        </strong>


                        ${
                            product.subtitle
                            ?
                            `

                                <p>

                                    ${
                                        escapeHtml(
                                            product.subtitle
                                        )
                                    }

                                </p>

                            `
                            :
                            ""
                        }


                        <a
                            href="${
                                escapeAttribute(
                                    product.url
                                )
                            }"
                            class="secondary-tuning-button"
                        >

                            VIEW PRODUCT

                        </a>

                    </article>

                `
            )
            .join("");

}


/* =========================================================
   HTML SAFETY
========================================================= */

function escapeHtml(
    value
) {

    return String(
        value
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


function escapeAttribute(
    value
) {

    return escapeHtml(
        value
    );

}


/* =========================================================
   PRODUCT LOAD ERRORS
========================================================= */

function renderNoProductMeasurements() {

    if (
        !recommendationPanel
    ) {

        return;

    }


    recommendationPanel.hidden =
        false;


    const list =
        document.getElementById(
            "tuningRecommendationList"
        );


    if (
        list
    ) {

        list.innerHTML = `

            <div class="recommendation-empty">

                No measured Hammer Craft products
                are currently available for comparison.

            </div>

        `;

    }

}


function renderProductLoadError() {

    if (
        !recommendationPanel
    ) {

        return;

    }


    recommendationPanel.hidden =
        false;


    const list =
        document.getElementById(
            "tuningRecommendationList"
        );


    if (
        list
    ) {

        list.innerHTML = `

            <div class="recommendation-empty">

                Product matching is temporarily unavailable.

            </div>

        `;

    }

}


/* =========================================================
   SAVE PENDING CUSTOM TARGET
========================================================= */

function buildTuningProfile() {

    return {

        version:
            3,

        mode:
            tuningMode
            ||
            "advanced",

        referenceProductId:
            referenceProduct
            ?
            referenceProduct.id
            :
            null,

        referenceProductSlug:
            referenceProduct
            ?
            referenceProduct.slug
            :
            null,

        guidedPreferences:
            guidedPreferences,

        anchors:

            tuningFrequencies.map(
                (
                    frequency,
                    index
                ) => ({

                    frequency:
                        frequency,

                    adjustmentDb:
                        tuningAdjustments[
                            index
                        ]

                })
            ),

        recommendations:

            findClosestProducts()
                .map(
                    product => ({

                        productId:
                            product.id,

                        slug:
                            product.slug,

                        match:
                            product.match

                    })
                ),

        createdAt:
            new Date()
                .toISOString()

    };

}


/* =========================================================
   START CUSTOM BUILD
========================================================= */

async function startCustomBuild() {

    const profile =
        buildTuningProfile();


    /*
     * Keep it locally first so login does not
     * destroy the customer's work.
     */

    localStorage.setItem(

        "hammerCraftPendingCustomTuning",

        JSON.stringify(
            profile
        )

    );


    if (
        !window.hcSupabase
    ) {

        window.location.href =
            `../login.html?redirect=${encodeURIComponent(window.location.href)}`;


        return;

    }


    try {

        const {
            data,
            error
        } =
            await window.hcSupabase
                .auth
                .getSession();


        if (
            error
        ) {

            throw error;

        }


        if (
            !data.session
        ) {

            window.location.href =
                `../login.html?redirect=${encodeURIComponent(window.location.href)}`;


            return;

        }


        /*
         * User is already logged in.
         *
         * This will later point to the actual
         * custom-order workflow.
         */

        window.location.href =
            `../login.html?redirect=${encodeURIComponent(window.location.href)}`;

    }

    catch (
        error
    ) {

        console.error(
            "Session check failed:",
            error
        );


        window.location.href =
            `../login.html?redirect=${encodeURIComponent(window.location.href)}`;

    }

}


/* =========================================================
   RESET
========================================================= */

function resetTuning() {

    tuningAdjustments =
        tuningFrequencies.map(
            () => 0
        );


    selectedPointIndex =
        tuningFrequencies.indexOf(
            1000
        );


    tuningMode =
        "advanced";


    drawTuningGraph();


    updateProductRecommendations();

}


/* =========================================================
   EVENTS
========================================================= */

document
    .getElementById(
        "guidedTuningMode"
    )
    ?.addEventListener(
        "click",
        openGuidedTuning
    );


document
    .getElementById(
        "advancedTuningMode"
    )
    ?.addEventListener(
        "click",
        openAdvancedTuning
    );


document
    .querySelectorAll(
        ".tuningCloseButton"
    )
    .forEach(
        button => {

            button.addEventListener(
                "click",
                closeTuningPanels
            );

        }
    );


document
    .getElementById(
        "generateGuidedTargetButton"
    )
    ?.addEventListener(
        "click",
        generateGuidedTarget
    );


document
    .getElementById(
        "fineTuneResultButton"
    )
    ?.addEventListener(
        "click",
        openAdvancedTuning
    );


document
    .getElementById(
        "increaseDbButton"
    )
    ?.addEventListener(
        "click",
        () => {

            modifySelectedDb(
                0.1
            );

        }
    );


document
    .getElementById(
        "decreaseDbButton"
    )
    ?.addEventListener(
        "click",
        () => {

            modifySelectedDb(
                -0.1
            );

        }
    );


document
    .getElementById(
        "dbAdjustmentInput"
    )
    ?.addEventListener(
        "change",
        event => {

            tuningAdjustments[
                selectedPointIndex
            ] =
                clampDb(
                    Number(
                        event.target.value
                    )
                );


            tuningMode =
                "advanced";


            drawTuningGraph();


            updateProductRecommendations();

        }
    );


document
    .getElementById(
        "resetTuningButton"
    )
    ?.addEventListener(
        "click",
        resetTuning
    );


document
    .getElementById(
        "startCustomBuildButton"
    )
    ?.addEventListener(
        "click",
        startCustomBuild
    );


document.addEventListener(
    "keydown",
    event => {

        if (
            !advancedPanel
            ||
            advancedPanel.hidden
        ) {

            return;

        }


        if (
            event.key ===
            "ArrowUp"
        ) {

            event.preventDefault();


            modifySelectedDb(

                event.shiftKey
                ?
                1.0
                :
                0.1

            );

        }


        if (
            event.key ===
            "ArrowDown"
        ) {

            event.preventDefault();


            modifySelectedDb(

                event.shiftKey
                ?
                -1.0
                :
                -0.1

            );

        }

    }
);


/* =========================================================
   START
========================================================= */

loadHammerCraftProducts();