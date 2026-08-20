/* =========================================================
   HAMMER CRAFT
   LOGIN SYSTEM
========================================================= */


const loginDB =
    window.hcSupabase;


/* =========================================================
   PAGE ELEMENTS
========================================================= */

const loginForm =
    document.getElementById(
        "loginForm"
    );


const emailInput =
    document.getElementById(
        "email"
    );


const passwordInput =
    document.getElementById(
        "password"
    );


const loginButton =
    document.getElementById(
        "loginButton"
    );


const loginMessage =
    document.getElementById(
        "loginMessage"
    );


/* =========================================================
   START
========================================================= */

async function initialiseLogin() {

    if (
        !loginDB
    ) {

        showLoginMessage(
            "Unable to connect to Hammer Craft.",
            "error"
        );

        return;
    }


    /*
        If already logged in,
        send the user to the appropriate destination.
    */

    const {
        data,
        error
    } =
        await loginDB
            .auth
            .getUser();


    if (
        error
    ) {

        console.warn(
            "Login session check:",
            error
        );

    }


    const user =
        data?.user ||
        null;


    if (
        user
    ) {

        await redirectLoggedInUser(
            user
        );

    }

}



/* =========================================================
   LOGIN
========================================================= */

async function handleLogin(
    event
) {

    event.preventDefault();


    clearLoginMessage();


    const email =
        emailInput
            ?.value
            .trim();


    const password =
        passwordInput
            ?.value;


    if (
        !email
    ) {

        showLoginMessage(
            "Please enter your email address.",
            "error"
        );

        return;
    }


    if (
        !password
    ) {

        showLoginMessage(
            "Please enter your password.",
            "error"
        );

        return;
    }


    setLoginLoading(
        true
    );


    try {

        const {
            data,
            error
        } =
            await loginDB
                .auth
                .signInWithPassword({

                    email:
                        email,

                    password:
                        password

                });


        if (
            error
        ) {

            throw error;

        }


        if (
            !data.user
        ) {

            throw new Error(
                "Login failed."
            );

        }


        showLoginMessage(
            "Login successful.",
            "success"
        );


        await redirectLoggedInUser(
            data.user
        );

    }

    catch (
        error
    ) {

        console.error(
            "Login error:",
            error
        );


        showLoginMessage(
            friendlyLoginError(
                error
            ),
            "error"
        );


        setLoginLoading(
            false
        );

    }

}



/* =========================================================
   REDIRECT
========================================================= */

async function redirectLoggedInUser(
    user
) {

    /*
        First check whether the URL contains:

        login.html?redirect=...

        This is used by:
        - basket
        - order
        - ear scan
        - checkout-related pages

        The redirect takes priority over the
        normal account/admin redirect.
    */

    const redirect =
        getSafeRedirect();


    if (
        redirect
    ) {

        window.location.replace(
            redirect
        );

        return;

    }


    /*
        No explicit redirect.

        Check whether this account is an admin.
    */

    const isAdmin =
        await checkIsAdmin(
            user.id
        );


    if (
        isAdmin
    ) {

        window.location.replace(
            "admin.html"
        );

        return;

    }


    /*
        Normal customer.
    */

    window.location.replace(
        "account.html"
    );

}



/* =========================================================
   SAFE REDIRECT
========================================================= */

function getSafeRedirect() {

    const params =
        new URLSearchParams(
            window.location.search
        );


    const redirect =
        params.get(
            "redirect"
        );


    if (
        !redirect
    ) {

        return null;

    }


    try {

        /*
            Resolve relative and absolute URLs
            against the current website.
        */

        const target =
            new URL(
                redirect,
                window.location.href
            );


        /*
            SECURITY:

            Only allow the same website.

            This prevents something like:

            login.html?redirect=https://evil-site.com
        */

        if (
            target.origin !==
            window.location.origin
        ) {

            console.warn(
                "Blocked external redirect:",
                target.href
            );

            return null;

        }


        return target.href;

    }

    catch (
        error
    ) {

        console.warn(
            "Invalid redirect URL:",
            error
        );


        return null;

    }

}



/* =========================================================
   ADMIN CHECK
========================================================= */

async function checkIsAdmin(
    userID
) {

    try {

        const {
            data,
            error
        } =
            await loginDB
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


        if (
            error
        ) {

            /*
                Do not block normal customers
                if the admin check itself fails.
            */

            console.warn(
                "Admin check failed:",
                error
            );


            return false;

        }


        return Boolean(
            data
        );

    }

    catch (
        error
    ) {

        console.warn(
            "Admin lookup error:",
            error
        );


        return false;

    }

}



/* =========================================================
   FRIENDLY ERROR MESSAGES
========================================================= */

function friendlyLoginError(
    error
) {

    const message =
        String(
            error?.message ||
            ""
        )
        .toLowerCase();


    if (
        message.includes(
            "invalid login credentials"
        )
    ) {

        return "Incorrect email or password.";

    }


    if (
        message.includes(
            "email not confirmed"
        )
    ) {

        return "Please confirm your email address before logging in.";

    }


    if (
        message.includes(
            "too many requests"
        )
        ||
        message.includes(
            "rate limit"
        )
    ) {

        return "Too many login attempts. Please wait and try again.";

    }


    if (
        message.includes(
            "network"
        )
        ||
        message.includes(
            "fetch"
        )
    ) {

        return "Unable to connect. Please check your internet connection.";

    }


    return (
        error?.message ||
        "Unable to log in."
    );

}



/* =========================================================
   LOGIN BUTTON STATE
========================================================= */

function setLoginLoading(
    loading
) {

    if (
        !loginButton
    ) {

        return;

    }


    loginButton.disabled =
        loading;


    loginButton.textContent =
        loading

        ? "LOGGING IN..."

        : "LOGIN →";

}



/* =========================================================
   MESSAGE
========================================================= */

function showLoginMessage(
    message,
    type =
        "normal"
) {

    if (
        !loginMessage
    ) {

        return;

    }


    loginMessage.textContent =
        message;


    loginMessage.classList.remove(
        "error",
        "success"
    );


    if (
        type ===
        "error"
    ) {

        loginMessage.classList.add(
            "error"
        );

    }


    if (
        type ===
        "success"
    ) {

        loginMessage.classList.add(
            "success"
        );

    }

}



function clearLoginMessage() {

    if (
        !loginMessage
    ) {

        return;

    }


    loginMessage.textContent =
        "";


    loginMessage.classList.remove(
        "error",
        "success"
    );

}



/* =========================================================
   ENTER KEY / FORM
========================================================= */

if (
    loginForm
) {

    loginForm.addEventListener(
        "submit",
        handleLogin
    );

}



/* =========================================================
   CLEAR ERROR WHILE USER TYPES
========================================================= */

emailInput
    ?.addEventListener(
        "input",
        clearLoginMessage
    );


passwordInput
    ?.addEventListener(
        "input",
        clearLoginMessage
    );



/* =========================================================
   INITIALISE
========================================================= */

initialiseLogin();