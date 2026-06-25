import { NextResponse } from "next/server";

export async function GET() {
  const res = NextResponse.redirect("http://localhost:3000/wallet");

  res.cookies.set("chefit_customer_email", "jayspangnm@gmail.com", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  res.cookies.set("chefit_shopify_customer_id", "local-test", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  return res;
}