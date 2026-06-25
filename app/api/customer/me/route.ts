import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function GET() {
  const cookieStore = await cookies();

  const email = cookieStore.get("chefit_customer_email")?.value;
  const customerId = cookieStore.get("chefit_shopify_customer_id")?.value;

  if (!email || !customerId) {
    return NextResponse.json(
      { authenticated: false },
      { status: 401 }
    );
  }

  return NextResponse.json({
    authenticated: true,
    email,
    customerId,
  });
}