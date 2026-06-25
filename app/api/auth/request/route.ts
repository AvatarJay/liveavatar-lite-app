import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

function createToken(email: string) {
  const secret = process.env.SHOPIFY_CUSTOMER_LINK_SECRET;
  if (!secret) throw new Error("Missing SHOPIFY_CUSTOMER_LINK_SECRET");

  const expires = Date.now() + 15 * 60 * 1000;
  const payload = `${email}:${expires}`;

  const sig = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

export async function POST(req: Request) {
  const { email } = await req.json();

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const token = createToken(email.toLowerCase().trim());

  const loginUrl = `https://liveavatar-lite-app.vercel.app/api/auth/verify?token=${token}`;

  console.log("[Chef-it Auth] Magic login link:", loginUrl);

  return NextResponse.json({
    success: true,
    message: "Login link created.",
    loginUrl,
  });
}