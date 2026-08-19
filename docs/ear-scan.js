/* =========================================================
   HAMMER CRAFT
   CONTINUOUS EAR SCANNER
========================================================= */


const db =
    window.hcSupabase;


const TARGET_FRAMES =
    45;


const MAX_FRAMES =
    60;


const FRAME_INTERVAL =
    300;



const state = {

    user: null,

    scanID: null,

    stream: null,

    side: null,

    scanning: false,

    timer: null,

    captures: {

        left: [],
        right: []

    }

};


let previousSignature =
    null;



/* =========================================================
   ELEMENTS
========================================================= */


const screens =
    document.querySelectorAll(
        ".screen"
    );


const camera =
    document.getElementById(
        "camera"
    );


const canvas =
    document.getElementById(
        "captureCanvas"
    );


const frameCounter =
    document.getElementById(
        "frameCounter"
    );


const coverageFill =
    document.getElementById(
        "coverageFill"
    );


const coverageValue =
    document.getElementById(
        "coverageValue"
    );


const scanDirection =
    document.getElementById(
        "scanDirection"
    );


const qualityMessage =
    document.getElementById(
        "qualityMessage"
    );


const thumbnailStrip =
    document.getElementById(
        "thumbnailStrip"
    );


const uploadStatus =
    document.getElementById(
        "uploadStatus"
    );



/* =========================================================
   SCREENS
========================================================= */


function showScreen(
    id
) {

    screens.forEach(
        screen => {

            screen
                .classList
                .remove(
                    "active"
                );

        }
    );


    document
        .getElementById(
            id
        )
        .classList
        .add(
            "active"
        );


    window.scrollTo(
        0,
        0
    );

}



/* =========================================================
   AUTH
========================================================= */


async function requireUser() {

    const {
        data,
        error
    } =
        await db
            .auth
            .getSession();


    if (
        error ||
        !data.session
    ) {

        window.location.replace(
            "login.html"
        );

        return null;

    }


    return data.session.user;

}



/* =========================================================
   CREATE SCAN
========================================================= */


async function createScan() {

    if (
        state.scanID
    ) {

        return;

    }


    const {
        data,
        error
    } =
        await db
            .from(
                "ear_scans"
            )
            .insert({

                user_id:
                    state.user.id,

                status:
                    "capturing",

                left_image_count:
                    0,

                right_image_count:
                    0

            })
            .select(
                "id"
            )
            .single();


    if (error) {

        throw error;

    }


    state.scanID =
        data.id;

}



/* =========================================================
   CAMERA
========================================================= */


async function startCamera() {

    state.stream =
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

                audio: false

            });


    camera.srcObject =
        state.stream;


    await camera.play();

}



function stopCamera() {

    stopCapture();


    if (
        state.stream
    ) {

        state.stream
            .getTracks()
            .forEach(
                track =>
                    track.stop()
            );

    }


    state.stream =
        null;

}



/* =========================================================
   START SIDE
========================================================= */


async function beginEar(
    side
) {

    state.side =
        side;


    state.captures[
        side
    ] =
        [];


    previousSignature =
        null;


    thumbnailStrip.innerHTML =
        "";


    document
        .getElementById(
            "cameraTitle"
        )
        .textContent =
        side.toUpperCase() +
        " EAR";


    updateProgress();


    showScreen(
        "cameraScreen"
    );


    await startCamera();

}



/* =========================================================
   CONTINUOUS CAPTURE
========================================================= */


function startCapture() {

    if (
        state.scanning
    ) {

        stopCapture();

        return;

    }


    state.scanning =
        true;


    document
        .getElementById(
            "startContinuousScanButton"
        )
        .textContent =
        "STOP SCANNING";


    qualityMessage.textContent =
        "Move slowly around the ear.";


    state.timer =
        setInterval(

            captureCandidate,

            FRAME_INTERVAL

        );

}



function stopCapture() {

    state.scanning =
        false;


    if (
        state.timer
    ) {

        clearInterval(
            state.timer
        );

        state.timer =
            null;

    }


    const button =
        document.getElementById(
            "startContinuousScanButton"
        );


    if (button) {

        button.textContent =
            "START SCANNING";

    }

}



/* =========================================================
   FRAME ANALYSIS
========================================================= */


function captureCandidate() {

    if (
        !camera.videoWidth ||
        !camera.videoHeight
    ) {

        return;

    }


    const captured =
        state.captures[
            state.side
        ];


    if (
        captured.length >=
        MAX_FRAMES
    ) {

        finishEar();

        return;

    }


    canvas.width =
        camera.videoWidth;


    canvas.height =
        camera.videoHeight;


    const ctx =
        canvas.getContext(
            "2d",
            {
                willReadFrequently:
                    true
            }
        );


    ctx.drawImage(

        camera,

        0,
        0,

        canvas.width,
        canvas.height

    );


    const quality =
        analyseFrame(
            canvas
        );


    if (
        !quality.accept
    ) {

        qualityMessage.textContent =
            quality.message;

        return;

    }


    canvas.toBlob(

        blob => {

            if (!blob) {
                return;
            }


            captured.push({

                blob,

                sharpness:
                    quality.sharpness,

                brightness:
                    quality.brightness,

                timestamp:
                    Date.now()

            });


            addThumbnail(
                blob
            );


            updateProgress();


            qualityMessage.textContent =
                "Frame accepted — keep moving slowly.";


            if (
                captured.length >=
                TARGET_FRAMES
            ) {

                finishEar();

            }

        },

        "image/jpeg",

        .93

    );

}



