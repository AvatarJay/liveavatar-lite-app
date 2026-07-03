import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function buildCustomerSessionMemory(customerEmail?: string) {
  if (!customerEmail) return "No useful customer history yet.";

  const { data: sessions, error } = await supabase
    .from("sessions")
    .select("started_at, duration_seconds, transcript")
    .eq("customer_email", customerEmail)
    .not("transcript", "is", null)
    .order("started_at", { ascending: false })
    .limit(3);

  if (error) {
    console.error("[Session Memory Error]", error);
    return "No useful customer history yet.";
  }

  if (!sessions?.length) return "No useful customer history yet.";

  const memoryLines = sessions
    .map((session, index) => {
      const userLines = String(session.transcript || "")
        .split("\n")
        .filter((line) => line.includes("User:"))
        .map((line) => line.replace(/^.*User:\s*/i, "").trim())
        .filter(Boolean)
        .slice(0, 4);

      if (!userLines.length) return null;

      return `Recent session ${index + 1}: Customer discussed ${userLines.join("; ")}.`;
    })
    .filter(Boolean);

  if (!memoryLines.length) return "No useful customer history yet.";

  return [
    "Recent customer context:",
    ...memoryLines,
    "",
    "Use this only when it naturally helps the conversation.",
  ].join("\n");
}

export async function POST(req: Request) {
  const startedAt = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    const customerEmail = body?.customerEmail;

    const customerSessionMemory = await buildCustomerSessionMemory(customerEmail);

    console.log("[LiveAvatar] Creating session token...");
    console.log("[LiveAvatar] Session memory:", customerSessionMemory);

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
          dynamic_variables: {
            customer_session_memory: customerSessionMemory,
          },
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