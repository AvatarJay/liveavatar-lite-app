import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FIVE_MINUTE_PRODUCT_MINUTES = 5;

function verifyShopifyHmac(rawBody: string, hmacHeader: string | null) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

  if (!secret || !hmacHeader) return false;

  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const digestBuffer = Buffer.from(digest, "base64");
  const hmacBuffer = Buffer.from(hmacHeader, "base64");

  if (digestBuffer.length !== hmacBuffer.length) return false;

  return crypto.timingSafeEqual(digestBuffer, hmacBuffer);
}

function getCustomerEmail(order: any) {
  return (
    order.email ||
    order.customer?.email ||
    order.contact_email ||
    order.billing_address?.email ||
    null
  );
}

function getShopifyCustomerId(order: any) {
  if (!order.customer?.id) return null;
  return String(order.customer.id);
}

function getMinutesPurchased(order: any) {
  const lineItems = order.line_items || [];
  let totalMinutes = 0;

  for (const item of lineItems) {
    const title = `${item.title || ""} ${item.name || ""}`.toLowerCase();
    const quantity = Number(item.quantity || 1);

    if (
      title.includes("5 minute") ||
      title.includes("5-minute") ||
      title.includes("chef-it") ||
      title.includes("chefit")
    ) {
      totalMinutes += FIVE_MINUTE_PRODUCT_MINUTES * quantity;
    }
  }

  return totalMinutes;
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const hmac = req.headers.get("x-shopify-hmac-sha256");

    if (!verifyShopifyHmac(rawBody, hmac)) {
      console.error("[Shopify Webhook] Invalid HMAC");
      return NextResponse.json({ error: "Invalid Shopify HMAC" }, { status: 401 });
    }

    const order = JSON.parse(rawBody);

    const shopifyOrderId = String(order.id);
    const customerEmail = getCustomerEmail(order);
    const shopifyCustomerId = getShopifyCustomerId(order);
    const minutesPurchased = getMinutesPurchased(order);
    const secondsPurchased = minutesPurchased * 60;

    console.log("[Shopify Webhook] Verified order:", shopifyOrderId);
    console.log("[Shopify Webhook] Customer email:", customerEmail);
    console.log("[Shopify Webhook] Shopify customer ID:", shopifyCustomerId);
    console.log("[Shopify Webhook] Minutes purchased:", minutesPurchased);
    console.log("[Shopify Webhook] Seconds purchased:", secondsPurchased);

    if (!customerEmail) {
      return NextResponse.json({ error: "Missing customer email" }, { status: 400 });
    }

    if (secondsPurchased <= 0) {
      console.log("[Shopify Webhook] No Chef-it minutes product found.");
      return NextResponse.json({
        success: true,
        message: "Order verified, no Chef-it minutes product found.",
      });
    }

    const { data: existingPurchase } = await supabase
      .from("purchases")
      .select("id")
      .eq("shopify_order_id", shopifyOrderId)
      .maybeSingle();

    if (existingPurchase) {
      console.log("[Shopify Webhook] Duplicate order ignored:", shopifyOrderId);
      return NextResponse.json({
        success: true,
        message: "Duplicate order ignored.",
      });
    }

    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .upsert(
        {
          email: customerEmail,
          shopify_customer_id: shopifyCustomerId,
        },
        { onConflict: "email" }
      )
      .select()
      .single();

    if (customerError) {
      console.error("[Shopify Webhook] Customer upsert error:", customerError);
      return NextResponse.json({ error: customerError.message }, { status: 500 });
    }

    const currentMinutesBalance = Number(customer.minutes_balance || 0);
    const currentSecondsBalance = Number(
      customer.seconds_balance ?? currentMinutesBalance * 60
    );

    const newMinutesBalance = currentMinutesBalance + minutesPurchased;
    const newSecondsBalance = currentSecondsBalance + secondsPurchased;

    const { error: balanceError } = await supabase
      .from("customers")
      .update({
        minutes_balance: newMinutesBalance,
        seconds_balance: newSecondsBalance,
        shopify_customer_id: shopifyCustomerId,
      })
      .eq("id", customer.id);

    if (balanceError) {
      console.error("[Shopify Webhook] Balance update error:", balanceError);
      return NextResponse.json({ error: balanceError.message }, { status: 500 });
    }

    const { error: purchaseError } = await supabase.from("purchases").insert({
      customer_email: customerEmail,
      shopify_order_id: shopifyOrderId,
      minutes_purchased: minutesPurchased,
    });

    if (purchaseError) {
      console.error("[Shopify Webhook] Purchase insert error:", purchaseError);
      return NextResponse.json({ error: purchaseError.message }, { status: 500 });
    }

    const { error: transactionError } = await supabase
      .from("minute_transactions")
      .insert({
        customer_email: customerEmail,
        customer_id: customer.id,
        type: "credit",
        source: "shopify_order_paid",
        minutes: minutesPurchased,
        notes: `Shopify order ${shopifyOrderId}; credited ${secondsPurchased} seconds`,
      });

    if (transactionError) {
      console.error("[Shopify Webhook] Minute transaction insert error:", transactionError);
      return NextResponse.json({ error: transactionError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      orderId: shopifyOrderId,
      customerEmail,
      shopifyCustomerId,
      minutesPurchased,
      secondsPurchased,
      newMinutesBalance,
      newSecondsBalance,
    });
  } catch (error) {
    console.error("[Shopify Webhook] Unexpected error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}