/* =========================================================
   QUALITY ANALYSIS
========================================================= */


function analyseFrame(
    sourceCanvas
) {

    const width =
        240;


    const height =
        Math.round(

            sourceCanvas.height *

            width /

            sourceCanvas.width

        );


    const sample =
        document.createElement(
            "canvas"
        );


    sample.width =
        width;


    sample.height =
        height;


    const ctx =
        sample.getContext(
            "2d",
            {
                willReadFrequently:
                    true
            }
        );


    ctx.drawImage(

        sourceCanvas,

        0,
        0,

        width,
        height

    );


    const image =
        ctx.getImageData(
            0,
            0,
            width,
            height
        );


    const brightness =
        averageBrightness(
            image
        );


    const sharpness =
        estimateSharpness(
            image,
            width,
            height
        );


    const signature =
        frameSignature(
            image
        );


    if (
        brightness <
        40
    ) {

        return {

            accept: false,

            message:
                "Image too dark.",

            brightness,
            sharpness

        };

    }


    if (
        brightness >
        235
    ) {

        return {

            accept: false,

            message:
                "Image too bright.",

            brightness,
            sharpness

        };

    }


    if (
        sharpness <
        8
    ) {

        return {

            accept: false,

            message:
                "Move more slowly — image is blurred.",

            brightness,
            sharpness

        };

    }


    if (
        previousSignature !==
        null
    ) {

        const difference =
            Math.abs(

                signature -
                previousSignature

            );


        if (
            difference <
            1.5
        ) {

            return {

                accept: false,

                message:
                    "Move to a slightly different angle.",

                brightness,
                sharpness

            };

        }

    }


    previousSignature =
        signature;


    return {

        accept: true,

        message:
            "Good frame.",

        brightness,
        sharpness

    };

}



function averageBrightness(
    image
) {

    const d =
        image.data;


    let sum =
        0;


    let count =
        0;


    for (
        let i = 0;
        i < d.length;
        i += 4
    ) {

        sum +=
            (
                d[i] +
                d[i + 1] +
                d[i + 2]
            ) / 3;


        count++;

    }


    return sum /
        count;

}



function estimateSharpness(
    image,
    width,
    height
) {

    const d =
        image.data;


    let score =
        0;


    let count =
        0;


    for (
        let y = 1;
        y < height - 1;
        y += 2
    ) {

        for (
            let x = 1;
            x < width - 1;
            x += 2
        ) {

            const p =
                (
                    y *
                    width +
                    x
                ) * 4;


            const p2 =
                (
                    y *
                    width +
                    x + 1
                ) * 4;


            const a =
                (
                    d[p] +
                    d[p + 1] +
                    d[p + 2]
                ) / 3;


            const b =
                (
                    d[p2] +
                    d[p2 + 1] +
                    d[p2 + 2]
                ) / 3;


            score +=
                Math.abs(
                    a - b
                );


            count++;

        }

    }


    return score /
        count;

}



function frameSignature(
    image
) {

    const d =
        image.data;


    let sum =
        0;


    let count =
        0;


    for (
        let i = 0;
        i < d.length;
        i += 120
    ) {

        sum +=
            d[i] +
            d[i + 1] +
            d[i + 2];


        count++;

    }


    return sum /
        count /
        3;

}



/* =========================================================
   PROGRESS
========================================================= */


function updateProgress() {

    const count =
        state.side
        ? state.captures[
            state.side
        ].length
        : 0;


    const percentage =
        Math.min(

            100,

            Math.round(

                count /

                TARGET_FRAMES *

                100

            )

        );


    frameCounter.textContent =

        `${count} / ${TARGET_FRAMES}`;


    coverageValue.textContent =

        `${percentage}%`;


    coverageFill.style.width =

        `${percentage}%`;



    if (
        count < 10
    ) {

        scanDirection.textContent =
            "MOVE SLOWLY TO THE SIDE";

    }


    else if (
        count < 20
    ) {

        scanDirection.textContent =
            "MOVE SLIGHTLY ABOVE";

    }


    else if (
        count < 30
    ) {

        scanDirection.textContent =
            "MOVE TOWARDS THE REAR";

    }


    else if (
        count < 40
    ) {

        scanDirection.textContent =
            "MOVE SLIGHTLY BELOW";

    }


    else {

        scanDirection.textContent =
            "RETURN TOWARDS FRONT";

    }

}



/* =========================================================
   THUMBNAIL
========================================================= */


function addThumbnail(
    blob
) {

    const wrapper =
        document.createElement(
            "div"
        );


    wrapper.className =
        "thumbnail";


    const image =
        document.createElement(
            "img"
        );


    image.src =
        URL.createObjectURL(
            blob
        );


    wrapper.appendChild(
        image
    );


    thumbnailStrip.appendChild(
        wrapper
    );

}



