import { NextResponse } from "next/server";

export async function POST() {
  const startedAt = Date.now();

  try {
    console.log("[LiveAvatar] Creating session token...");

    const tokenStart = Date.now();

    const tokenResponse = await fetch("https://api.liveavatar.com/v1/sessions/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": process.env.LIVEAVATAR_API_KEY!,
      },
      body: JSON.stringify({
        mode: "LITE",
        avatar_id: process.env.LIVEAVATAR_AVATAR_ID,
        elevenlabs_agent_config: {
          secret_id: process.env.LIVEAVATAR_ELEVENLABS_SECRET_ID,
          agent_id: process.env.ELEVENLABS_AGENT_ID,
        },
      }),
    });

    const tokenMs = Date.now() - tokenStart;

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error("[LiveAvatar] Token error:", error);
      return NextResponse.json({ error }, { status: tokenResponse.status });
    }

    const tokenData = await tokenResponse.json();

    console.log(`[LiveAvatar] Token created in ${tokenMs}ms`);

    console.log("[LiveAvatar] Starting session...");

    const sessionStart = Date.now();

    const startResponse = await fetch("https://api.liveavatar.com/v1/sessions/start", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenData.data.session_token}`,
      },
    });

    const sessionMs = Date.now() - sessionStart;

    if (!startResponse.ok) {
      const error = await startResponse.text();
      console.error("[LiveAvatar] Start error:", error);
      return NextResponse.json({ error }, { status: startResponse.status });
    }

    const startData = await startResponse.json();

    console.log(`[LiveAvatar] Session started in ${sessionMs}ms`);
    console.log(`[LiveAvatar] Total backend time: ${Date.now() - startedAt}ms`);

    return NextResponse.json({
      session_id: tokenData.data.session_id,
      session_token: tokenData.data.session_token,
      livekit_url: startData.data.livekit_url,
      livekit_client_token: startData.data.livekit_client_token,
      timing: {
        token_ms: tokenMs,
        session_start_ms: sessionMs,
        total_backend_ms: Date.now() - startedAt,
      },
    });
  } catch (error) {
    console.error("[LiveAvatar] Unexpected error:", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}