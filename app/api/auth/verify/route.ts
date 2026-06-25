import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

function verifyToken(token: string) {
  const secret = process.env.SHOPIFY_CUSTOMER_LINK_SECRET;
  if (!secret) throw new Error("Missing SHOPIFY_CUSTOMER_LINK_SECRET");

  const decoded = Buffer.from(token, "base64url").toString("utf8");
  const [email, expiresRaw, sig] = decoded.split(":");

  if (!email || !expiresRaw || !sig) return null;

  const payload = `${email}:${expiresRaw}`;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  if (sig !== expected) return null;

  if (Date.now() > Number(expiresRaw)) return null;

  return { email };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const verified = verifyToken(token);

  if (!verified) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const res = NextResponse.redirect(new URL("/wallet", req.url));

  res.cookies.set("chefit_customer_email", verified.email, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });

  res.cookies.set("chefit_shopify_customer_id", "magic-link", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });

  return res;
}