/* =========================================================
   HAMMER CRAFT
   GUIDED EAR SCANNER V2

   120 PHOTOS PER EAR
   12 ZONES
========================================================= */


const earScanDB =
    window.hcSupabase;


const TARGET_IMAGES_PER_EAR =
    120;


const MIN_IMAGES_PER_EAR =
    90;


const PHOTOS_PER_ZONE =
    10;


const MIN_PHOTOS_PER_ZONE =
    7;


const STORAGE_BUCKET =
    "ear-scans";


let currentUser =
    null;


let currentOrder =
    null;


let currentOrderID =
    null;


let currentScan =
    null;


let cameraStream =
    null;


let currentSide =
    "left";


let leftImages =
    [];


let rightImages =
    [];


let brightnessTimer =
    null;



/* =========================================================
   CAPTURE ROUTE
========================================================= */

const captureRoute = [

    {
        start: 0,
        end: 9,

        title:
            "FRONT CENTRE",

        instruction:
            "Start beside the ear and keep the full outer ear visible.",

        arrow:
            "↑",

        move:
            "Move upward by a very small amount after each photo."
    },


    {
        start: 10,
        end: 19,

        title:
            "FRONT UPPER",

        instruction:
            "Keep strong overlap with the photographs you just captured.",

        arrow:
            "↗",

        move:
            "Move gradually toward the upper-front edge."
    },


    {
        start: 20,
        end: 29,

        title:
            "UPPER FRONT",

        instruction:
            "Angle slightly downward while keeping the ear centred.",

        arrow:
            "↗",

        move:
            "Continue slowly around the upper ear."
    },


    {
        start: 30,
        end: 39,

        title:
            "TOP",

        instruction:
            "Capture the upper helix from gradually changing angles.",

        arrow:
            "→",

        move:
            "Move slowly toward the rear."
    },


    {
        start: 40,
        end: 49,

        title:
            "UPPER REAR",

        instruction:
            "Keep the upper rear edge clearly visible.",

        arrow:
            "↘",

        move:
            "Continue toward the rear of the ear."
    },


    {
        start: 50,
        end: 59,

        title:
            "REAR",

        instruction:
            "Capture the rear contour and visible ear attachment.",

        arrow:
            "↓",

        move:
            "Move gradually downward."
    },


    {
        start: 60,
        end: 69,

        title:
            "LOWER REAR",

        instruction:
            "Capture the lower rear ear while maintaining overlap.",

        arrow:
            "↙",

        move:
            "Move toward the lower edge."
    },


    {
        start: 70,
        end: 79,

        title:
            "BOTTOM",

        instruction:
            "Capture underneath the lower ear without cropping it.",

        arrow:
            "←",

        move:
            "Move gradually toward the front."
    },


    {
        start: 80,
        end: 89,

        title:
            "LOWER FRONT",

        instruction:
            "Capture the lower-front contour and tragus area.",

        arrow:
            "↑",

        move:
            "Move upward toward the centre."
    },


    {
        start: 90,
        end: 99,

        title:
            "CONCHA",

        instruction:
            "Move slightly closer while keeping the concha sharp and well lit.",

        arrow:
            "◎",

        move:
            "Make very small angle changes."
    },


    {
        start: 100,
        end: 109,

        title:
            "TRAGUS + CANAL",

        instruction:
            "Capture the tragus and visible canal entrance from several safe angles.",

        arrow:
            "↔",

        move:
            "Change angle slightly. Do not place anything inside the ear."
    },


    {
        start: 110,
        end: 119,

        title:
            "DETAIL COVERAGE",

        instruction:
            "Complete the scan with overlapping detail views of the ear.",

        arrow:
            "◎",

        move:
            "Keep every movement small and controlled."
    }

];



/* =========================================================
   DOM
========================================================= */

const startPanel =
    document.getElementById(
        "startPanel"
    );


const cameraPanel =
    document.getElementById(
        "cameraPanel"
    );


