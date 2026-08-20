import {
    createClient
} from "npm:@supabase/supabase-js@2";


const corsHeaders = {

    "Access-Control-Allow-Origin":
        "*",

    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",

    "Access-Control-Allow-Methods":
        "POST, OPTIONS"

};



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

            /* =============================================
               ENVIRONMENT
            ============================================= */

            const SUPABASE_URL =
                Deno.env.get(
                    "SUPABASE_URL"
                );


            const SERVICE_ROLE_KEY =
                Deno.env.get(
                    "SUPABASE_SERVICE_ROLE_KEY"
                );


            const PAYPAL_CLIENT_ID =
                Deno.env.get(
                    "PAYPAL_CLIENT_ID"
                );


            const PAYPAL_CLIENT_SECRET =
                Deno.env.get(
                    "PAYPAL_CLIENT_SECRET"
                );


            const PAYPAL_BASE_URL =
                Deno.env.get(
                    "PAYPAL_BASE_URL"
                )
                ||
                "https://api-m.sandbox.paypal.com";


            if (
                !SUPABASE_URL ||
                !SERVICE_ROLE_KEY ||
                !PAYPAL_CLIENT_ID ||
                !PAYPAL_CLIENT_SECRET
            ) {

                throw new Error(
                    "Server configuration is incomplete."
                );

            }


            const admin =
                createClient(
                    SUPABASE_URL,
                    SERVICE_ROLE_KEY
                );



            /* =============================================
               CUSTOMER AUTH
            ============================================= */

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



            /* =============================================
               REQUEST
            ============================================= */

            const body =
                await req.json();


            const orderID =
                body.order_id;


            if (
                !orderID
            ) {

                throw new Error(
                    "Order ID is required."
                );

            }



            /* =============================================
               LOAD HAMMER CRAFT ORDER
            ============================================= */

            const {
                data: order,
                error: orderError
            } =
                await admin
                    .from(
                        "orders"
                    )
                    .select("*")
                    .eq(
                        "id",
                        orderID
                    )
                    .eq(
                        "user_id",
                        user.id
                    )
                    .single();


            if (
                orderError ||
                !order
            ) {

                throw new Error(
                    "Order not found."
                );

            }



            /*
                IDEMPOTENCY:
                if we already marked it paid,
                don't capture it again.
            */

            if (
                order.payment_status ===
                "paid"
            ) {

                return new Response(

                    JSON.stringify({

                        success:
                            true,

                        already_paid:
                            true,

                        order_number:
                            order.order_number

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


            if (
                !order.paypal_order_id
            ) {

                throw new Error(
                    "PayPal order ID is missing."
                );

            }



            /* =============================================
               PAYPAL TOKEN
            ============================================= */

            const basicCredentials =
                btoa(
                    `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`
                );


            const tokenResponse =
                await fetch(

                    `${PAYPAL_BASE_URL}/v1/oauth2/token`,

                    {

                        method:
                            "POST",

                        headers: {

                            "Authorization":
                                `Basic ${basicCredentials}`,

                            "Content-Type":
                                "application/x-www-form-urlencoded"

                        },

                        body:
                            "grant_type=client_credentials"

                    }

                );


            const tokenPayload =
                await tokenResponse
                    .json();


            if (
                !tokenResponse.ok
            ) {

                throw new Error(
                    "PayPal authentication failed."
                );

            }



            /* =============================================
               CAPTURE PAYPAL ORDER
            ============================================= */

            const captureResponse =
                await fetch(

                    `${PAYPAL_BASE_URL}/v2/checkout/orders/${order.paypal_order_id}/capture`,

                    {

                        method:
                            "POST",

                        headers: {

                            "Authorization":
                                `Bearer ${tokenPayload.access_token}`,

                            "Content-Type":
                                "application/json",

                            "PayPal-Request-Id":
                                `capture-${order.id}`

                        },

                        body:
                            "{}"

                    }

                );


            const capture =
                await captureResponse
                    .json();


            if (
                !captureResponse.ok
            ) {

                console.error(
                    capture
                );


                throw new Error(
                    capture?.message ||
                    "PayPal capture failed."
                );

            }


            if (
                capture.status !==
                "COMPLETED"
            ) {

                throw new Error(
                    `Unexpected PayPal status: ${capture.status}`
                );

            }



            /* =============================================
               CAPTURE DETAILS
            ============================================= */

            const captureObject =
                capture
                    .purchase_units?.[0]
                    ?.payments
                    ?.captures?.[0];


            if (
                !captureObject
            ) {

                throw new Error(
                    "PayPal capture data is missing."
                );

            }


            const paidAmount =
                Number(
                    captureObject
                        .amount
                        .value
                );


            const paidCurrency =
                captureObject
                    .amount
                    .currency_code;


            if (
                paidAmount !==
                Number(
                    order.total
                )
            ) {

                throw new Error(
                    "PayPal amount does not match this order."
                );

            }


            if (
                paidCurrency !==
                order.currency
            ) {

                throw new Error(
                    "PayPal currency does not match this order."
                );

            }



            /* =============================================
               LOAD ORDER ITEMS
            ============================================= */

            const {
                data: items,
                error: itemsError
            } =
                await admin
                    .from(
                        "order_items"
                    )
                    .select("*")
                    .eq(
                        "order_id",
                        order.id
                    );


            if (
                itemsError
            ) {

                throw itemsError;

            }



            /* =============================================
               STOCK DEDUCTION
               STANDARD ORDERS ONLY
            ============================================= */

            for (
                const item
                of items ||
                []
            ) {

                if (
                    item.order_type !==
                    "standard"
                ) {

                    continue;
                }


                const {
                    data: product,
                    error: productError
                } =
                    await admin
                        .from(
                            "products"
                        )
                        .select(
                            "stock_quantity"
                        )
                        .eq(
                            "id",
                            item.product_id
                        )
                        .single();


                if (
                    productError ||
                    !product
                ) {

                    throw new Error(
                        `${item.product_name}: product unavailable during stock update.`
                    );

                }


                const stock =
                    Number(
                        product.stock_quantity ||
                        0
                    );


                const quantity =
                    Number(
                        item.quantity
                    );


                if (
                    stock <
                    quantity
                ) {

                    throw new Error(
                        `${item.product_name}: insufficient stock after payment. Manual review required.`
                    );

                }


                const {
                    error:
                        stockUpdateError
                } =
                    await admin
                        .from(
                            "products"
                        )
                        .update({

                            stock_quantity:
                                stock -
                                quantity,

                            updated_at:
                                new Date()
                                    .toISOString()

                        })
                        .eq(
                            "id",
                            item.product_id
                        );


                if (
                    stockUpdateError
                ) {

                    throw stockUpdateError;

                }

            }



            /* =============================================
               MARK ORDER PAID
            ============================================= */

            const now =
                new Date()
                    .toISOString();


            const {
                error:
                    paidUpdateError
            } =
                await admin
                    .from(
                        "orders"
                    )
                    .update({

                        status:
                            "paid",

                        payment_status:
                            "paid",

                        paypal_capture_id:
                            captureObject.id,

                        paid_at:
                            now,

                        updated_at:
                            now

                    })
                    .eq(
                        "id",
                        order.id
                    );


            if (
                paidUpdateError
            ) {

                throw paidUpdateError;

            }



            /* =============================================
               EMPTY CUSTOMER BASKET
            ============================================= */

            const {
                error:
                    basketDeleteError
            } =
                await admin
                    .from(
                        "basket_items"
                    )
                    .delete()
                    .eq(
                        "user_id",
                        user.id
                    );


            if (
                basketDeleteError
            ) {

                console.warn(
                    "Order paid but basket clear failed:",
                    basketDeleteError
                );

            }



            return new Response(

                JSON.stringify({

                    success:
                        true,

                    order_id:
                        order.id,

                    order_number:
                        order.order_number,

                    payment_status:
                        "paid"

                }),

                {

                    status:
                        200,

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
                        : "Unknown payment error."

                }),

                {

                    status:
                        400,

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