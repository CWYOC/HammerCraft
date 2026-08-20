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


            const SITE_URL =
                Deno.env.get(
                    "SITE_URL"
                )
                ||
                "https://www.hammer-craft.co.uk";


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
               AUTHENTICATED CUSTOMER
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
               LOAD CUSTOMER BASKET
            ============================================= */

            const {
                data: basket,
                error: basketError
            } =
                await admin
                    .from(
                        "basket_items"
                    )
                    .select(`
                        id,
                        product_id,
                        quantity,
                        order_type,
                        custom_fit,
                        custom_tuning
                    `)
                    .eq(
                        "user_id",
                        user.id
                    );


            if (
                basketError
            ) {

                throw basketError;

            }


            if (
                !basket ||
                basket.length ===
                0
            ) {

                throw new Error(
                    "Your basket is empty."
                );

            }



            /* =============================================
               VALIDATE PRODUCTS / CALCULATE SERVER TOTAL
            ============================================= */

            const orderItems: Array<any> =
                [];


            let total =
                0;


            for (
                const basketItem
                of basket
            ) {

                const {
                    data: product,
                    error: productError
                } =
                    await admin
                        .from(
                            "products"
                        )
                        .select("*")
                        .eq(
                            "id",
                            basketItem.product_id
                        )
                        .single();


                if (
                    productError ||
                    !product
                ) {

                    throw new Error(
                        "A product in your basket is no longer available."
                    );

                }


                const quantity =
                    Number(
                        basketItem.quantity
                    );


                if (
                    !Number.isInteger(
                        quantity
                    )
                    ||
                    quantity <
                    1
                ) {

                    throw new Error(
                        `${product.name}: invalid quantity.`
                    );

                }


                const max =
                    Number(
                        product.max_order_quantity ||
                        99
                    );


                if (
                    quantity >
                    max
                ) {

                    throw new Error(
                        `${product.name}: maximum quantity is ${max}.`
                    );

                }



                /* PREORDER */

                if (
                    basketItem.order_type ===
                    "preorder"
                ) {

                    if (
                        product.preorder_enabled !==
                        true
                    ) {

                        throw new Error(
                            `${product.name} is no longer available for preorder.`
                        );

                    }

                }



                /* STANDARD */

                else {

                    if (
                        product.ordering_enabled !==
                        true
                    ) {

                        throw new Error(
                            `${product.name} is not currently orderable.`
                        );

                    }


                    if (
                        Number(
                            product.stock_quantity ||
                            0
                        )
                        <
                        quantity
                    ) {

                        throw new Error(
                            `${product.name} does not have enough stock.`
                        );

                    }

                }



                /* PRICE */

                const unitPrice =
                    Number(
                        product.price_gbp
                    );


                if (
                    !Number.isFinite(
                        unitPrice
                    )
                    ||
                    unitPrice <
                    0
                ) {

                    throw new Error(
                        `${product.name} does not have a valid price.`
                    );

                }


                const lineTotal =
                    Number(
                        (
                            unitPrice *
                            quantity
                        )
                        .toFixed(
                            2
                        )
                    );


                total +=
                    lineTotal;


                orderItems.push({

                    product_id:
                        product.id,

                    product_name:
                        product.name,

                    sku:
                        product.sku ||
                        null,

                    quantity,

                    order_type:
                        basketItem.order_type,

                    unit_price:
                        unitPrice,

                    line_total:
                        lineTotal,

                    custom_fit:
                        Boolean(
                            basketItem.custom_fit
                        )
                        &&
                        Boolean(
                            product.custom_fit_available
                        ),

                    custom_tuning:
                        Boolean(
                            basketItem.custom_tuning
                        )
                        &&
                        Boolean(
                            product.custom_tuning_available
                        )

                });

            }


            total =
                Number(
                    total.toFixed(
                        2
                    )
                );



            /* =============================================
               CREATE HAMMER CRAFT ORDER
            ============================================= */

            const {
                data: order,
                error: orderError
            } =
                await admin
                    .from(
                        "orders"
                    )
                    .insert({

                        user_id:
                            user.id,

                        subtotal:
                            total,

                        total:
                            total,

                        currency:
                            "GBP",

                        status:
                            "pending_payment",

                        payment_status:
                            "unpaid"

                    })
                    .select()
                    .single();


            if (
                orderError
            ) {

                throw orderError;

            }



            /* =============================================
               CREATE ORDER ITEMS SNAPSHOT
            ============================================= */

            const orderItemRows =
                orderItems
                    .map(
                        item => ({

                            ...item,

                            order_id:
                                order.id

                        })
                    );


            const {
                error:
                    orderItemsError
            } =
                await admin
                    .from(
                        "order_items"
                    )
                    .insert(
                        orderItemRows
                    );


            if (
                orderItemsError
            ) {

                await admin
                    .from(
                        "orders"
                    )
                    .delete()
                    .eq(
                        "id",
                        order.id
                    );


                throw orderItemsError;

            }



            /* =============================================
               PAYPAL ACCESS TOKEN
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

                console.error(
                    tokenPayload
                );


                throw new Error(
                    "Unable to authenticate with PayPal."
                );

            }



            /* =============================================
               PAYPAL ORDER
            ============================================= */

            const paypalItems =
                orderItems
                    .map(
                        item => ({

                            name:
                                item.product_name,

                            sku:
                                item.sku ||
                                undefined,

                            quantity:
                                String(
                                    item.quantity
                                ),

                            unit_amount: {

                                currency_code:
                                    "GBP",

                                value:
                                    Number(
                                        item.unit_price
                                    )
                                    .toFixed(
                                        2
                                    )

                            }

                        })
                    );


            const paypalPayload = {

                intent:
                    "CAPTURE",

                purchase_units: [

                    {

                        reference_id:
                            order.id,

                        invoice_id:
                            order.order_number,

                        custom_id:
                            order.order_number,

                        description:
                            `Hammer Craft ${order.order_number}`,

                        amount: {

                            currency_code:
                                "GBP",

                            value:
                                total.toFixed(
                                    2
                                ),

                            breakdown: {

                                item_total: {

                                    currency_code:
                                        "GBP",

                                    value:
                                        total.toFixed(
                                            2
                                        )

                                }

                            }

                        },

                        items:
                            paypalItems

                    }

                ],

                application_context: {

                    brand_name:
                        "Hammer Craft",

                    landing_page:
                        "LOGIN",

                    user_action:
                        "PAY_NOW",

                    return_url:
                        `${SITE_URL}/order.html?payment=return&hc_order=${order.id}`,

                    cancel_url:
                        `${SITE_URL}/basket.html?payment=cancel`

                }

            };


            const paypalResponse =
                await fetch(

                    `${PAYPAL_BASE_URL}/v2/checkout/orders`,

                    {

                        method:
                            "POST",

                        headers: {

                            "Authorization":
                                `Bearer ${tokenPayload.access_token}`,

                            "Content-Type":
                                "application/json",

                            "PayPal-Request-Id":
                                order.id

                        },

                        body:
                            JSON.stringify(
                                paypalPayload
                            )

                    }

                );


            const paypalOrder =
                await paypalResponse
                    .json();


            if (
                !paypalResponse.ok
            ) {

                console.error(
                    paypalOrder
                );


                throw new Error(
                    "PayPal order creation failed."
                );

            }



            /* =============================================
               SAVE PAYPAL ID
            ============================================= */

            const {
                error:
                    paypalUpdateError
            } =
                await admin
                    .from(
                        "orders"
                    )
                    .update({

                        paypal_order_id:
                            paypalOrder.id,

                        updated_at:
                            new Date()
                                .toISOString()

                    })
                    .eq(
                        "id",
                        order.id
                    );


            if (
                paypalUpdateError
            ) {

                throw paypalUpdateError;

            }



            /* =============================================
               APPROVAL LINK
            ============================================= */

            const approval =
                paypalOrder.links
                    ?.find(
                        (
                            link: any
                        ) =>
                            link.rel ===
                            "approve"
                    );


            if (
                !approval
            ) {

                throw new Error(
                    "PayPal approval link was not returned."
                );

            }



            return new Response(

                JSON.stringify({

                    order_id:
                        order.id,

                    order_number:
                        order.order_number,

                    paypal_order_id:
                        paypalOrder.id,

                    approval_url:
                        approval.href

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
                        : "Unknown checkout error."

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