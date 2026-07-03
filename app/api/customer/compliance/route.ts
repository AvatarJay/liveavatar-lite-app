import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.chasingtheflames.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(req: Request) {
  try {
    const { email, action } = await req.json();

    if (!email) {
      return NextResponse.json(
        { error: "Missing email" },
        { status: 400, headers: corsHeaders }
      );
    }

    if (action === "accept") {
      const now = new Date().toISOString();

      const { error } = await supabase
        .from("customer_relationships")
        .upsert(
          {
            customer_email: email,
            age_verified_at: now,
            terms_accepted_at: now,
            updated_at: now,
          },
          { onConflict: "customer_email" }
        );

      if (error) {
        return NextResponse.json(
          { error: error.message },
          { status: 500, headers: corsHeaders }
        );
      }

      return NextResponse.json({ verified: true }, { headers: corsHeaders });
    }

    const { data, error } = await supabase
      .from("customer_relationships")
      .select("age_verified_at, terms_accepted_at")
      .eq("customer_email", email)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      {
        verified: Boolean(data?.age_verified_at && data?.terms_accepted_at),
      },
      { headers: corsHeaders }
    );
  } catch {
    return NextResponse.json(
      { error: "Compliance check failed" },
      { status: 500, headers: corsHeaders }
    );
  }
}