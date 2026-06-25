import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json(
        { error: "Missing email" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("customers")
      .select("email, minutes_balance")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      console.error("[Minutes Check Error]", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const minutes = data?.minutes_balance || 0;

    return NextResponse.json({
      success: true,
      allowed: minutes > 0,
      email,
      minutes,
    });
  } catch (error) {
    console.error("[Minutes Check Route Error]", error);

    return NextResponse.json(
      { error: "Failed to check minutes" },
      { status: 500 }
    );
  }
}