const reviewPanel =
    document.getElementById(
        "reviewPanel"
    );


const finalPanel =
    document.getElementById(
        "finalPanel"
    );


const completePanel =
    document.getElementById(
        "completePanel"
    );


const video =
    document.getElementById(
        "cameraVideo"
    );


const canvas =
    document.getElementById(
        "captureCanvas"
    );


const scanError =
    document.getElementById(
        "scanError"
    );



/* =========================================================
   INITIALISE
========================================================= */

async function initialiseEarScan() {

    if (
        !earScanDB
    ) {

        showScanError(
            "Unable to connect to Hammer Craft."
        );

        return;
    }


    const {
        data,
        error
    } =
        await earScanDB
            .auth
            .getUser();


    if (
        error
    ) {

        console.error(
            error
        );

    }


    currentUser =
        data?.user ||
        null;


    if (
        !currentUser
    ) {

        window.location.href =
            `login.html?redirect=${
                encodeURIComponent(
                    window.location.href
                )
            }`;

        return;
    }


    const params =
        new URLSearchParams(
            window.location.search
        );


    currentOrderID =
        params.get(
            "order"
        );


    if (
        !currentOrderID
    ) {

        showScanError(
            "No Hammer Craft order was selected."
        );

        return;
    }


    const valid =
        await loadOrder();


    if (
        !valid
    ) {

        return;
    }


    await checkExistingScan();

}



/* =========================================================
   ORDER
========================================================= */

async function loadOrder() {

    const {
        data,
        error
    } =
        await earScanDB
            .from(
                "orders"
            )
            .select(`
                id,
                order_number,
                user_id,
                order_items (
                    id,
                    custom_fit
                )
            `)
            .eq(
                "id",
                currentOrderID
            )
            .eq(
                "user_id",
                currentUser.id
            )
            .maybeSingle();


    if (
        error ||
        !data
    ) {

        showScanError(
            "This order could not be found."
        );

        return false;
    }


    currentOrder =
        data;


    document
        .getElementById(
            "orderInfo"
        )
        .hidden =
        false;


    document
        .getElementById(
            "scanOrderNumber"
        )
        .textContent =
        currentOrder.order_number;


    return true;

}



/* =========================================================
   EXISTING SCAN
========================================================= */

async function checkExistingScan() {

    const {
        data,
        error
    } =
        await earScanDB
            .from(
                "ear_scans"
            )
            .select(
                "*"
            )
            .eq(
                "user_id",
                currentUser.id
            )
            .eq(
                "order_id",
                currentOrder.id
            )
            .order(
                "created_at",
                {
                    ascending:
                        false
                }
            )
            .limit(
                1
            )
            .maybeSingle();


    if (
        error
    ) {

        showScanError(
            error.message
        );

        return;
    }


    if (
        data
        &&
        [
            "uploaded",
            "queued",
            "processing",
            "complete"
        ]
        .includes(
            data.status
        )
    ) {

        currentScan =
            data;


        completePanel.hidden =
            false;

        return;
    }


    currentScan =
        data?.status ===
        "capturing"
        ? data
        : null;


    startPanel.hidden =
        false;

}



/* =========================================================
   CREATE SCAN
========================================================= */

async function createScanRecord() {

    const {
        data,
        error
    } =
        await earScanDB
            .from(
                "ear_scans"
            )
            .insert({

                user_id:
                    currentUser.id,

                order_id:
                    currentOrder.id,

                status:
                    "capturing",

                progress_percent:
                    0,

                progress_stage:
                    "Customer capture",

                error_message:
                    null

            })
            .select()
            .single();


    if (
        error
    ) {

        throw error;
    }


    currentScan =
        data;

}



/* =========================================================
   CAMERA
========================================================= */

