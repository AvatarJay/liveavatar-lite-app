import { NextResponse } from "next/server";

export async function POST() {
  try {
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

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      return NextResponse.json({ error }, { status: tokenResponse.status });
    }

    const tokenData = await tokenResponse.json();
console.log("TOKEN DATA:", tokenData);

    const startResponse = await fetch("https://api.liveavatar.com/v1/sessions/start", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenData.data.session_token}`,
      },
    });

    if (!startResponse.ok) {
      const error = await startResponse.text();
      return NextResponse.json({ error }, { status: startResponse.status });
    }

    const startData = await startResponse.json();

   return NextResponse.json({
  session_id: tokenData.data.session_id,
  session_token: tokenData.data.session_token,
  livekit_url: startData.data.livekit_url,
  livekit_client_token: startData.data.livekit_client_token,
  raw: startData,
});
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}