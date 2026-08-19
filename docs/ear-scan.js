/* =====================================================
   HAMMER CRAFT WEB EAR SCANNER
===================================================== */


const API_BASE =
    "https://YOUR-BACKEND-DOMAIN.com";


const CAPTURE_ANGLES = [

    {
        name: "Front view",
        guide: "FRONT VIEW",
        instruction:
            "Position the ear squarely inside the guide."
    },

    {
        name: "Front upper angle",
        guide: "MOVE SLIGHTLY ABOVE",
        instruction:
            "Raise the camera slightly while keeping the ear centred."
    },

    {
        name: "Top angle",
        guide: "CAPTURE FROM ABOVE",
        instruction:
            "Move higher and angle the camera gently downward."
    },

    {
        name: "Rear upper angle",
        guide: "MOVE BEHIND THE EAR",
        instruction:
            "Move slowly towards the rear-upper side of the ear."
    },

    {
        name: "Rear view",
        guide: "REAR ANGLE",
        instruction:
            "Capture the rear side of the outer ear."
    },

    {
        name: "Rear lower angle",
        guide: "MOVE LOWER",
        instruction:
            "Move gradually towards the lower-rear angle."
    },

    {
        name: "Bottom angle",
        guide: "CAPTURE FROM BELOW",
        instruction:
            "Lower the camera and angle it slightly upward."
    },

    {
        name: "Front lower angle",
        guide: "RETURN TO FRONT",
        instruction:
            "Finish with a lower-front view of the ear."
    }

];


const state = {

    stream: null,

    currentSide: null,

    currentIndex: 0,

    captures: {

        left: [],

        right: []

    }

};



/* =====================================================
   ELEMENTS
===================================================== */

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


const cameraTitle =
    document.getElementById(
        "cameraTitle"
    );


const angleTitle =
    document.getElementById(
        "angleTitle"
    );


const angleInstruction =
    document.getElementById(
        "angleInstruction"
    );


const directionGuide =
    document.getElementById(
        "directionGuide"
    );


const captureIndex =
    document.getElementById(
        "captureIndex"
    );


const thumbnailStrip =
    document.getElementById(
        "thumbnailStrip"
    );



/* =====================================================
   SCREEN CONTROL
===================================================== */

function showScreen(id) {

    screens.forEach(screen => {

        screen.classList.remove(
            "active"
        );

    });


    document
        .getElementById(id)
        .classList
        .add(
            "active"
        );


    window.scrollTo({

        top: 0,

        behavior:
            "smooth"

    });

}



/* =====================================================
   CAMERA
===================================================== */

