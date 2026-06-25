import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

function signPayload(email: string, customerId: string) {
  return crypto
    .createHmac("sha256", process.env.SHOPIFY_CUSTOMER_LINK_SECRET!)
    .update(`${email}:${customerId}`)
    .digest("hex");
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const email = url.searchParams.get("email") || "";
  const customerId = url.searchParams.get("customerId") || "";
  const sig = url.searchParams.get("sig") || "";

  if (!email || !customerId || !sig) {
    return NextResponse.json({ error: "Missing customer login parameters" }, { status: 400 });
  }

  const expected = signPayload(email, customerId);

  if (sig !== expected) {
    return NextResponse.json({ error: "Invalid customer signature" }, { status: 401 });
  }

  const res = NextResponse.redirect(new URL("/wallet", req.url));

  res.cookies.set("chefit_customer_email", email, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });

  res.cookies.set("chefit_shopify_customer_id", customerId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });

  return res;
}