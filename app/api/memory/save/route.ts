import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const {
      customerEmail,
      shopifyCustomerId,
      title,
      summary,
      sourceSessionId,
    } = await req.json();

    const { data, error } = await supabase
      .from("user_memories")
      .insert([
        {
          customer_email: customerEmail,
          shopify_customer_id: shopifyCustomerId,
          title,
          summary,
          source_session_id: sourceSessionId,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("[Memory Save Error]", error);

      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      memory: data,
    });
  } catch (error) {
    console.error("[Memory Save Route Error]", error);

    return NextResponse.json(
      { error: "Failed to save memory" },
      { status: 500 }
    );
  }
}