async function startGuidedScan() {

    hideScanError();


    try {

        if (
            !currentScan
        ) {

            await createScanRecord();

        }


        cameraStream =
            await navigator
                .mediaDevices
                .getUserMedia({

                    video: {

                        facingMode: {
                            ideal:
                                "environment"
                        },

                        width: {
                            ideal:
                                1920
                        },

                        height: {
                            ideal:
                                1080
                        }

                    },

                    audio:
                        false

                });


        video.srcObject =
            cameraStream;


        await video.play();


        startPanel.hidden =
            true;


        reviewPanel.hidden =
            true;


        cameraPanel.hidden =
            false;


        currentSide =
            "left";


        updateCameraUI();


        startBrightnessCheck();

    }

    catch (
        error
    ) {

        console.error(
            error
        );


        showScanError(
            "Unable to open the camera. Please allow camera access."
        );

    }

}



/* =========================================================
   CURRENT ARRAY
========================================================= */

function getCurrentImages() {

    return (
        currentSide ===
        "left"
    )
        ? leftImages
        : rightImages;

}



/* =========================================================
   CURRENT ZONE
========================================================= */

function getCurrentZoneNumber() {

    const count =
        getCurrentImages()
            .length;


    return Math.min(

        12,

        Math.floor(
            count /
            PHOTOS_PER_ZONE
        )
        +
        1

    );

}



/* =========================================================
   CAPTURE
========================================================= */

async function capturePhoto() {

    const images =
        getCurrentImages();


    if (
        images.length >=
        TARGET_IMAGES_PER_EAR
    ) {

        return;
    }


    if (
        !video.videoWidth ||
        !video.videoHeight
    ) {

        return;
    }


    canvas.width =
        video.videoWidth;


    canvas.height =
        video.videoHeight;


    const context =
        canvas.getContext(
            "2d"
        );


    context.drawImage(

        video,

        0,
        0,

        canvas.width,
        canvas.height

    );


    const blob =
        await new Promise(
            resolve => {

                canvas.toBlob(

                    resolve,

                    "image/jpeg",

                    0.92

                );

            }
        );


    if (
        !blob
    ) {

        return;
    }


    images.push({

        id:
            crypto.randomUUID(),

        blob,

        preview:
            URL.createObjectURL(
                blob
            )

    });


    updateCameraUI();


    if (
        images.length >=
        TARGET_IMAGES_PER_EAR
    ) {

        showReview();

    }

}



/* =========================================================
   UNDO
========================================================= */

function undoLastPhoto() {

    const images =
        getCurrentImages();


    const removed =
        images.pop();


    if (
        removed
    ) {

        URL.revokeObjectURL(
            removed.preview
        );

    }


    updateCameraUI();

}



/* =========================================================
   CAPTURE STAGE
========================================================= */

function getCaptureStage(
    count
) {

    const index =
        Math.min(

            count,

            TARGET_IMAGES_PER_EAR -
            1

        );


    return (

        captureRoute.find(

            stage =>
                index >=
                stage.start
                &&
                index <=
                stage.end

        )

        ||

        captureRoute[
            captureRoute.length -
            1
        ]

    );

}



/* =========================================================
   CAMERA UI
========================================================= */

function updateCameraUI() {

    const images =
        getCurrentImages();


    const count =
        images.length;


    const zone =
        getCurrentZoneNumber();


    const stage =
        getCaptureStage(
            count
        );


    document
        .getElementById(
            "currentEarTitle"
        )
        .textContent =
        currentSide ===
        "left"
        ? "Left ear"
        : "Right ear";


    document
        .getElementById(
            "captureCount"
        )
        .textContent =
        `${count} / ${TARGET_IMAGES_PER_EAR}`;


    document
        .getElementById(
            "captureStageTitle"
        )
        .textContent =
        `ZONE ${zone} / 12 — ${stage.title}`;


    document
        .getElementById(
            "captureInstruction"
        )
        .textContent =
        stage.instruction;


    document
        .getElementById(
            "movementArrow"
        )
        .textContent =
        stage.arrow;


    document
        .getElementById(
            "movementText"
        )
        .textContent =
        stage.move;


    document
        .getElementById(
            "captureProgress"
        )
        .style
        .width =
        `${
            count /
            TARGET_IMAGES_PER_EAR
            *
            100
        }%`;


    document
        .getElementById(
            "undoPhotoButton"
        )
        .disabled =
        count ===
        0;


    renderMiniPreviews();

}



