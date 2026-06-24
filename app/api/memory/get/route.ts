import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const { customerEmail, shopifyCustomerId } = await req.json();

    if (!customerEmail && !shopifyCustomerId) {
      return NextResponse.json(
        { error: "Missing customerEmail or shopifyCustomerId" },
        { status: 400 }
      );
    }

    let query = supabase
      .from("user_memories")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    if (shopifyCustomerId) {
      query = query.eq("shopify_customer_id", shopifyCustomerId);
    } else {
      query = query.eq("customer_email", customerEmail);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[Memory Get Error]", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      memories: data || [],
    });
  } catch (error) {
    console.error("[Memory Get Route Error]", error);

    return NextResponse.json(
      { error: "Failed to get memories" },
      { status: 500 }
    );
  }
}