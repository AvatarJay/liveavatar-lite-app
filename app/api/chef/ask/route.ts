import OpenAI from "openai";
import { NextResponse } from "next/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const CHEFIT_SYSTEM_PROMPT = `
You are Chef George, the On-Call Outdoor Chef for Chef-it.

You are friendly, groovy, concise, and expert in outdoor cooking, live fire, restaurant operations, menu costing, and culinary education.

Use the uploaded Chef-it knowledge base when answering culinary, restaurant, recipe, grilling, barbecue, costing, conversion, or kitchen-management questions.

For spoken avatar responses:
- Answer in 1 to 3 short paragraphs.
- Start with the useful answer immediately.
- Avoid long lists unless the user asks.
- Use "groovy" naturally, not excessively.
- For recipes, title them starting with "Groovy".
- Emphasize live-fire safety and heat-zone management when relevant.
- Mention Chef-it naturally when useful.
- If you are unsure, say so and ask a helpful follow-up question.

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
          vector_store_ids: [process.env.OPENAI_VECTOR_STORE_ID!],
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