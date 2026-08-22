/* =========================================================
   HAMMER CRAFT
   CUSTOM TUNING ENGINE V1
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


let guidedPreferences = {

    bass:
        0,

    bassCharacter:
        "natural",

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
   ELEMENTS
========================================================= */

const guidedModeButton =
    document.getElementById(
        "guidedTuningMode"
    );


const advancedModeButton =
    document.getElementById(
        "advancedTuningMode"
    );


const guidedPanel =
    document.getElementById(
        "guidedTuningPanel"
    );


const advancedPanel =
    document.getElementById(
        "advancedTuningPanel"
    );


const tuningResult =
    document.getElementById(
        "tuningResult"
    );


const canvas =
    document.getElementById(
        "tuningGraph"
    );


const context =
    canvas
        ? canvas.getContext(
            "2d"
        )
        : null;


/* =========================================================
   MODE
========================================================= */

function openGuidedTuning() {

    tuningMode =
        "guided";


    guidedPanel.hidden =
        false;


    advancedPanel.hidden =
        true;


    tuningResult.hidden =
        true;


    guidedPanel.scrollIntoView({

        behavior:
            "smooth",

        block:
            "start"

    });

}


function openAdvancedTuning() {

    tuningMode =
        "advanced";


    guidedPanel.hidden =
        true;


    advancedPanel.hidden =
        false;


    tuningResult.hidden =
        true;


    drawTuningGraph();


    advancedPanel.scrollIntoView({

        behavior:
            "smooth",

        block:
            "start"

    });

}


function closeTuningPanels() {

    guidedPanel.hidden =
        true;


    advancedPanel.hidden =
        true;

}


/* =========================================================
   GUIDED CHOICES
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
                                        item => {

                                            item
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


                                const rawValue =
                                    button.dataset.value;


                                const numericValue =
                                    Number(
                                        rawValue
                                    );


                                guidedPreferences[
                                    setting
                                ] =
                                    Number.isFinite(
                                        numericValue
                                    )
                                    &&
                                    rawValue.trim() !==
                                        ""

                                    ? numericValue

                                    : rawValue;

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
   DB HELPERS
========================================================= */

function quantizeDb(
    value
) {

    return (
        Math.round(
            value * 10
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
   GUIDED → TARGET
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
               BASS
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
                        1.2;

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
               VOCAL POSITION
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
               SENSITIVITY
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
            ) {

                if (
                    frequency <=
                    100
                ) {

                    value +=
                        0.8;

                }

            }


            if (
                guidedPreferences
                    .music
                    .includes(
                        "vocal"
                    )
            ) {

                if (
                    frequency >=
                    1000
                    &&
                    frequency <=
                    3000
                ) {

                    value +=
                        0.5;

                }

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


    showGeneratedResult();

}


/* =========================================================
   SIMPLE SMOOTHING
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

        const smoothed =
            (
                original[
                    index - 1
                ]
                +
                original[
                    index
                ] * 2
                +
                original[
                    index + 1
                ]
            )
            /
            4;


        tuningAdjustments[
            index
        ] =
            clampDb(
                smoothed
            );

    }

}


/* =========================================================
   RESULT
========================================================= */

function showGeneratedResult() {

    guidedPanel.hidden =
        true;


    advancedPanel.hidden =
        true;


    tuningResult.hidden =
        false;


    const resultText =
        document.getElementById(
            "tuningResultText"
        );


    resultText.textContent =
        "Your answers have been converted into a "
        +
        "Hammer Craft target. You can accept it now "
        +
        "or fine tune every region in 0.1 dB steps.";


    tuningResult.scrollIntoView({

        behavior:
            "smooth",

        block:
            "start"

    });

}


/* =========================================================
   GRAPH POSITION
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


    const minLog =
        Math.log10(
            20
        );


    const maxLog =
        Math.log10(
            16000
        );


    const position =
        (
            Math.log10(
                frequency
            )
            -
            minLog
        )
        /
        (
            maxLog
            -
            minLog
        );


    return (
        padding
        +
        position * width
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


    const maximum =
        6;


    const minimum =
        -6;


    return (
        padding
        +
        (
            maximum -
            db
        )
        /
        (
            maximum -
            minimum
        )
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
            y -
            padding
        )
        /
        height;


    return clampDb(
        6 -
        ratio * 12
    );

}


/* =========================================================
   GRAPH
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


    context.lineWidth =
        1;


    /* ---------------------------------------------
       GRID
    --------------------------------------------- */

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


    /* ---------------------------------------------
       REFERENCE
    --------------------------------------------- */

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


    /* ---------------------------------------------
       CUSTOM CURVE
    --------------------------------------------- */

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


    /* ---------------------------------------------
       POINTS
    --------------------------------------------- */

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
                    ? 10
                    : 7,

                0,
                Math.PI * 2

            );


            context.fillStyle =
                index ===
                    selectedPointIndex
                    ? "#9b6739"
                    : "#252321";


            context.fill();

        }
    );


    updateSelectedPointUI();

}