async function startCamera() {

    try {

        state.stream =
            await navigator.mediaDevices
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

    catch (error) {

        console.error(error);


        alert(
            "Camera access is required. Please allow camera permission in your browser settings."
        );


        throw error;

    }

}



function stopCamera() {

    if (!state.stream) {

        return;

    }


    state.stream
        .getTracks()
        .forEach(track => {

            track.stop();

        });


    state.stream =
        null;


    camera.srcObject =
        null;

}



/* =====================================================
   START EAR
===================================================== */

async function beginEar(side) {

    state.currentSide =
        side;


    state.currentIndex =
        0;


    state.captures[side] =
        [];


    cameraTitle.textContent =
        side.toUpperCase() +
        " EAR";


    thumbnailStrip.innerHTML =
        "";


    updateAngleUI();


    showScreen(
        "cameraScreen"
    );


    await startCamera();

}



/* =====================================================
   CAPTURE
===================================================== */

function captureFrame() {

    if (
        !camera.videoWidth ||
        !camera.videoHeight
    ) {

        return;

    }


    canvas.width =
        camera.videoWidth;


    canvas.height =
        camera.videoHeight;


    const context =
        canvas.getContext(
            "2d"
        );


    context.drawImage(

        camera,

        0,
        0,

        canvas.width,
        canvas.height

    );


    canvas.toBlob(

        blob => {

            if (!blob) {

                return;

            }


            const capture = {

                blob,

                angle:
                    CAPTURE_ANGLES[
                        state.currentIndex
                    ].name,

                index:
                    state.currentIndex,

                timestamp:
                    Date.now()

            };


            state
                .captures[
                    state.currentSide
                ]
                .push(
                    capture
                );


            addThumbnail(
                blob
            );


            state.currentIndex +=
                1;


            if (
                state.currentIndex >=
                CAPTURE_ANGLES.length
            ) {

                completeCurrentEar();

            }

            else {

                updateAngleUI();

            }

        },

        "image/jpeg",

        0.94

    );

}



/* =====================================================
   ANGLE UI
===================================================== */

function updateAngleUI() {

    const angle =
        CAPTURE_ANGLES[
            state.currentIndex
        ];


    captureIndex.textContent =
        state.currentIndex + 1;


    angleTitle.textContent =
        angle.name;


    angleInstruction.textContent =
        angle.instruction;


    directionGuide.textContent =
        angle.guide;

}



/* =====================================================
   THUMBNAILS
===================================================== */

function addThumbnail(blob) {

    const url =
        URL.createObjectURL(
            blob
        );


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
        url;


    wrapper.appendChild(
        image
    );


    thumbnailStrip.appendChild(
        wrapper
    );

}



/* =====================================================
   EAR COMPLETE
===================================================== */

function completeCurrentEar() {

    stopCamera();


    document
        .getElementById(
            "earCompleteTitle"
        )
        .textContent =
        state.currentSide ===
            "left"
            ? "Left ear complete."
            : "Right ear complete.";


    showScreen(
        "earCompleteScreen"
    );

}



function otherSide() {

    return state.currentSide ===
        "left"
        ? "right"
        : "left";

}



/* =====================================================
   REVIEW
===================================================== */

function showReview() {

    stopCamera();


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



/* =====================================================
   SESSION
===================================================== */

function getSessionID() {

    let session =
        sessionStorage.getItem(
            "hc-scan-session"
        );


    if (!session) {

        session =
            crypto.randomUUID
                ? crypto.randomUUID()
                : "HC-" +
                  Date.now();


        sessionStorage.setItem(

            "hc-scan-session",

            session

        );

    }


    return session;

}



/* =====================================================
   UPLOAD
===================================================== */

async function uploadCaptures() {

    const uploadButton =
        document.getElementById(
            "uploadButton"
        );


    const status =
        document.getElementById(
            "uploadStatus"
        );


    uploadButton.disabled =
        true;


    status.textContent =
        "Uploading images...";


    try {

        const form =
            new FormData();


        const session =
            getSessionID();


        form.append(
            "session",
            session
        );


        for (
            const side
            of
            ["left", "right"]
        ) {

            state.captures[
                side
            ]
            .forEach(
                (
                    capture,
                    index
                ) => {

                    form.append(

                        `${side}Images`,

                        capture.blob,

                        `${side}-${String(index + 1).padStart(2, "0")}.jpg`

                    );

                }
            );

        }


        const response =
            await fetch(

                `${API_BASE}/api/ear-scans`,

                {

                    method:
                        "POST",

                    body:
                        form

                }

            );


        if (!response.ok) {

            throw new Error(
                "Upload failed"
            );

        }


        status.textContent =
            "Upload complete.";


        showScreen(
            "successScreen"
        );

    }

    catch (error) {

        console.error(error);


        status.textContent =
            "Upload failed. Please try again.";


        uploadButton.disabled =
            false;

    }

}



/* =====================================================
   BUTTON EVENTS
===================================================== */

document
    .getElementById(
        "beginButton"
    )
    .addEventListener(
        "click",
        () => {

            showScreen(
                "prepScreen"
            );

        }
    );



document
    .getElementById(
        "prepContinueButton"
    )
    .addEventListener(
        "click",
        () => {

            showScreen(
                "selectionScreen"
            );

        }
    );



document
    .querySelectorAll(
        ".ear-option"
    )
    .forEach(button => {

        button.addEventListener(
            "click",
            async () => {

                await beginEar(
                    button.dataset.side
                );

            }
        );

    });



document
    .getElementById(
        "captureButton"
    )
    .addEventListener(
        "click",
        captureFrame
    );



document
    .getElementById(
        "cancelScanButton"
    )
    .addEventListener(
        "click",
        () => {

            stopCamera();


            showScreen(
                "selectionScreen"
            );

        }
    );



document
    .getElementById(
        "scanOtherEarButton"
    )
    .addEventListener(
        "click",
        async () => {

            const next =
                otherSide();


            if (
                state.captures[next].length >
                0
            ) {

                showReview();

                return;

            }


            await beginEar(
                next
            );

        }
    );



document
    .getElementById(
        "consentCheckbox"
    )
    .addEventListener(
        "change",
        event => {

            document
                .getElementById(
                    "uploadButton"
                )
                .disabled =
                !event.target.checked;

        }
    );



document
    .getElementById(
        "uploadButton"
    )
    .addEventListener(
        "click",
        uploadCaptures
    );



/* =====================================================
   CLEANUP
===================================================== */

window.addEventListener(
    "beforeunload",
    stopCamera
);