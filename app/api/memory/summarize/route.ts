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
      sourceSessionId,
      transcript,
    } = await req.json();

    if (!customerEmail || !transcript) {
      return NextResponse.json(
        { error: "Missing customerEmail or transcript" },
        { status: 400 }
      );
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.5",
        input: `
Create a useful long-term customer memory from this Chef-it transcript.

Focus on:
- cooking preferences
- restaurant/business struggles
- equipment they own
- skill level
- goals
- recurring problems
- food interests
- anything Chef George should remember next time

Return ONLY valid JSON in this format:
{
  "title": "short title",
  "summary": "clear useful memory in 1-3 sentences"
}

Transcript:
${transcript}
        `,
      }),
    });

    const result = await response.json();

console.log("[Memory Summarize OpenAI Result]", JSON.stringify(result, null, 2));

const outputText =
  result.output_text ||
  result.output?.[0]?.content?.[0]?.text ||
  result.output?.[0]?.content?.[0]?.content ||
  result.output?.[1]?.content?.[0]?.text ||
  result.choices?.[0]?.message?.content ||
  "";

    let memoryJson;

    try {
      memoryJson = JSON.parse(outputText);
    } catch {
      memoryJson = {
        title: "Chef-it Session Memory",
        summary: outputText || "Session completed, but no memory summary was generated.",
      };
    }

    const { data, error } = await supabase
      .from("user_memories")
      .insert([
        {
          customer_email: customerEmail,
          shopify_customer_id: shopifyCustomerId || null,
          memory_type: "session_summary",
          title: memoryJson.title,
          summary: memoryJson.summary,
          source_session_id: sourceSessionId || null,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("[Memory Summarize Save Error]", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      memory: data,
    });
  } catch (error) {
    console.error("[Memory Summarize Error]", error);

    return NextResponse.json(
      { error: "Failed to summarize memory" },
      { status: 500 }
    );
  }
}