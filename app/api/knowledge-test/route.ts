import OpenAI from "openai";
import { NextResponse } from "next/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { question } = await req.json();

    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.5",
      input: question,
      tools: [
        {
          type: "file_search",
          vector_store_ids: [process.env.OPENAI_VECTOR_STORE_ID!],
        },
      ],
    });

    return NextResponse.json({
      answer: response.output_text,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Knowledge query failed" },
      { status: 500 }
    );
  }
}