/* =========================================================
   MINI PREVIEW
========================================================= */

function renderMiniPreviews() {

    const container =
        document.getElementById(
            "miniPreviewStrip"
        );


    container.innerHTML =
        getCurrentImages()
            .slice(
                -10
            )
            .map(
                image => `

                    <img
                        src="${image.preview}"
                        alt="Recent ear capture"
                    >

                `
            )
            .join("");

}



/* =========================================================
   ZONE COUNTS
========================================================= */

function calculateZoneCounts(
    images
) {

    const counts =
        new Array(
            12
        )
        .fill(
            0
        );


    images.forEach(
        (
            image,
            index
        ) => {

            const zone =
                Math.min(

                    11,

                    Math.floor(
                        index /
                        PHOTOS_PER_ZONE
                    )

                );


            counts[
                zone
            ] +=
                1;

        }
    );


    return counts;

}



/* =========================================================
   REVIEW
========================================================= */

function showReview() {

    stopBrightnessCheck();


    cameraPanel.hidden =
        true;


    reviewPanel.hidden =
        false;


    renderReviewGrid();


    updateReviewButtons();

}



/* =========================================================
   REVIEW GRID
========================================================= */

function renderReviewGrid() {

    const container =
        document.getElementById(
            "reviewGrid"
        );


    const images =
        getCurrentImages();


    container.innerHTML =
        "";


    document
        .getElementById(
            "reviewTitle"
        )
        .textContent =
        currentSide ===
        "left"
        ? "Left ear captured."
        : "Right ear captured.";


    document
        .getElementById(
            "reviewCount"
        )
        .textContent =
        `${images.length} IMAGES`;


    images.forEach(
        (
            image,
            index
        ) => {

            const item =
                document.createElement(
                    "div"
                );


            item.className =
                "review-item";


            const zone =
                Math.floor(
                    index /
                    PHOTOS_PER_ZONE
                )
                +
                1;


            item.innerHTML = `

                <img
                    src="${image.preview}"
                    alt="Ear capture"
                >

                <small>
                    Z${zone}
                </small>

                <button
                    type="button"
                    aria-label="Remove image"
                >
                    ×
                </button>

            `;


            item
                .querySelector(
                    "button"
                )
                .addEventListener(
                    "click",
                    () =>
                        removeReviewImage(
                            image.id
                        )
                );


            container.appendChild(
                item
            );

        }
    );

}



/* =========================================================
   REMOVE
========================================================= */

function removeReviewImage(
    id
) {

    const images =
        getCurrentImages();


    const index =
        images.findIndex(
            image =>
                image.id ===
                id
        );


    if (
        index ===
        -1
    ) {

        return;
    }


    URL.revokeObjectURL(
        images[
            index
        ]
        .preview
    );


    images.splice(
        index,
        1
    );


    renderReviewGrid();


    updateReviewButtons();

}



/* =========================================================
   REVIEW VALIDATION
========================================================= */

function currentEarIsValid() {

    const images =
        getCurrentImages();


    if (
        images.length <
        MIN_IMAGES_PER_EAR
    ) {

        return false;
    }


    /*
     * NOTE:
     *
     * Because removing an arbitrary photo changes the
     * array index, a production version should store
     * zone_id on each captured image.
     *
     * For now, the normal 120-photo capture path remains
     * correctly ordered.
     */

    const zoneCounts =
        calculateZoneCounts(
            images
        );


    return zoneCounts.every(
        count =>
            count >=
            MIN_PHOTOS_PER_ZONE
    );

}



/* =========================================================
   REVIEW BUTTON
========================================================= */

