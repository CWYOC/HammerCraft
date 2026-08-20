import {
    createClient
} from "npm:@supabase/supabase-js@2";


const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods":
        "POST, OPTIONS"
};


function escapeHTML(
    value: unknown
) {
    return String(
        value ?? ""
    )
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


async function sendEmail(
    apiKey: string,
    from: string,
    to: string[],
    subject: string,
    html: string,
    replyTo?: string
) {

    const payload: Record<string, unknown> = {
        from,
        to,
        subject,
        html
    };


    if (
        replyTo
    ) {
        payload.reply_to =
            replyTo;
    }


    const response =
        await fetch(
            "https://api.resend.com/emails",
            {
                method: "POST",

                headers: {
                    "Authorization":
                        `Bearer ${apiKey}`,

                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(
                        payload
                    )
            }
        );


    const result =
        await response.json();


    if (
        !response.ok
    ) {

        console.error(
            "Resend error:",
            result
        );


        throw new Error(
            result?.message ||
            "Unable to send email."
        );
    }


    return result;
}


Deno.serve(
    async (
        req: Request
    ) => {

        if (
            req.method ===
            "OPTIONS"
        ) {

            return new Response(
                "ok",
                {
                    headers:
                        corsHeaders
                }
            );
        }


        try {

            const SUPABASE_URL =
                Deno.env.get(
                    "SUPABASE_URL"
                );


            const SERVICE_ROLE_KEY =
                Deno.env.get(
                    "SUPABASE_SERVICE_ROLE_KEY"
                );


            const RESEND_API_KEY =
                Deno.env.get(
                    "RESEND_API_KEY"
                );


            const EMAIL_FROM =
                Deno.env.get(
                    "EMAIL_FROM"
                );


            const HAMMER_CRAFT_EMAIL =
                Deno.env.get(
                    "HAMMER_CRAFT_EMAIL"
                );


            if (
                !SUPABASE_URL ||
                !SERVICE_ROLE_KEY ||
                !RESEND_API_KEY ||
                !EMAIL_FROM ||
                !HAMMER_CRAFT_EMAIL
            ) {

                throw new Error(
                    "Email server configuration is incomplete."
                );
            }


            const admin =
                createClient(
                    SUPABASE_URL,
                    SERVICE_ROLE_KEY
                );


            /* ==========================================
               AUTHENTICATED USER
            ========================================== */

            const authHeader =
                req.headers.get(
                    "Authorization"
                );


            if (
                !authHeader
            ) {

                throw new Error(
                    "Authentication required."
                );
            }


            const jwt =
                authHeader.replace(
                    /^Bearer\s+/i,
                    ""
                );


            const {
                data: userData,
                error: userError
            } =
                await admin
                    .auth
                    .getUser(
                        jwt
                    );


            if (
                userError ||
                !userData.user
            ) {

                throw new Error(
                    "Invalid login session."
                );
            }


            const user =
                userData.user;


            const body =
                await req.json();


            const orderNumber =
                body.order_number ||
                "HC-TEST-001";


            const total =
                Number(
                    body.total ||
                    0
                );


            const items =
                Array.isArray(
                    body.items
                )
                ? body.items
                : [];


            /* ==========================================
               CUSTOMER PROFILE
            ========================================== */

            let customerName =
                user.user_metadata
                    ?.full_name
                ||
                "Hammer Craft Customer";


            const customerEmail =
                user.email ||
                "";


            const {
                data: profile
            } =
                await admin
                    .from(
                        "profiles"
                    )
                    .select(
                        "full_name"
                    )
                    .eq(
                        "id",
                        user.id
                    )
                    .maybeSingle();


            if (
                profile?.full_name
            ) {

                customerName =
                    profile.full_name;
            }


            /* ==========================================
               CUSTOMER EMAIL
            ========================================== */

            const customerItems =
                items.length
                ? items
                    .map(
                        (item: any) => `
                            <div style="
                                padding:14px 0;
                                border-bottom:1px solid #ddd6cc;
                            ">

                                <strong>
                                    ${escapeHTML(
                                        item.name ||
                                        "Hammer Craft Product"
                                    )}
                                </strong>

                                <div style="
                                    margin-top:5px;
                                    color:#706b64;
                                    font-size:13px;
                                ">

                                    Quantity:
                                    ${
                                        Number(
                                            item.quantity ||
                                            1
                                        )
                                    }

                                </div>

                            </div>
                        `
                    )
                    .join("")
                : `
                    <p style="
                        color:#706b64;
                    ">
                        Order details will appear here
                        once connected to checkout.
                    </p>
                `;


            const customerHTML = `
                <div style="
                    max-width:680px;
                    margin:auto;
                    padding:36px;
                    background:#f2eee7;
                    color:#252321;
                    font-family:Arial,sans-serif;
                ">

                    <div style="
                        color:#9b6739;
                        font-size:11px;
                        font-weight:bold;
                        letter-spacing:2px;
                    ">
                        HAMMER CRAFT / ORDER CONFIRMATION
                    </div>


                    <h1 style="
                        margin-top:18px;
                        font-size:42px;
                    ">
                        Order confirmed.
                    </h1>


                    <p style="
                        margin-top:24px;
                        color:#706b64;
                        line-height:1.7;
                    ">
                        Hi ${escapeHTML(customerName)},
                        <br><br>
                        Thank you for your Hammer Craft order.
                        We have received your order successfully.
                    </p>


                    <div style="
                        margin-top:28px;
                        padding:20px;
                        border:1px solid #cfc7bd;
                    ">

                        <div style="
                            color:#9b6739;
                            font-size:10px;
                            font-weight:bold;
                            letter-spacing:1.5px;
                        ">
                            ORDER NUMBER
                        </div>

                        <div style="
                            margin-top:7px;
                            font-size:24px;
                            font-weight:bold;
                        ">
                            ${escapeHTML(orderNumber)}
                        </div>

                    </div>


                    <div style="
                        margin-top:25px;
                    ">
                        ${customerItems}
                    </div>


                    <div style="
                        margin-top:28px;
                        padding-top:18px;
                        border-top:1px solid #cfc7bd;

                        display:flex;
                        justify-content:space-between;
                    ">

                        <strong>
                            TOTAL
                        </strong>

                        <strong style="
                            font-size:22px;
                        ">
                            £${total.toFixed(2)}
                        </strong>

                    </div>


                    <p style="
                        margin-top:30px;
                        color:#706b64;
                        line-height:1.7;
                    ">
                        We'll contact you when further
                        information is needed for your build.
                    </p>


                    <p style="
                        margin-top:35px;
                        color:#706b64;
                        font-size:12px;
                    ">
                        Hammer Craft<br>
                        Bristol, United Kingdom
                    </p>

                </div>
            `;


            /* ==========================================
               ADMIN EMAIL
            ========================================== */

            const adminHTML = `
                <div style="
                    max-width:700px;
                    margin:auto;
                    font-family:Arial,sans-serif;
                ">

                    <h1>
                        New Hammer Craft Order
                    </h1>


                    <p>
                        A new order has been received.
                    </p>


                    <hr>


                    <p>
                        <strong>Order:</strong>
                        ${escapeHTML(orderNumber)}
                    </p>


                    <p>
                        <strong>Customer:</strong>
                        ${escapeHTML(customerName)}
                    </p>


                    <p>
                        <strong>Email:</strong>
                        ${escapeHTML(customerEmail)}
                    </p>


                    <p>
                        <strong>Total:</strong>
                        £${total.toFixed(2)}
                    </p>


                    <hr>


                    <p style="
                        color:#777;
                        font-size:12px;
                    ">
                        This is currently the Hammer Craft
                        email test / order notification system.
                    </p>

                </div>
            `;


            /* ==========================================
               SEND CUSTOMER EMAIL
            ========================================== */

            if (
                customerEmail
            ) {

                await sendEmail(
                    RESEND_API_KEY,
                    EMAIL_FROM,
                    [
                        customerEmail
                    ],
                    `Order confirmed — ${orderNumber}`,
                    customerHTML
                );
            }


            /* ==========================================
               SEND ADMIN EMAIL
            ========================================== */

            await sendEmail(
                RESEND_API_KEY,
                EMAIL_FROM,
                [
                    HAMMER_CRAFT_EMAIL
                ],
                `New Hammer Craft order — ${orderNumber}`,
                adminHTML,
                customerEmail ||
                undefined
            );


            return new Response(
                JSON.stringify({
                    success: true,
                    customer_email:
                        customerEmail,
                    order_number:
                        orderNumber
                }),

                {
                    status: 200,

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
                        : "Unknown email error."
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
    }
);