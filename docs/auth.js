/* =========================================================
   HAMMER CRAFT AUTH
========================================================= */


const hcAuth =
    window.hcSupabase;



/* =========================================================
   HELPERS
========================================================= */


function setMessage(
    element,
    text,
    type = ""
) {

    if (!element) {

        return;

    }


    element.textContent =
        text;


    element.className =
        "form-message";


    if (type) {

        element.classList.add(
            type
        );

    }

}



async function getSession() {

    const {
        data,
        error
    } =
        await hcAuth
            .auth
            .getSession();


    if (error) {

        console.error(
            "Session error:",
            error
        );

        return null;

    }


    return data.session;

}



/* =========================================================
   REGISTER
========================================================= */


const registerForm =
    document.getElementById(
        "registerForm"
    );


if (registerForm) {

    registerForm.addEventListener(
        "submit",

        async event => {

            event.preventDefault();


            const name =
                document
                    .getElementById(
                        "registerName"
                    )
                    .value
                    .trim();


            const email =
                document
                    .getElementById(
                        "registerEmail"
                    )
                    .value
                    .trim();


            const password =
                document
                    .getElementById(
                        "registerPassword"
                    )
                    .value;


            const confirmation =
                document
                    .getElementById(
                        "registerPasswordConfirm"
                    )
                    .value;


            const message =
                document.getElementById(
                    "registerMessage"
                );


            if (
                password !==
                confirmation
            ) {

                setMessage(
                    message,
                    "Passwords do not match.",
                    "error"
                );

                return;

            }


            if (
                password.length < 8
            ) {

                setMessage(
                    message,
                    "Password must contain at least 8 characters.",
                    "error"
                );

                return;

            }


            setMessage(
                message,
                "Creating your account..."
            );


            const {
                data,
                error
            } =
                await hcAuth
                    .auth
                    .signUp({

                        email,

                        password,

                        options: {

                            data: {

                                full_name:
                                    name

                            },


                            emailRedirectTo:
                                "https://www.hammer-craft.co.uk/account.html"

                        }

                    });


            if (error) {

                console.error(
                    error
                );


                setMessage(
                    message,
                    error.message,
                    "error"
                );

                return;

            }


            if (
                data.session
            ) {

                window.location.href =
                    "account.html";

                return;

            }


            setMessage(

                message,

                "Account created. Please check your email and confirm your address before logging in.",

                "success"

            );

        }

    );

}



/* =========================================================
   LOGIN
========================================================= */


const loginForm =
    document.getElementById(
        "loginForm"
    );


if (loginForm) {

    loginForm.addEventListener(
        "submit",

        async event => {

            event.preventDefault();


            const email =
                document
                    .getElementById(
                        "loginEmail"
                    )
                    .value
                    .trim();


            const password =
                document
                    .getElementById(
                        "loginPassword"
                    )
                    .value;


            const message =
                document.getElementById(
                    "loginMessage"
                );


            setMessage(
                message,
                "Logging in..."
            );


            const {
                data,
                error
            } =
                await hcAuth
                    .auth
                    .signInWithPassword({

                        email,

                        password

                    });


            if (error) {

                console.error(
                    error
                );


                setMessage(
                    message,
                    error.message,
                    "error"
                );

                return;

            }


            if (
                !data.session
            ) {

                setMessage(
                    message,
                    "Login was not completed.",
                    "error"
                );

                return;

            }


            window.location.href =
                "account.html";

        }

    );

}



/* =========================================================
   PASSWORD RESET EMAIL
========================================================= */


const forgotPasswordButton =
    document.getElementById(
        "forgotPasswordButton"
    );


if (forgotPasswordButton) {

    forgotPasswordButton
        .addEventListener(
            "click",

            async () => {

                const email =
                    document
                        .getElementById(
                            "loginEmail"
                        )
                        .value
                        .trim();


                const message =
                    document.getElementById(
                        "loginMessage"
                    );


                if (!email) {

                    setMessage(
                        message,
                        "Enter your email address first.",
                        "error"
                    );

                    return;

                }


                setMessage(
                    message,
                    "Sending reset email..."
                );


                const {
                    error
                } =
                    await hcAuth
                        .auth
                        .resetPasswordForEmail(

                            email,

                            {

                                redirectTo:
                                    "https://www.hammer-craft.co.uk/login.html"

                            }

                        );


                if (error) {

                    setMessage(
                        message,
                        error.message,
                        "error"
                    );

                    return;

                }


                setMessage(
                    message,
                    "Password reset email sent.",
                    "success"
                );

            }

        );

}



