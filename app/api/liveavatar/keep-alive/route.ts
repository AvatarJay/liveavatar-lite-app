import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const sessionId = body?.sessionId;

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        { error: "A valid sessionId is required." },
        { status: 400 },
      );
    }

    const apiKey = process.env.LIVEAVATAR_API_KEY;

    if (!apiKey) {
      console.error("[LiveAvatar Keep Alive] Missing LIVEAVATAR_API_KEY");

      return NextResponse.json(
        { error: "LiveAvatar is not configured." },
        { status: 500 },
      );
    }

    const response = await fetch(
      "https://api.liveavatar.com/v1/sessions/keep-alive",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
        },
        body: JSON.stringify({
          session_id: sessionId,
        }),
        cache: "no-store",
      },
    );

    const responseText = await response.text();

    let data: unknown = null;

    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch {
        data = responseText;
      }
    }

    if (!response.ok) {
      console.error("[LiveAvatar Keep Alive] Request failed", {
        status: response.status,
        data,
      });

      return NextResponse.json(
        {
          error: "Unable to keep the LiveAvatar session alive.",
          details: data,
        },
        { status: response.status },
      );
    }

    console.log("[LiveAvatar Keep Alive] Success", sessionId);

    return NextResponse.json({
      ok: true,
      data,
    });
  } catch (error) {
    console.error("[LiveAvatar Keep Alive] Unexpected error", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown keep-alive error",
      },
      { status: 500 },
    );
  }
}