/* =========================================================
   COMPLETE SIDE
========================================================= */


function finishEar() {

    stopCapture();


    stopCamera();


    document
        .getElementById(
            "earCompleteTitle"
        )
        .textContent =

        state.side ===
        "left"

        ? "Left ear complete."

        : "Right ear complete.";


    showScreen(
        "earCompleteScreen"
    );

}



function oppositeEar() {

    return state.side ===
        "left"

        ? "right"

        : "left";

}



/* =========================================================
   REVIEW
========================================================= */


function review() {

    document
        .getElementById(
            "leftCount"
        )
        .textContent =

        `${state.captures.left.length} images`;


    document
        .getElementById(
            "rightCount"
        )
        .textContent =

        `${state.captures.right.length} images`;


    showScreen(
        "reviewScreen"
    );

}



/* =========================================================
   STORAGE
========================================================= */


async function uploadFile(
    side,
    index,
    capture
) {

    const filename =
        String(
            index + 1
        )
        .padStart(
            3,
            "0"
        ) +
        ".jpg";


    const path =

        `${state.user.id}/` +
        `${state.scanID}/` +
        `${side}/` +
        filename;


    const {
        error
    } =
        await db
            .storage
            .from(
                "ear-scans"
            )
            .upload(

                path,

                capture.blob,

                {

                    contentType:
                        "image/jpeg",

                    upsert:
                        false

                }

            );


    if (error) {

        throw error;

    }

}



/* =========================================================
   UPLOAD ALL
========================================================= */


async function uploadAll() {

    let done =
        0;


    const total =

        state.captures.left.length +

        state.captures.right.length;


    for (
        const side
        of
        [
            "left",
            "right"
        ]
    ) {

        for (

            let i = 0;

            i <
            state.captures[
                side
            ].length;

            i++

        ) {

            uploadStatus.textContent =

                `Uploading ${done + 1} / ${total}`;


            await uploadFile(

                side,

                i,

                state.captures[
                    side
                ][i]

            );


            done++;

        }

    }

}



/* =========================================================
   MARK DATABASE UPLOADED
========================================================= */


async function markUploaded() {

    const {
        error
    } =
        await db
            .from(
                "ear_scans"
            )
            .update({

                status:
                    "uploaded",

                left_image_count:
                    state.captures.left.length,

                right_image_count:
                    state.captures.right.length,

                updated_at:
                    new Date()
                        .toISOString()

            })
            .eq(
                "id",
                state.scanID
            );


    if (error) {

        throw error;

    }

}



/* =========================================================
   SAVE
========================================================= */


async function saveScan() {

    const button =
        document.getElementById(
            "uploadButton"
        );


    button.disabled =
        true;


    try {

        uploadStatus.textContent =
            "Uploading source images...";


        await uploadAll();


        uploadStatus.textContent =
            "Creating reconstruction job...";


        await markUploaded();


        showScreen(
            "successScreen"
        );

    }


    catch (
        error
    ) {

        console.error(
            error
        );


        uploadStatus.textContent =
            "Upload failed. Please try again.";


        button.disabled =
            false;

    }

}



/* =========================================================
   EVENTS
========================================================= */


document
    .getElementById(
        "beginButton"
    )
    .onclick =
    async () => {

        try {

            await createScan();


            showScreen(
                "prepScreen"
            );

        }

        catch (
            error
        ) {

            alert(
                "Unable to create scan."
            );

        }

    };



document
    .getElementById(
        "prepContinueButton"
    )
    .onclick =
    () =>
        showScreen(
            "selectionScreen"
        );



document
    .querySelectorAll(
        ".ear-option"
    )
    .forEach(
        button => {

            button.onclick =
                async () => {

                    await beginEar(
                        button.dataset.side
                    );

                };

        }
    );



document
    .getElementById(
        "startContinuousScanButton"
    )
    .onclick =
        startCapture;



document
    .getElementById(
        "cancelScanButton"
    )
    .onclick =
    () => {

        stopCamera();


        showScreen(
            "selectionScreen"
        );

    };



document
    .getElementById(
        "scanOtherEarButton"
    )
    .onclick =
    async () => {

        const next =
            oppositeEar();


        if (
            state.captures[
                next
            ].length
        ) {

            review();

            return;

        }


        await beginEar(
            next
        );

    };



document
    .getElementById(
        "consentCheckbox"
    )
    .onchange =
    event => {

        document
            .getElementById(
                "uploadButton"
            )
            .disabled =
            !event.target.checked;

    };



document
    .getElementById(
        "uploadButton"
    )
    .onclick =
        saveScan;



/* =========================================================
   INITIALISE
========================================================= */


async function initialise() {

    state.user =
        await requireUser();


    if (!state.user) {
        return;
    }


    document
        .getElementById(
            "scanUserEmail"
        )
        .textContent =
        state.user.email;

}


initialise();


window.addEventListener(
    "beforeunload",
    stopCamera
);