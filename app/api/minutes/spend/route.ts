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

    const { data: customer, error } = await supabase
      .from("customers")
      .select("id, seconds_balance")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    if (!customer) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 }
      );
    }

    const current = Number(customer.seconds_balance || 0);

    const remaining = Math.max(current - 1, 0);

    const { error: updateError } = await supabase
      .from("customers")
      .update({
        seconds_balance: remaining,
        minutes_balance: Math.ceil(remaining / 60),
      })
      .eq("id", customer.id);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      remaining,
      finished: remaining === 0,
    });
  } catch (err) {
    console.error(err);

    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}