function updateReviewButtons() {

    const button =
        document.getElementById(
            "continueEarButton"
        );


    button.disabled =
        !currentEarIsValid();


    button.textContent =
        currentSide ===
        "left"
        ? "START RIGHT EAR →"
        : "CONTINUE TO UPLOAD →";

}



/* =========================================================
   RETAKE
========================================================= */

function retakeCurrentEar() {

    const images =
        getCurrentImages();


    images.forEach(
        image =>
            URL.revokeObjectURL(
                image.preview
            )
    );


    images.length =
        0;


    reviewPanel.hidden =
        true;


    cameraPanel.hidden =
        false;


    updateCameraUI();


    startBrightnessCheck();

}



/* =========================================================
   CONTINUE
========================================================= */

function continueAfterReview() {

    if (
        !currentEarIsValid()
    ) {

        showScanError(
            "Please complete every capture zone before continuing."
        );

        return;
    }


    if (
        currentSide ===
        "left"
    ) {

        currentSide =
            "right";


        reviewPanel.hidden =
            true;


        cameraPanel.hidden =
            false;


        updateCameraUI();


        startBrightnessCheck();

        return;
    }


    stopCamera();


    reviewPanel.hidden =
        true;


    finalPanel.hidden =
        false;


    document
        .getElementById(
            "finalLeftCount"
        )
        .textContent =
        `${leftImages.length} IMAGES`;


    document
        .getElementById(
            "finalRightCount"
        )
        .textContent =
        `${rightImages.length} IMAGES`;

}



/* =========================================================
   BRIGHTNESS
========================================================= */

function startBrightnessCheck() {

    stopBrightnessCheck();


    brightnessTimer =
        setInterval(
            checkBrightness,
            1200
        );

}



function stopBrightnessCheck() {

    if (
        brightnessTimer
    ) {

        clearInterval(
            brightnessTimer
        );


        brightnessTimer =
            null;

    }

}



function checkBrightness() {

    if (
        !video.videoWidth ||
        !video.videoHeight
    ) {

        return;
    }


    const sample =
        document.createElement(
            "canvas"
        );


    sample.width =
        64;


    sample.height =
        64;


    const context =
        sample.getContext(
            "2d",
            {
                willReadFrequently:
                    true
            }
        );


    context.drawImage(

        video,

        0,
        0,

        64,
        64

    );


    const pixels =
        context
            .getImageData(
                0,
                0,
                64,
                64
            )
            .data;


    let total =
        0;


    let count =
        0;


    for (
        let i = 0;
        i < pixels.length;
        i += 4
    ) {

        total += (

            pixels[i]

            +

            pixels[
                i + 1
            ]

            +

            pixels[
                i + 2
            ]

        ) / 3;


        count++;

    }


    const average =
        total /
        count;


    const warning =
        document.getElementById(
            "lightingWarning"
        );


    if (
        average <
        55
    ) {

        warning.hidden =
            false;


        warning.textContent =
            "TOO DARK — MOVE TO BRIGHTER LIGHT";

    }

    else if (
        average >
        225
    ) {

        warning.hidden =
            false;


        warning.textContent =
            "TOO BRIGHT — REDUCE DIRECT LIGHT";

    }

    else {

        warning.hidden =
            true;

    }

}



/* =========================================================
   UPLOAD
========================================================= */

