import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: Request) {
  try {
    const { sessionId, durationSeconds, transcript } = await req.json();

    if (!sessionId) {
      return NextResponse.json(
        { error: "Missing sessionId" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("sessions")
      .update({
        ended_at: new Date().toISOString(),
        duration_seconds: durationSeconds || 0,
        transcript: transcript || "",
      })
      .eq("id", sessionId);

    if (error) {
      console.error("[Session End Error]", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Session End Unexpected Error]", error);
    return NextResponse.json(
      { error: "Failed to end session tracking" },
      { status: 500 }
    );
  }
}