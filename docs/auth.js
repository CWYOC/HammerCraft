/* =========================================================
   HAMMER CRAFT AUTH
========================================================= */


const hcAuth =
    window.hcSupabase;



/* =========================================================
   MESSAGE HELPER
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

        element
            .classList
            .add(
                type
            );

    }

}



/* =========================================================
   GET SESSION
========================================================= */


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
   CHECK ADMIN
========================================================= */


async function isAdmin(
    userID
) {

    const {
        data,
        error
    } =
        await hcAuth
            .from(
                "admin_users"
            )
            .select(
                "user_id"
            )
            .eq(
                "user_id",
                userID
            )
            .maybeSingle();


    if (error) {

        console.error(
            "Admin check error:",
            error
        );

        return false;

    }


    return Boolean(
        data
    );

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
                                "https://www.hammer-craft.co.uk/login.html"

                        }

                    });


            if (error) {

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

                const admin =
                    await isAdmin(
                        data.user.id
                    );


                window.location.href =
                    admin
                    ? "admin.html"
                    : "account.html";


                return;

            }


            setMessage(
                message,
                "Account created. Please check your email to confirm your address.",
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


            if (
                error ||
                !data.user
            ) {

                setMessage(
                    message,
                    error?.message ||
                    "Unable to login.",
                    "error"
                );

                return;

            }


            setMessage(
                message,
                "Checking account..."
            );


            const admin =
                await isAdmin(
                    data.user.id
                );


            /*
                Optional return page.

                If customer was sent to login
                from ear-scan.html, return them
                to that page.

                Admin always goes to admin.html.
            */

            const returnPage =
                sessionStorage.getItem(
                    "hc-after-login"
                );


            sessionStorage.removeItem(
                "hc-after-login"
            );


            if (admin) {

                window.location.replace(
                    "admin.html"
                );

                return;

            }


            if (returnPage) {

                window.location.replace(
                    returnPage
                );

                return;

            }


            window.location.replace(
                "account.html"
            );

        }

    );

}



/* =========================================================
   PASSWORD RESET
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
                    "Sending password reset email..."
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


            window.location.replace(
                "index.html"
            );

        }

    );

}



/* =========================================================
   LOAD CUSTOMER ACCOUNT
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


    /*
        If an admin manually opens account.html,
        send them to admin.html.
    */

    const admin =
        await isAdmin(
            user.id
        );


    if (admin) {

        window.location.replace(
            "admin.html"
        );

        return;

    }


    const {
        data: profile,
        error: profileError
    } =
        await hcAuth
            .from(
                "profiles"
            )
            .select(
                "id,email,full_name,created_at"
            )
            .eq(
                "id",
                user.id
            )
            .maybeSingle();


    if (profileError) {

        console.error(
            profileError
        );

    }


    const nameElement =
        document.getElementById(
            "customerName"
        );


    if (nameElement) {

        nameElement.textContent =
            profile?.full_name ||
            user.user_metadata
                ?.full_name ||
            "Hammer Craft Customer";

    }


    const emailElement =
        document.getElementById(
            "customerEmail"
        );


    if (emailElement) {

        emailElement.textContent =
            user.email;

    }


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


    if (!list) {
        return;
    }


    if (scansError) {

        console.error(
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
                    Create your first digital ear capture.
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
                        ${String(scan.status).toUpperCase()}
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



/* =========================================================
   INITIALISE
========================================================= */


loadAccountPage();