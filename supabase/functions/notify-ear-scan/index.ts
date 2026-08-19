import { createClient } from
    "https://esm.sh/@supabase/supabase-js@2";


const corsHeaders = {
    "Access-Control-Allow-Origin":
        "https://www.hammer-craft.co.uk",

    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",

    "Access-Control-Allow-Methods":
        "POST, OPTIONS"
};


Deno.serve(async (req) => {

    if (req.method === "OPTIONS") {

        return new Response(
            "ok",
            {
                headers: corsHeaders
            }
        );

    }


    try {

        /* =================================================
           ENVIRONMENT
        ================================================= */

        const supabaseUrl =
            Deno.env.get(
                "SUPABASE_URL"
            );


        const serviceRoleKey =
            Deno.env.get(
                "SUPABASE_SERVICE_ROLE_KEY"
            );


        const resendApiKey =
            Deno.env.get(
                "RESEND_API_KEY"
            );


        if (
            !supabaseUrl ||
            !serviceRoleKey ||
            !resendApiKey
        ) {

            throw new Error(
                "Missing server configuration."
            );

        }



        /* =================================================
           VERIFY CUSTOMER
        ================================================= */

        const authHeader =
            req.headers.get(
                "Authorization"
            );


        if (!authHeader) {

            return new Response(
                JSON.stringify({
                    error:
                        "Missing authorization."
                }),
                {
                    status: 401,
                    headers: {
                        ...corsHeaders,
                        "Content-Type":
                            "application/json"
                    }
                }
            );

        }


        const userClient =
            createClient(

                supabaseUrl,

                Deno.env.get(
                    "SUPABASE_ANON_KEY"
                )!,

                {
                    global: {
                        headers: {
                            Authorization:
                                authHeader
                        }
                    }
                }

            );


        const {
            data: userData,
            error: userError
        } =
            await userClient
                .auth
                .getUser();


        if (
            userError ||
            !userData.user
        ) {

            return new Response(
                JSON.stringify({
                    error:
                        "Invalid login."
                }),
                {
                    status: 401,
                    headers: {
                        ...corsHeaders,
                        "Content-Type":
                            "application/json"
                    }
                }
            );

        }


        const user =
            userData.user;



        /* =================================================
           REQUEST
        ================================================= */

        const {
            scanID
        } =
            await req.json();


        if (!scanID) {

            return new Response(
                JSON.stringify({
                    error:
                        "Missing scanID."
                }),
                {
                    status: 400,
                    headers: {
                        ...corsHeaders,
                        "Content-Type":
                            "application/json"
                    }
                }
            );

        }



        /* =================================================
           ADMIN SUPABASE CLIENT
        ================================================= */

        const admin =
            createClient(
                supabaseUrl,
                serviceRoleKey
            );



        /* =================================================
           GET PROFILE
        ================================================= */

        const {
            data: profile
        } =
            await admin
                .from(
                    "profiles"
                )
                .select(
                    "full_name, email"
                )
                .eq(
                    "id",
                    user.id
                )
                .maybeSingle();



        /* =================================================
           VERIFY SCAN BELONGS TO CUSTOMER
        ================================================= */

        const {
            data: scan,
            error: scanError
        } =
            await admin
                .from(
                    "ear_scans"
                )
                .select(
                    `
                    id,
                    user_id,
                    status,
                    left_image_count,
                    right_image_count,
                    created_at
                    `
                )
                .eq(
                    "id",
                    scanID
                )
                .eq(
                    "user_id",
                    user.id
                )
                .single();


        if (
            scanError ||
            !scan
        ) {

            return new Response(
                JSON.stringify({
                    error:
                        "Scan was not found."
                }),
                {
                    status: 404,
                    headers: {
                        ...corsHeaders,
                        "Content-Type":
                            "application/json"
                    }
                }
            );

        }



        /* =================================================
           STORAGE PATH
        ================================================= */

        const root =

            `${user.id}/` +
            `${scan.id}`;



        /* =================================================
           LIST LEFT FILES
        ================================================= */

        const {
            data: leftFiles,
            error: leftError
        } =
            await admin
                .storage
                .from(
                    "ear-scans"
                )
                .list(
                    `${root}/left`,
                    {
                        limit: 200,
                        sortBy: {
                            column: "name",
                            order: "asc"
                        }
                    }
                );


        if (leftError) {

            throw leftError;

        }



        /* =================================================
           LIST RIGHT FILES
        ================================================= */

        const {
            data: rightFiles,
            error: rightError
        } =
            await admin
                .storage
                .from(
                    "ear-scans"
                )
                .list(
                    `${root}/right`,
                    {
                        limit: 200,
                        sortBy: {
                            column: "name",
                            order: "asc"
                        }
                    }
                );


        if (rightError) {

            throw rightError;

        }



        /* =================================================
           CREATE SIGNED LINKS
           24 HOURS
        ================================================= */

        const expiresIn =
            60 * 60 * 24;


        async function signedLinks(
            side: string,
            files: any[]
        ) {

            const links = [];


            for (
                const file
                of files || []
            ) {

                const path =

                    `${root}/` +
                    `${side}/` +
                    `${file.name}`;


                const {
                    data,
                    error
                } =
                    await admin
                        .storage
                        .from(
                            "ear-scans"
                        )
                        .createSignedUrl(
                            path,
                            expiresIn
                        );


                if (
                    !error &&
                    data?.signedUrl
                ) {

                    links.push({

                        name:
                            file.name,

                        url:
                            data.signedUrl

                    });

                }

            }


            return links;

        }


        const leftLinks =
            await signedLinks(
                "left",
                leftFiles || []
            );


        const rightLinks =
            await signedLinks(
                "right",
                rightFiles || []
            );


        /*
            Signed URLs allow temporary access
            without making the bucket public.
        */



        /* =================================================
           HTML FOR EMAIL
        ================================================= */

        function linksHTML(
            title: string,
            links: any[]
        ) {

            const rows =
                links
                    .map(
                        item => `

                            <li
                                style="
                                    margin-bottom:8px;
                                "
                            >

                                <a
                                    href="${item.url}"
                                >
                                    ${item.name}
                                </a>

                            </li>

                        `
                    )
                    .join("");


            return `

                <h3>
                    ${title}
                </h3>

                <ul>
                    ${rows}
                </ul>

            `;

        }



        const customerName =
            profile?.full_name ||
            "Customer";


        const customerEmail =
            profile?.email ||
            user.email ||
            "Unknown";



        const emailHtml = `

            <div
                style="
                    font-family:
                        Arial,
                        sans-serif;

                    max-width:
                        700px;

                    margin:
                        auto;
                "
            >

                <h1>
                    New Hammer Craft Ear Scan
                </h1>


                <p>
                    A customer has completed
                    a digital ear scan.
                </p>


                <hr>


                <h3>
                    Customer
                </h3>


                <p>

                    <strong>
                        Name:
                    </strong>

                    ${customerName}

                </p>


                <p>

                    <strong>
                        Email:
                    </strong>

                    ${customerEmail}

                </p>


                <p>

                    <strong>
                        User ID:
                    </strong>

                    ${user.id}

                </p>


                <p>

                    <strong>
                        Scan ID:
                    </strong>

                    ${scan.id}

                </p>


                <p>

                    <strong>
                        Status:
                    </strong>

                    ${scan.status}

                </p>


                <p>

                    <strong>
                        Left images:
                    </strong>

                    ${scan.left_image_count}

                </p>


                <p>

                    <strong>
                        Right images:
                    </strong>

                    ${scan.right_image_count}

                </p>


                <hr>


                ${linksHTML(
                    "LEFT EAR",
                    leftLinks
                )}


                ${linksHTML(
                    "RIGHT EAR",
                    rightLinks
                )}


                <hr>


                <p
                    style="
                        color:#777;
                        font-size:12px;
                    "
                >

                    These private download links
                    expire after 24 hours.

                </p>

            </div>

        `;



        /* =================================================
           SEND EMAIL
        ================================================= */

        const resendResponse =
            await fetch(
                "https://api.resend.com/emails",
                {

                    method:
                        "POST",

                    headers: {

                        "Authorization":
                            `Bearer ${resendApiKey}`,

                        "Content-Type":
                            "application/json"

                    },

                    body:
                        JSON.stringify({

                            /*
                               Change this after you
                               verify your domain.
                            */

                            from:
                                "Hammer Craft Scanner <scans@hammer-craft.co.uk>",


                            to: [
                                "waiyin.hammercraft@gmail.com"
                            ],


                            reply_to:
                                customerEmail,


                            subject:
                                `New Ear Scan — ${customerName}`,


                            html:
                                emailHtml

                        })

                }
            );


        if (
            !resendResponse.ok
        ) {

            const text =
                await resendResponse
                    .text();


            throw new Error(
                `Email failed: ${text}`
            );

        }



        return new Response(
            JSON.stringify({

                success:
                    true,

                scanID:
                    scan.id,

                leftLinks:
                    leftLinks.length,

                rightLinks:
                    rightLinks.length

            }),
            {

                headers: {

                    ...corsHeaders,

                    "Content-Type":
                        "application/json"

                }

            }
        );

    }


    catch (
        error
    ) {

        console.error(
            error
        );


        return new Response(
            JSON.stringify({

                error:
                    error instanceof Error
                        ? error.message
                        : "Unknown error"

            }),
            {

                status:
                    500,

                headers: {

                    ...corsHeaders,

                    "Content-Type":
                        "application/json"

                }

            }
        );

    }

});