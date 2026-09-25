import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        const clientId = Deno.env.get("PAYPAL_CLIENT_ID");
        const clientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET");
        const paypalBaseUrl = Deno.env.get("PAYPAL_BASE_URL") || "https://api-m.sandbox.paypal.com";
        if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret) {
            throw new Error("Server configuration is incomplete.");
        }

        const admin = createClient(supabaseUrl, serviceRoleKey);
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) return json({ error: "Authentication required." }, 401);
        const { data: userData, error: userError } = await admin.auth.getUser(
            authHeader.replace(/^Bearer\s+/i, ""),
        );
        if (userError || !userData.user) return json({ error: "Invalid login session." }, 401);
        const user = userData.user;
        const body = await req.json();
        if (typeof body.order_id !== "string" || !body.order_id) {
            return json({ error: "Order ID is required." }, 400);
        }

        // Explicit migration fields fail before charging if the database has
        // not yet been upgraded for atomic payment finalization.
        const { data: order, error: orderError } = await admin.from("orders")
            .select("id, order_number, user_id, total, currency, payment_status, paypal_order_id, stock_review_required, stock_deducted_at")
            .eq("id", body.order_id).eq("user_id", user.id).single();
        if (orderError || !order) throw new Error("Unable to load this order for payment.");
        if (order.payment_status === "paid") {
            return json({
                success: true, already_paid: true, order_id: order.id,
                order_number: order.order_number, payment_status: "paid",
                stock_review_required: order.stock_review_required,
            });
        }
        if (!order.paypal_order_id) throw new Error("PayPal order ID is missing.");

        const tokenResponse = await fetch(`${paypalBaseUrl}/v1/oauth2/token`, {
            method: "POST",
            headers: {
                Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: "grant_type=client_credentials",
        });
        const token = await tokenResponse.json();
        if (!tokenResponse.ok || !token.access_token) throw new Error("PayPal authentication failed.");

        const paypalOrderUrl = `${paypalBaseUrl}/v2/checkout/orders/${encodeURIComponent(order.paypal_order_id)}`;
        const headers = {
            Authorization: `Bearer ${token.access_token}`,
            "Content-Type": "application/json",
        };
        async function readPaypalOrder() {
            const response = await fetch(paypalOrderUrl, { headers });
            if (!response.ok) throw new Error("Unable to verify the PayPal payment. Please retry.");
            return await response.json();
        }

        // Recover captures that succeeded before a network/database failure,
        // even after PayPal's request-id retention window has expired.
        let capture = await readPaypalOrder();
        if (capture.status !== "COMPLETED") {
            try {
                const response = await fetch(`${paypalOrderUrl}/capture`, {
                    method: "POST",
                    headers: {
                        ...headers,
                        Prefer: "return=representation",
                        "PayPal-Request-Id": `capture-${order.id}`,
                    },
                    body: "{}",
                });
                if (!response.ok) throw new Error("PayPal capture failed.");
                capture = await response.json();
            } catch (error) {
                // Another return request may already have completed the capture.
                capture = await readPaypalOrder();
                if (capture.status !== "COMPLETED") throw error;
            }
        }

        const captureObject = capture.purchase_units?.[0]?.payments?.captures?.[0];
        if (capture.status !== "COMPLETED" || captureObject?.status !== "COMPLETED") {
            return json({ error: "PayPal has not completed this payment yet. Please retry shortly." }, 409);
        }
        const paidAmount = Number(captureObject.amount?.value);
        const paidCurrency = captureObject.amount?.currency_code;
        if (!captureObject.id || !Number.isFinite(paidAmount) || paidAmount !== Number(order.total)
            || paidCurrency !== order.currency) {
            throw new Error("PayPal payment does not match this order. Please contact Hammer Craft.");
        }

        const { data: result, error: finalizeError } = await admin.rpc("finalize_paypal_order", {
            p_order_id: order.id,
            p_user_id: user.id,
            p_paypal_order_id: order.paypal_order_id,
            p_capture_id: captureObject.id,
            p_amount: paidAmount,
            p_currency: paidCurrency,
        });
        if (finalizeError || !result?.success) {
            console.error("Unable to record completed PayPal payment", order.id, finalizeError);
            return json({
                error: "PayPal received your payment, but we could not update your order. Retry payment confirmation; do not place a new order.",
                retryable: true,
            }, 503);
        }
        if (result.stock_review_required) {
            console.warn("Paid order needs stock review", order.id);
        }
        return json(result);
    } catch (error) {
        console.error(error);
        return json({ error: error instanceof Error ? error.message : "Unable to confirm payment. Please retry." }, 400);
    }
});
