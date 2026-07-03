import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: Request) {
  try {
    const { email, action } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Missing email" }, { status: 400 });
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
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ verified: true });
    }

    const { data, error } = await supabase
      .from("customer_relationships")
      .select("age_verified_at, terms_accepted_at")
      .eq("customer_email", email)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      verified: Boolean(data?.age_verified_at && data?.terms_accepted_at),
    });
  } catch {
    return NextResponse.json(
      { error: "Compliance check failed" },
      { status: 500 }
    );
  }
}