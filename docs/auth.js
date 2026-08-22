/* =========================================================
   HAMMER CRAFT
   SHARED AUTHENTICATION
   auth.js

   One role source for the whole website:
       public.profiles.is_admin
========================================================= */

(function () {

    "use strict";


    function getSupabase() {

        if (!window.hcSupabase) {

            throw new Error(
                "Hammer Craft could not connect to Supabase."
            );

        }

        return window.hcSupabase;

    }


    async function getSession() {

        const {
            data,
            error
        } = await getSupabase()
            .auth
            .getSession();


        if (error) {
            throw error;
        }


        return data.session || null;

    }


    async function getProfile(userId) {

        if (!userId) {
            return null;
        }


        const {
            data,
            error
        } = await getSupabase()
            .from("profiles")
            .select(`
                id,
                email,
                full_name,
                is_admin,
                created_at
            `)
            .eq("id", userId)
            .maybeSingle();


        if (error) {
            throw error;
        }


        return data || null;

    }


    async function ensureProfile(user) {

        if (!user) {
            return null;
        }


        const existing =
            await getProfile(user.id);


        if (existing) {
            return existing;
        }


        const fullName =
            user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            null;


        const {
            data,
            error
        } = await getSupabase()
            .from("profiles")
            .insert({
                id: user.id,
                email: user.email || null,
                full_name: fullName,
                is_admin: false
            })
            .select(`
                id,
                email,
                full_name,
                is_admin,
                created_at
            `)
            .single();


        if (error) {
            throw error;
        }


        return data;

    }


    async function getCurrentState() {

        const session =
            await getSession();


        if (!session?.user) {

            return {
                session: null,
                user: null,
                profile: null,
                isAdmin: false
            };

        }


        const profile =
            await ensureProfile(
                session.user
            );


        return {
            session,
            user: session.user,
            profile,
            isAdmin:
                profile?.is_admin === true
        };

    }


    async function requireLogin() {

        const state =
            await getCurrentState();


        if (!state.user) {

            const current =
                window.location.href;

            window.location.replace(
                `login.html?redirect=${
                    encodeURIComponent(current)
                }`
            );

            return null;

        }


        return state;

    }


    async function requireCustomer() {

        const state =
            await requireLogin();


        if (!state) {
            return null;
        }


        if (state.isAdmin) {

            window.location.replace(
                "admin.html"
            );

            return null;

        }


        return state;

    }


    async function requireAdmin() {

        const state =
            await requireLogin();


        if (!state) {
            return null;
        }


        if (!state.isAdmin) {

            window.location.replace(
                "account.html"
            );

            return null;

        }


        return state;

    }


    async function logout(destination = "login.html") {

        const {
            error
        } = await getSupabase()
            .auth
            .signOut();


        if (error) {
            throw error;
        }


        window.location.replace(
            destination
        );

    }


    function safeRedirectFromQuery() {

        const params =
            new URLSearchParams(
                window.location.search
            );


        const redirect =
            params.get("redirect");


        if (!redirect) {
            return null;
        }


        try {

            const target =
                new URL(
                    redirect,
                    window.location.href
                );


            if (
                target.origin !==
                window.location.origin
            ) {
                return null;
            }


            return target.href;

        }

        catch (error) {
            return null;
        }

    }


    async function routeAfterLogin(user) {

        const profile =
            await ensureProfile(user);


        /* Admin always opens the admin dashboard. */
        if (
            profile?.is_admin === true
        ) {

            window.location.replace(
                "admin.html"
            );

            return;

        }


        /* Only customers use requested return destinations. */
        const redirect =
            safeRedirectFromQuery();


        if (redirect) {

            window.location.replace(
                redirect
            );

            return;

        }


        const storedRedirect =
            sessionStorage.getItem(
                "hc-after-login"
            );


        sessionStorage.removeItem(
            "hc-after-login"
        );


        if (storedRedirect) {

            try {

                const target =
                    new URL(
                        storedRedirect,
                        window.location.href
                    );


                if (
                    target.origin ===
                    window.location.origin
                ) {

                    window.location.replace(
                        target.href
                    );

                    return;

                }

            }

            catch (error) {
                console.warn(
                    "Ignored invalid stored redirect.",
                    error
                );
            }

        }


        window.location.replace(
            "account.html"
        );

    }


    function setFormMessage(
        element,
        text,
        type = ""
    ) {

        if (!element) {
            return;
        }


        element.textContent = text || "";
        element.className = "form-message";


        if (type) {
            element.classList.add(type);
        }

    }


    async function initialiseRegistration() {

        const registerForm =
            document.getElementById(
                "registerForm"
            );


        if (!registerForm) {
            return;
        }


        registerForm.addEventListener(
            "submit",
            async event => {

                event.preventDefault();


                const name =
                    document.getElementById(
                        "registerName"
                    ).value.trim();


                const email =
                    document.getElementById(
                        "registerEmail"
                    ).value.trim();


                const password =
                    document.getElementById(
                        "registerPassword"
                    ).value;


                const confirmation =
                    document.getElementById(
                        "registerPasswordConfirm"
                    ).value;


                const message =
                    document.getElementById(
                        "registerMessage"
                    );


                if (
                    password !== confirmation
                ) {

                    setFormMessage(
                        message,
                        "Passwords do not match.",
                        "error"
                    );

                    return;

                }


                if (
                    password.length < 8
                ) {

                    setFormMessage(
                        message,
                        "Password must contain at least 8 characters.",
                        "error"
                    );

                    return;

                }


                setFormMessage(
                    message,
                    "Creating your account..."
                );


                try {

                    const {
                        data,
                        error
                    } = await getSupabase()
                        .auth
                        .signUp({
                            email,
                            password,
                            options: {
                                data: {
                                    full_name: name
                                },
                                emailRedirectTo:
                                    "https://www.hammer-craft.co.uk/login.html"
                            }
                        });


                    if (error) {
                        throw error;
                    }


                    if (
                        data.user &&
                        data.session
                    ) {

                        await ensureProfile(
                            data.user
                        );


                        await routeAfterLogin(
                            data.user
                        );

                        return;

                    }


                    setFormMessage(
                        message,
                        "Account created. Please check your email to confirm your address.",
                        "success"
                    );

                }

                catch (error) {

                    setFormMessage(
                        message,
                        error.message ||
                        "Unable to create account.",
                        "error"
                    );

                }

            }
        );

    }


    window.HCAuth = {
        getSupabase,
        getSession,
        getProfile,
        ensureProfile,
        getCurrentState,
        requireLogin,
        requireCustomer,
        requireAdmin,
        logout,
        safeRedirectFromQuery,
        routeAfterLogin
    };


    document.addEventListener(
        "DOMContentLoaded",
        initialiseRegistration
    );

})();
