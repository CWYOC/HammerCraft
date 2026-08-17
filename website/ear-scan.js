/* ======================================================
   CONFIGURATION
====================================================== */

const DOMAIN =
    "https://www.hammer-craft.co.uk";


/* ======================================================
   ELEMENTS
====================================================== */

const screens = {

    intro:
        document.getElementById("intro"),

    prep:
        document.getElementById("prep"),

    left:
        document.getElementById("left"),

    right:
        document.getElementById("right"),

    complete:
        document.getElementById("complete")

};



/* ======================================================
   SCREEN NAVIGATION
====================================================== */

function showScreen(name) {

    Object
        .values(screens)
        .forEach(screen => {

            screen
                .classList
                .add("hidden");

        });


    screens[name]
        .classList
        .remove("hidden");


    window.scrollTo({

        top: 0,

        behavior: "smooth"

    });

}



/* ======================================================
   SESSION
====================================================== */

function getSessionID() {

    let session =
        localStorage.getItem(
            "hammer-craft-scan-session"
        );


    if (!session) {

        if (crypto.randomUUID) {

            session =
                crypto.randomUUID();

        }

        else {

            session =
                "HC-" +
                Date.now();

        }


        localStorage.setItem(

            "hammer-craft-scan-session",

            session

        );

    }


    return session;

}



/* ======================================================
   DEVICE
====================================================== */

function checkDevice() {

    const title =
        document.getElementById(
            "deviceTitle"
        );


    const text =
        document.getElementById(
            "deviceText"
        );


    const apple =
        /iPhone|iPad|iPod/i
            .test(
                navigator.userAgent
            );


    if (apple) {

        title.textContent =
            "Apple mobile device detected";


        text.textContent =
            "The Hammer Craft Scanner will confirm LiDAR support before scanning.";

    }

    else {

        title.textContent =
            "LiDAR scanner requires a supported iPhone or iPad";


        text.textContent =
            "You can view the instructions here, but scanning must be completed on a supported Apple device.";

    }

}



/* ======================================================
   UNIVERSAL LINK
====================================================== */

function scannerURL(side) {

    const session =
        encodeURIComponent(
            getSessionID()
        );


    return (
        DOMAIN +
        "/ear-scan/native" +
        "?side=" +
        side +
        "&session=" +
        session
    );

}



function launchScanner(side) {

    window.location.href =
        scannerURL(side);

}



/* ======================================================
   RETURN FROM APP
====================================================== */

function processAppReturn() {

    const params =
        new URLSearchParams(
            window.location.search
        );


    const returned =
        params.get("return");


    const side =
        params.get("side");


    if (
        returned !== "1"
    ) {

        return;

    }


    if (
        side === "left"
    ) {

        localStorage.setItem(
            "hammer-craft-left",
            "complete"
        );


        showScreen(
            "right"
        );

    }


    if (
        side === "right"
    ) {

        localStorage.setItem(
            "hammer-craft-right",
            "complete"
        );


        showScreen(
            "complete"
        );

    }


    history.replaceState(

        {},

        "",

        "ear-scan.html"

    );

}



/* ======================================================
   BUTTONS
====================================================== */

document
    .getElementById(
        "beginButton"
    )
    .addEventListener(
        "click",
        () => {

            showScreen(
                "prep"
            );

        }
    );



document
    .getElementById(
        "readyButton"
    )
    .addEventListener(
        "click",
        () => {

            showScreen(
                "left"
            );

        }
    );



document
    .getElementById(
        "leftButton"
    )
    .addEventListener(
        "click",
        () => {

            launchScanner(
                "left"
            );

        }
    );



document
    .getElementById(
        "rightButton"
    )
    .addEventListener(
        "click",
        () => {

            launchScanner(
                "right"
            );

        }
    );



/* ======================================================
   INIT
====================================================== */

checkDevice();

processAppReturn();