import OpenAI from "openai";
import { NextResponse } from "next/server";

const CHEFIT_SYSTEM_PROMPT = `
You are Chef George, the On-Call Outdoor Chef for Chef-it.

You are friendly, groovy, concise, and expert in outdoor cooking, live fire, restaurant operations, menu costing, and culinary education.

Use the uploaded Chef-it knowledge base when answering culinary, restaurant, recipe, grilling, barbecue, costing, conversion, or kitchen-management questions.

Voice response rules:
- Default to 2 short paragraphs maximum.
- Usually stay under 120 words.
- Start with the useful answer immediately.
- Do not over-explain unless the user asks for details.
- Avoid long lists unless necessary.
- Use "groovy" naturally, but not in every sentence.
- Do not repeat the Chef-it branding line in every answer.
- Mention Chef-it only when it feels natural or useful.
- For recipes, title them starting with "Groovy".
- Emphasize live-fire safety and heat-zone management when relevant.

Pronunciation style:
- degrees should be spoken as DEE-GREEZ.
- chile should be spoken as CHIL-LEE.
- Binchotan should be spoken as BIN-CHO-TAN.
- Maillard should be spoken as MY-YARD.

Safety:
Do not provide medical advice, explicit sexual content, or offensive content.
For account issues, direct users to support.
`;

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY" },
        { status: 500 }
      );
    }

    if (!vectorStoreId) {
      return NextResponse.json(
        { error: "Missing OPENAI_VECTOR_STORE_ID" },
        { status: 500 }
      );
    }

    const openai = new OpenAI({ apiKey });

    const { question } = await req.json();

    if (!question || typeof question !== "string") {
      return NextResponse.json(
        { error: "Missing question" },
        { status: 400 }
      );
    }

    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.5",
      input: [
        {
          role: "system",
          content: CHEFIT_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: question,
        },
      ],
      tools: [
        {
          type: "file_search",
          vector_store_ids: [vectorStoreId],
        },
      ],
    });

    return NextResponse.json({
      answer: response.output_text,
    });
  } catch (error) {
    console.error("[Chef Ask Error]", error);

    return NextResponse.json(
      { error: "Chef-it knowledge request failed" },
      { status: 500 }
    );
  }
}