/* =========================================================
   SELECT POINT
========================================================= */

function findNearestPoint(
    mouseX,
    mouseY
) {

    let closest =
        0;


    let distance =
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


            const currentDistance =
                Math.hypot(

                    mouseX - x,

                    mouseY - y

                );


            if (
                currentDistance <
                distance
            ) {

                distance =
                    currentDistance;


                closest =
                    index;

            }

        }
    );


    return closest;

}


/* =========================================================
   DRAG
========================================================= */

let dragging =
    false;


if (
    canvas
) {

    canvas.addEventListener(
        "mousedown",
        event => {

            const rect =
                canvas
                    .getBoundingClientRect();


            const scaleX =
                canvas.width
                /
                rect.width;


            const scaleY =
                canvas.height
                /
                rect.height;


            const x =
                (
                    event.clientX -
                    rect.left
                )
                *
                scaleX;


            const y =
                (
                    event.clientY -
                    rect.top
                )
                *
                scaleY;


            selectedPointIndex =
                findNearestPoint(
                    x,
                    y
                );


            dragging =
                true;


            tuningAdjustments[
                selectedPointIndex
            ] =
                yToDb(
                    y
                );


            drawTuningGraph();

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


            const scaleY =
                canvas.height
                /
                rect.height;


            const y =
                (
                    event.clientY -
                    rect.top
                )
                *
                scaleY;


            tuningAdjustments[
                selectedPointIndex
            ] =
                yToDb(
                    y
                );


            drawTuningGraph();

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
   POINT UI
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


    document
        .getElementById(
            "selectedFrequency"
        )
        .textContent =
            frequency >= 1000
            ?
            `${frequency / 1000} kHz`
            :
            `${frequency} Hz`;


    document
        .getElementById(
            "selectedAdjustment"
        )
        .textContent =
            `${
                adjustment > 0
                ? "+"
                : ""
            }${adjustment.toFixed(1)} dB`;


    document
        .getElementById(
            "dbAdjustmentInput"
        )
        .value =
            adjustment.toFixed(
                1
            );

}


/* =========================================================
   +/- BUTTONS
========================================================= */

function modifySelectedDb(
    amount
) {

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

}


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


            drawTuningGraph();

        }
    );


/* =========================================================
   KEYBOARD
========================================================= */

document.addEventListener(
    "keydown",
    event => {

        if (
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
                ? 1
                : 0.1

            );

        }


        if (
            event.key ===
            "ArrowDown"
        ) {

            event.preventDefault();


            modifySelectedDb(

                event.shiftKey
                ? -1
                : -0.1

            );

        }

    }
);


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


    drawTuningGraph();

}


/* =========================================================
   SAVE
========================================================= */

function buildTuningProfile() {

    return {

        version:
            1,

        mode:
            tuningMode,

        baseTarget:
            "HC_REFERENCE_V1",

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

        createdAt:
            new Date()
                .toISOString()

    };

}


async function saveTuningProfile() {

    const profile =
        buildTuningProfile();


    localStorage.setItem(

        "hammerCraftCustomTuning",

        JSON.stringify(
            profile
        )

    );


    console.log(
        "Hammer Craft tuning:",
        profile
    );


    /*
     * Later, if the user is logged in,
     * this same object can be stored in
     * Supabase against the customer/order.
     */


    alert(
        "Your Hammer Craft custom tuning has been saved."
    );

}


/* =========================================================
   EVENTS
========================================================= */

guidedModeButton
    ?.addEventListener(
        "click",
        openGuidedTuning
    );


advancedModeButton
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
        "resetTuningButton"
    )
    ?.addEventListener(
        "click",
        resetTuning
    );


document
    .getElementById(
        "saveTuningButton"
    )
    ?.addEventListener(
        "click",
        saveTuningProfile
    );


document
    .getElementById(
        "confirmTuningButton"
    )
    ?.addEventListener(
        "click",
        saveTuningProfile
    );


/* =========================================================
   RESTORE
========================================================= */

function restoreTuning() {

    const saved =
        localStorage.getItem(
            "hammerCraftCustomTuning"
        );


    if (
        !saved
    ) {

        return;

    }


    try {

        const profile =
            JSON.parse(
                saved
            );


        if (
            Array.isArray(
                profile.anchors
            )
        ) {

            tuningAdjustments =
                tuningFrequencies.map(
                    frequency => {

                        const found =
                            profile
                                .anchors
                                .find(
                                    item =>
                                        item.frequency ===
                                        frequency
                                );


                        return found
                            ?
                            clampDb(
                                found.adjustmentDb
                            )
                            :
                            0;

                    }
                );

        }


    }

    catch (
        error
    ) {

        console.error(
            "Unable to restore tuning:",
            error
        );

    }

}


restoreTuning();