/* =========================================================
   LOGOUT
========================================================= */


const logoutButton =
    document.getElementById(
        "logoutButton"
    );


if (logoutButton) {

    logoutButton.addEventListener(
        "click",

        async () => {

            await hcAuth
                .auth
                .signOut();


            window.location.href =
                "index.html";

        }

    );

}



/* =========================================================
   ACCOUNT PAGE
========================================================= */


async function loadAccountPage() {

    const accountPage =
        document.querySelector(
            ".account-page"
        );


    if (!accountPage) {

        return;

    }


    const session =
        await getSession();


    if (!session) {

        window.location.replace(
            "login.html"
        );

        return;

    }


    const user =
        session.user;



    /* ===============================
       PROFILE
    =============================== */


    const {
        data: profile,
        error: profileError
    } =
        await hcAuth
            .from(
                "profiles"
            )
            .select(
                "id, email, full_name, created_at"
            )
            .eq(
                "id",
                user.id
            )
            .maybeSingle();


    if (
        profileError
    ) {

        console.error(
            "Profile error:",
            profileError
        );

    }


    document
        .getElementById(
            "customerName"
        )
        .textContent =
        profile?.full_name ||
        user.user_metadata
            ?.full_name ||
        "Hammer Craft Customer";


    document
        .getElementById(
            "customerEmail"
        )
        .textContent =
        user.email;



    /* ===============================
       EAR SCANS
    =============================== */


    const {
        data: scans,
        error: scansError
    } =
        await hcAuth
            .from(
                "ear_scans"
            )
            .select(
                `
                id,
                status,
                left_image_count,
                right_image_count,
                left_stl_path,
                right_stl_path,
                created_at,
                updated_at
                `
            )
            .eq(
                "user_id",
                user.id
            )
            .order(
                "created_at",
                {
                    ascending:
                        false
                }
            );


    const list =
        document.getElementById(
            "scanList"
        );


    if (
        scansError
    ) {

        console.error(
            "Scan history error:",
            scansError
        );


        list.innerHTML = `

            <div class="loading-card">
                Unable to load scan history.
            </div>

        `;


        return;

    }


    if (
        !scans ||
        scans.length === 0
    ) {

        list.innerHTML = `

            <div class="empty-scans">

                <strong>
                    NO EAR SCANS YET
                </strong>

                <p>
                    Create your first digital
                    ear capture.
                </p>

                <a href="ear-scan.html">
                    START EAR SCAN →
                </a>

            </div>

        `;


        return;

    }


    list.innerHTML =
        "";


    scans.forEach(
        scan => {

            const date =
                new Date(
                    scan.created_at
                )
                .toLocaleDateString(
                    "en-GB",
                    {

                        day:
                            "2-digit",

                        month:
                            "short",

                        year:
                            "numeric"

                    }
                );


            const card =
                document.createElement(
                    "article"
                );


            card.className =
                "scan-history-card";


            card.innerHTML = `

                <div class="scan-card-top">

                    <span>
                        ${date}
                    </span>

                    <strong>
                        ${formatStatus(scan.status)}
                    </strong>

                </div>


                <h3>
                    EAR SCAN
                </h3>


                <div class="scan-stats">

                    <div>

                        <span>
                            LEFT
                        </span>

                        <strong>
                            ${scan.left_image_count}
                            IMAGES
                        </strong>

                    </div>


                    <div>

                        <span>
                            RIGHT
                        </span>

                        <strong>
                            ${scan.right_image_count}
                            IMAGES
                        </strong>

                    </div>

                </div>


                <div class="scan-id">

                    ${scan.id}

                </div>

            `;


            list.appendChild(
                card
            );

        }

    );

}



function formatStatus(
    status
) {

    switch (status) {

        case "capturing":

            return "CAPTURING";


        case "uploaded":

            return "UPLOADED";


        case "processing":

            return "PROCESSING";


        case "complete":

            return "COMPLETE";


        case "failed":

            return "NEEDS REVIEW";


        default:

            return String(
                status
            ).toUpperCase();

    }

}



loadAccountPage();