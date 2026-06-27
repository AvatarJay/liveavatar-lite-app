import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: Request) {
  try {
    const { sponsorName, customerEmail } = await req.json();

    const { data, error } = await supabase
      .from("sessions")
      .insert({
        sponsor_name: sponsorName || null,
        customer_email: customerEmail || null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[Session Start Error]", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ sessionId: data.id });
  } catch (error) {
    console.error("[Session Start Unexpected Error]", error);
    return NextResponse.json(
      { error: "Failed to start session tracking" },
      { status: 500 }
    );
  }
}