import { NextResponse } from "next/server";

export async function GET(request: Request) {
  console.log("Bootstrap URL:", request.url);

  const url = new URL(request.url);

  return NextResponse.json({
    success: true,
    message: "Chef-iT bootstrap reached.",
    received: {
      shop: url.searchParams.get("shop"),
      logged_in_customer_id: url.searchParams.get(
        "logged_in_customer_id"
      ),
      path_prefix: url.searchParams.get("path_prefix"),
      timestamp: url.searchParams.get("timestamp"),
      signature_present: Boolean(
        url.searchParams.get("signature")
      ),
    },
  });
}