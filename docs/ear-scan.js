/* =========================================================
   HAMMER CRAFT
   GUIDED MULTI-PHOTO EAR SCANNER
========================================================= */

const earScanDB =
    window.hcSupabase;


const TARGET_IMAGES_PER_EAR =
    30;


const MIN_REVIEW_IMAGES =
    25;


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
        end: 3,
        title: "FRONT",
        instruction:
            "Keep the ear centred inside the outline.",
        arrow: "↑",
        move:
            "Move slightly upward after each photo."
    },

    {
        start: 4,
        end: 7,
        title: "UPPER FRONT",
        instruction:
            "Keep most of the previous view visible.",
        arrow: "↗",
        move:
            "Move gradually toward the top-front angle."
    },

    {
        start: 8,
        end: 11,
        title: "TOP",
        instruction:
            "Angle the camera slightly downward toward the upper ear.",
        arrow: "→",
        move:
            "Move slowly across the upper edge."
    },

    {
        start: 12,
        end: 15,
        title: "UPPER REAR",
        instruction:
            "Capture the upper rear edge without losing overlap.",
        arrow: "↘",
        move:
            "Move slowly toward the rear of the ear."
    },

    {
        start: 16,
        end: 19,
        title: "REAR",
        instruction:
            "Capture the rear contour and visible ear attachment.",
        arrow: "↓",
        move:
            "Move downward in small steps."
    },

    {
        start: 20,
        end: 23,
        title: "LOWER REAR",
        instruction:
            "Keep the lower rear ear visible and in focus.",
        arrow: "↙",
        move:
            "Move gradually toward the bottom-front."
    },

    {
        start: 24,
        end: 26,
        title: "LOWER FRONT",
        instruction:
            "Capture the lower front with strong overlap.",
        arrow: "↑",
        move:
            "Move slightly upward toward the starting angle."
    },

    {
        start: 27,
        end: 29,
        title: "CONCHA DETAIL",
        instruction:
            "Move a little closer and capture central ear detail.",
        arrow: "◎",
        move:
            "Keep the centre of the ear sharp and well lit."
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


    const orderURL =
        `order.html?hc_order=${
            encodeURIComponent(
                currentOrder.id
            )
        }`;


    document
        .getElementById(
            "returnToOrder"
        )
        .href =
        orderURL;


    document
        .getElementById(
            "viewOrderButton"
        )
        .href =
        orderURL;


    await checkExistingScan();

}



/* =========================================================
   LOAD ORDER
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

        console.error(
            error
        );


        showScanError(
            "This order could not be found or does not belong to your account."
        );

        return false;
    }


    const needsCustomFit =
        (
            data.order_items ||
            []
        )
        .some(
            item =>
                item.custom_fit ===
                true
        );


    if (
        !needsCustomFit
    ) {

        showScanError(
            "This order does not require a custom-fit ear scan."
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
            .select("*")
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
                    ascending: false
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
        !data
    ) {

        startPanel.hidden =
            false;

        return;
    }


    if (
        [
            "uploaded",
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
        data.status ===
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
   START CAMERA
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


        finalPanel.hidden =
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
            "Unable to open the camera. Please allow camera access and try again."
        );

    }

}



/* =========================================================
   CAPTURE
========================================================= */

async function capturePhoto() {

    if (
        !cameraStream
    ) {

        return;
    }


    const images =
        getCurrentImages();


    if (
        images.length >=
        TARGET_IMAGES_PER_EAR
    ) {

        return;
    }


    const width =
        video.videoWidth;


    const height =
        video.videoHeight;


    if (
        !width ||
        !height
    ) {

        return;
    }


    canvas.width =
        width;


    canvas.height =
        height;


    const context =
        canvas.getContext(
            "2d"
        );


    context.drawImage(
        video,
        0,
        0,
        width,
        height
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

        showScanError(
            "Unable to capture this image."
        );

        return;
    }


    const image = {

        id:
            crypto.randomUUID(),

        blob:
            blob,

        preview:
            URL.createObjectURL(
                blob
            )

    };


    images.push(
        image
    );


    updateCameraUI();


    if (
        images.length >=
        TARGET_IMAGES_PER_EAR
    ) {

        showReview();

    }

}



/* =========================================================
   CURRENT IMAGE ARRAY
========================================================= */

function getCurrentImages() {

    return currentSide ===
        "left"
        ? leftImages
        : rightImages;

}



/* =========================================================
   UNDO
========================================================= */

function undoLastPhoto() {

    const images =
        getCurrentImages();


    const last =
        images.pop();


    if (
        last
    ) {

        URL.revokeObjectURL(
            last.preview
        );

    }


    updateCameraUI();

}