async function uploadScan() {

    if (
        leftImages.length <
        MIN_IMAGES_PER_EAR
        ||
        rightImages.length <
        MIN_IMAGES_PER_EAR
    ) {

        showScanError(
            "Both ears must have enough photographs before upload."
        );

        return;
    }


    const button =
        document.getElementById(
            "submitScanButton"
        );


    button.disabled =
        true;


    button.textContent =
        "UPLOADING...";


    try {

        const total =
            leftImages.length
            +
            rightImages.length;


        let completed =
            0;


        for (
            let i = 0;
            i < leftImages.length;
            i++
        ) {

            await uploadImage(

                "left",

                leftImages[
                    i
                ].blob,

                i

            );


            completed++;


            updateUploadProgress(
                completed,
                total
            );

        }


        for (
            let i = 0;
            i < rightImages.length;
            i++
        ) {

            await uploadImage(

                "right",

                rightImages[
                    i
                ].blob,

                i

            );


            completed++;


            updateUploadProgress(
                completed,
                total
            );

        }


        const {
            error
        } =
            await earScanDB
                .from(
                    "ear_scans"
                )
                .update({

                    status:
                        "uploaded",

                    progress_percent:
                        0,

                    progress_stage:
                        "Waiting for admin processing",

                    error_message:
                        null,

                    updated_at:
                        new Date()
                            .toISOString()

                })
                .eq(
                    "id",
                    currentScan.id
                );


        if (
            error
        ) {

            throw error;
        }


        cleanupImages();


        finalPanel.hidden =
            true;


        completePanel.hidden =
            false;

    }

    catch (
        error
    ) {

        console.error(
            error
        );


        showScanError(
            error.message ||
            "Unable to upload the ear scan."
        );


        button.disabled =
            false;


        button.textContent =
            "UPLOAD EAR SCAN →";

    }

}



/* =========================================================
   UPLOAD SINGLE IMAGE
========================================================= */

async function uploadImage(
    side,
    blob,
    index
) {

    const filename =
        `${String(
            index +
            1
        ).padStart(
            3,
            "0"
        )}.jpg`;


    const path =
        `${currentUser.id}/${currentScan.id}/${side}/${filename}`;


    const {
        error
    } =
        await earScanDB
            .storage
            .from(
                STORAGE_BUCKET
            )
            .upload(

                path,

                blob,

                {

                    contentType:
                        "image/jpeg",

                    upsert:
                        false

                }

            );


    if (
        error
    ) {

        throw error;
    }

}



/* =========================================================
   UPLOAD PROGRESS
========================================================= */

function updateUploadProgress(
    completed,
    total
) {

    const percent =
        Math.round(
            completed /
            total *
            100
        );


    document
        .getElementById(
            "uploadStatus"
        )
        .textContent =
        `Uploading ${completed}/${total} — ${percent}%`;

}



/* =========================================================
   STOP CAMERA
========================================================= */

function stopCamera() {

    stopBrightnessCheck();


    if (
        cameraStream
    ) {

        cameraStream
            .getTracks()
            .forEach(
                track =>
                    track.stop()
            );


        cameraStream =
            null;

    }


    video.srcObject =
        null;

}



/* =========================================================
   CLEANUP
========================================================= */

function cleanupImages() {

    [
        ...leftImages,
        ...rightImages
    ]
    .forEach(
        image =>
            URL.revokeObjectURL(
                image.preview
            )
    );

}



/* =========================================================
   ERROR
========================================================= */

function showScanError(
    message
) {

    scanError.hidden =
        false;


    scanError.textContent =
        message;

}



function hideScanError() {

    scanError.hidden =
        true;


    scanError.textContent =
        "";

}



/* =========================================================
   EVENTS
========================================================= */

document
    .getElementById(
        "startScanButton"
    )
    .addEventListener(
        "click",
        startGuidedScan
    );


document
    .getElementById(
        "capturePhotoButton"
    )
    .addEventListener(
        "click",
        capturePhoto
    );


document
    .getElementById(
        "undoPhotoButton"
    )
    .addEventListener(
        "click",
        undoLastPhoto
    );


document
    .getElementById(
        "retakeEarButton"
    )
    .addEventListener(
        "click",
        retakeCurrentEar
    );


document
    .getElementById(
        "continueEarButton"
    )
    .addEventListener(
        "click",
        continueAfterReview
    );


document
    .getElementById(
        "submitScanButton"
    )
    .addEventListener(
        "click",
        uploadScan
    );


window.addEventListener(
    "beforeunload",
    () => {

        stopCamera();

        cleanupImages();

    }
);



/* =========================================================
   START
========================================================= */

initialiseEarScan();