import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://chasing-the-flames.myshopify.com",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email");

  if (!email) {
    return NextResponse.json({ error: "Missing email" }, { status: 400, headers: corsHeaders });
  }

  const { data, error } = await supabase
    .from("customers")
    .select("email, seconds_balance, minutes_balance")
    .eq("email", email)
    .single();

  if (error || !data) {
    return NextResponse.json({
      email,
      seconds_remaining: 0,
      minutes_balance: 0,
      display_time: "0:00",
    }, { headers: corsHeaders });
  }

  const seconds = data.seconds_balance ?? 0;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;

  return NextResponse.json({
    email: data.email,
    seconds_remaining: seconds,
    minutes_balance: data.minutes_balance ?? 0,
    display_time: `${minutes}:${remainder.toString().padStart(2, "0")}`,
  }, { headers: corsHeaders });
}