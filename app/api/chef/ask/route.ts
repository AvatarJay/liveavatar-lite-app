import OpenAI from "openai";
import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `
Answer the user's question using the Chef-iT files when they contain relevant information.

Rules:
- Give only the useful answer.
- Keep it concise and natural for spoken conversation.
- Usually use no more than 75 words.
- Do not mention files, searches, tools, retrieval, or internal systems.
- If the files do not contain enough information, say:
  "I don't have enough Chef-iT information to answer that accurately."
- Do not guess.
`;

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;
    const model = process.env.OPENAI_MODEL || "gpt-5.5";

    if (!apiKey || !vectorStoreId) {
      return NextResponse.json(
        { error: "Chef-iT knowledge service is not configured." },
        { status: 500 }
      );
    }

    const body = await req.json();
    const question =
      typeof body?.question === "string"
        ? body.question.trim()
        : "";

    if (!question) {
      return NextResponse.json(
        { error: "Missing question." },
        { status: 400 }
      );
    }

    const openai = new OpenAI({
      apiKey,
      timeout: 7500,
      maxRetries: 0,
    });

    const response = await openai.responses.create({
      model,
      instructions: SYSTEM_PROMPT,
      input: question,
      tools: [
        {
          type: "file_search",
          vector_store_ids: [vectorStoreId],
          max_num_results: 3,
        },
      ],
    });

    const answer = response.output_text?.trim();

    if (!answer) {
      return NextResponse.json(
        {
          answer:
            "I don't have enough Chef-iT information to answer that accurately.",
        },
        { status: 200 }
      );
    }

    return NextResponse.json({ answer });
  } catch (error) {
    console.error("[Chef Ask Error]", error);

    return NextResponse.json(
      {
        error: "Chef-iT knowledge request failed.",
      },
      { status: 500 }
    );
  }
}