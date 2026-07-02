import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.chasingtheflames.com",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email");

  if (!email) {
    return NextResponse.json(
      { error: "Missing email" },
      {
        status: 400,
        headers: corsHeaders,
      }
    );
  }

  // Get customer
  const { data: customer, error } = await supabase
    .from("customers")
    .select("email, seconds_balance, minutes_balance")
    .eq("email", email)
    .single();

  if (error || !customer) {
    return NextResponse.json(
      { error: "Customer not found" },
      {
        status: 404,
        headers: corsHeaders,
      }
    );
  }

  // Get recent purchases
  const { data: purchases } = await supabase
    .from("purchases")
    .select("shopify_order_id, minutes_purchased, created_at")
    .eq("customer_email", email)
    .order("created_at", { ascending: false })
    .limit(5);

  // Get wallet activity
const { data: walletActivity } = await supabase
  .from("minute_transactions")
  .select("type, source, minutes, notes, created_at")
  .eq("customer_email", email)
  .order("created_at", { ascending: false })
  .limit(5);

// Get recent sessions
const { data: sessions } = await supabase
  .from("sessions")
  .select(`
    id,
    started_at,
    ended_at,
    duration_seconds,
    transcript
  `)
  .eq("customer_email", email)
  .order("started_at", { ascending: false })
  .limit(5);

  const seconds = customer.seconds_balance ?? 0;

  return NextResponse.json(
    {
      customer: {
        name: "",
        email: customer.email,
      },

      wallet: {
        seconds_remaining: seconds,
        minutes_balance: customer.minutes_balance ?? 0,
        display_time: `${Math.floor(seconds / 60)}:${String(
          seconds % 60
        ).padStart(2, "0")}`,
      },

      recentPurchases: purchases ?? [],
      walletActivity: walletActivity ?? [],
      sessions: sessions ?? [],
      membership: "Pay As You Go",
    },
    {
      headers: corsHeaders,
    }
  );
}
