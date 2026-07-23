import crypto from "crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function verifyShopifyAppProxySignature(url: URL, secret: string): boolean {
  const providedSignature = url.searchParams.get("signature");

  if (!providedSignature) {
    return false;
  }

  const message = Array.from(url.searchParams.entries())
    .filter(([key]) => key !== "signature")
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([key, value]) => `${key}=${value}`)
    .join("");

  const calculatedSignature = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  const providedBuffer = Buffer.from(providedSignature, "hex");
  const calculatedBuffer = Buffer.from(calculatedSignature, "hex");

  if (providedBuffer.length !== calculatedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, calculatedBuffer);
}

export async function GET(request: Request) {
  const secret = process.env.SHOPIFY_APP_SECRET;

  if (!secret) {
    console.error("SHOPIFY_APP_SECRET is not configured.");

    return NextResponse.json(
      {
        success: false,
        error: "Server configuration error.",
      },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const signatureValid = verifyShopifyAppProxySignature(url, secret);

  if (!signatureValid) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid Shopify proxy signature.",
      },
      { status: 401 }
    );
  }

  const shop = url.searchParams.get("shop");
  const loggedInCustomerId = url.searchParams.get(
    "logged_in_customer_id"
  );
  const pathPrefix = url.searchParams.get("path_prefix");
  const timestamp = url.searchParams.get("timestamp");

  if (!loggedInCustomerId) {
    return NextResponse.json(
      {
        success: false,
        error: "Customer login required.",
      },
      { status: 401 }
    );
  }

  return NextResponse.json({
    success: true,
    message: "Shopify App Proxy signature verified.",
    authenticated: true,
    received: {
      shop,
      logged_in_customer_id: loggedInCustomerId,
      path_prefix: pathPrefix,
      timestamp,
    },
  });
}