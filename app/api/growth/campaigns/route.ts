import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("growth_campaigns")
      .select(
        `
          id,
          name,
          campaign_code,
          status,
          source_tool,
          hypothesis,
          description,
          targeting_criteria,
          shopify_promo_code,
          daily_send_limit
        `
      )
      .in("status", ["draft", "ready", "active", "paused"])
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Unable to load growth campaigns:", error);

      return NextResponse.json(
        {
          error: "Unable to load campaigns.",
          details: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      campaigns: data ?? [],
    });
  } catch (error) {
    console.error("Campaign endpoint failed:", error);

    return NextResponse.json(
      {
        error: "Unexpected server error.",
        details:
          error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}