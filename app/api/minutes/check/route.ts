import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function formatSeconds(totalSeconds: number) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Missing email" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("customers")
      .select("email, minutes_balance, seconds_balance")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      console.error("[Minutes Check Error]", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const seconds =
      data?.seconds_balance ??
      Number(data?.minutes_balance || 0) * 60;

    return NextResponse.json({
      success: true,
      allowed: seconds > 0,
      email,
      seconds,
      minutes: Math.floor(seconds / 60),
      display: formatSeconds(seconds),
    });
  } catch (error) {
    console.error("[Minutes Check Route Error]", error);

    return NextResponse.json(
      { error: "Failed to check minutes" },
      { status: 500 }
    );
  }
}