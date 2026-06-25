import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function formatSeconds(totalSeconds: number) {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Missing email" }, { status: 400 });
    }

    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id, email, seconds_balance, minutes_balance")
      .eq("email", email)
      .maybeSingle();

    if (customerError) {
      return NextResponse.json({ error: customerError.message }, { status: 500 });
    }

    const { data: purchases } = await supabase
      .from("purchases")
      .select("shopify_order_id, minutes_purchased, created_at")
      .eq("customer_email", email)
      .order("created_at", { ascending: false })
      .limit(5);

    const { data: transactions } = await supabase
      .from("minute_transactions")
      .select("type, minutes, source, notes, created_at")
      .eq("customer_email", email)
      .order("created_at", { ascending: false })
      .limit(10);

    const secondsBalance = Number(
      customer?.seconds_balance ?? Number(customer?.minutes_balance || 0) * 60
    );

    return NextResponse.json({
      success: true,
      email,
      secondsBalance,
      displayBalance: formatSeconds(secondsBalance),
      purchases: purchases || [],
      transactions: transactions || [],
    });
  } catch (error) {
    console.error("[Wallet API Error]", error);
    return NextResponse.json({ error: "Failed to load wallet" }, { status: 500 });
  }
}