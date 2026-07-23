import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  return NextResponse.json({
    success: true,
    message: "Chef-iT bootstrap reached.",

    // Temporary debugging information.
    // We'll remove most of this after verifying the App Proxy.
    received: {
      shop: searchParams.get("shop"),
      logged_in_customer_id: searchParams.get("logged_in_customer_id"),
      path_prefix: searchParams.get("path_prefix"),
      timestamp: searchParams.get("timestamp"),
      signature_present: Boolean(searchParams.get("signature")),
    },
  });
}