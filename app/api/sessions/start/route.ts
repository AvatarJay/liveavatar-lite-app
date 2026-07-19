import { NextResponse } from "next/server";

import { convertCreatorOutreach } from "@/lib/growth/convert-creator-outreach";
import { supabase } from "@/lib/supabase";

export async function POST(req: Request) {
  try {
    const { sponsorName, customerEmail } =
      await req.json();

    const normalizedEmail =
      typeof customerEmail === "string"
        ? customerEmail.trim().toLowerCase()
        : null;

    const { data, error } = await supabase
      .from("sessions")
      .insert({
        sponsor_name: sponsorName || null,
        customer_email: normalizedEmail,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[Session Start Error]", error);

      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    let outreachConversion = null;

    if (normalizedEmail) {
      try {
        outreachConversion =
          await convertCreatorOutreach({
            email: normalizedEmail,
            reason: "first_session_started",
            sourceId: data.id,
          });
      } catch (conversionError) {
        /*
         * A Growth Engine error must not prevent a customer from
         * starting Chef-iT. The next session can retry idempotently.
         */
        console.error(
          "[Session Start Outreach Conversion Error]",
          conversionError
        );
      }
    }

    return NextResponse.json({
      sessionId: data.id,
      outreachConversion,
    });
  } catch (error) {
    console.error(
      "[Session Start Unexpected Error]",
      error
    );

    return NextResponse.json(
      { error: "Failed to start session tracking" },
      { status: 500 }
    );
  }
}