/* =========================================================
   CAMERA UI
========================================================= */

function updateCameraUI() {

    const images =
        getCurrentImages();


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
        `${images.length} / ${TARGET_IMAGES_PER_EAR}`;


    document
        .getElementById(
            "captureProgress"
        )
        .style.width =
        `${
            (
                images.length /
                TARGET_IMAGES_PER_EAR
            )
            *
            100
        }%`;


    document
        .getElementById(
            "undoPhotoButton"
        )
        .disabled =
        images.length ===
        0;


    const stage =
        getCaptureStage(
            images.length
        );


    document
        .getElementById(
            "captureStageTitle"
        )
        .textContent =
        stage.title;


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


    renderMiniPreviews();

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
            TARGET_IMAGES_PER_EAR - 1
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
   MINI PREVIEWS
========================================================= */

function renderMiniPreviews() {

    const container =
        document.getElementById(
            "miniPreviewStrip"
        );


    const images =
        getCurrentImages()
            .slice(
                -10
            );


    container.innerHTML =
        images
            .map(
                image => `
                    <img
                        src="${image.preview}"
                        alt="Captured ear photo"
                    >
                `
            )
            .join("");

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


    const images =
        getCurrentImages();


    document
        .getElementById(
            "reviewTitle"
        )
        .textContent =
        currentSide ===
        "left"
        ? "Left ear captured."
        : "Right ear captured.";


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
            "reviewCount"
        )
        .textContent =
        `${images.length} IMAGES`;


    images.forEach(
        image => {

            const item =
                document.createElement(
                    "div"
                );


            item.className =
                "review-item";


            item.innerHTML = `

                <img
                    src="${image.preview}"
                    alt="Ear capture"
                >

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
   REMOVE REVIEW IMAGE
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
   REVIEW BUTTONS
========================================================= */

function updateReviewButtons() {

    const count =
        getCurrentImages()
            .length;


    const continueButton =
        document.getElementById(
            "continueEarButton"
        );


    continueButton.disabled =
        count <
        MIN_REVIEW_IMAGES;


    continueButton.textContent =
        currentSide ===
        "left"
        ? "START RIGHT EAR →"
        : "CONTINUE TO UPLOAD →";

}



/* =========================================================
   RETAKE EAR
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


    startBrightnessCheck();


    updateCameraUI();

}



/* =========================================================
   CONTINUE
========================================================= */

function continueAfterReview() {

    const images =
        getCurrentImages();


    if (
        images.length <
        MIN_REVIEW_IMAGES
    ) {

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


        startBrightnessCheck();


        updateCameraUI();

    }

    else {

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

}



/* =========================================================
   BASIC BRIGHTNESS CHECK
========================================================= */

function startBrightnessCheck() {

    stopBrightnessCheck();


    brightnessTimer =
        setInterval(
            checkBrightness,
            1200
        );

}



/* =========================================================
   STOP BRIGHTNESS CHECK
========================================================= */

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



/* =========================================================
   CHECK BRIGHTNESS
========================================================= */

function checkBrightness() {

    if (
        !video.videoWidth ||
        !video.videoHeight
    ) {

        return;
    }


    const sampleCanvas =
        document.createElement(
            "canvas"
        );


    sampleCanvas.width =
        64;


    sampleCanvas.height =
        64;


    const ctx =
        sampleCanvas
            .getContext(
                "2d",
                {
                    willReadFrequently:
                        true
                }
            );


    ctx.drawImage(
        video,
        0,
        0,
        64,
        64
    );


    const pixels =
        ctx
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

        total +=
            (
                pixels[i]
                +
                pixels[i + 1]
                +
                pixels[i + 2]
            )
            /
            3;


        count++;

    }


    const average =
        total /
        count;


    document
        .getElementById(
            "lightingWarning"
        )
        .hidden =
        average >=
        70;

}



/* =========================================================
   UPLOAD
========================================================= */

async function uploadScan() {

    if (
        !currentScan
    ) {

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

        const allCount =
            leftImages.length +
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
                leftImages[i].blob,
                i
            );


            completed++;


            updateUploadProgress(
                completed,
                allCount
            );

        }


        for (
            let i = 0;
            i < rightImages.length;
            i++
        ) {

            await uploadImage(
                "right",
                rightImages[i].blob,
                i
            );


            completed++;


            updateUploadProgress(
                completed,
                allCount
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
   UPLOAD IMAGE
========================================================= */

async function uploadImage(
    side,
    blob,
    index
) {

    const filename =
        `${String(
            index + 1
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

        throw new Error(
            `${side} image ${
                index + 1
            }: ${error.message}`
        );

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