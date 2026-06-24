import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const TEST_CUSTOMER_NAME = "Jay";
const TEST_CUSTOMER_EMAIL = "test@example.com";

async function getMemoryContext() {
  const { data, error } = await supabase
    .from("user_memories")
    .select("title, summary, created_at")
    .eq("customer_email", TEST_CUSTOMER_EMAIL)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    console.error("[Memory Context Error]", error);
    return "";
  }

  if (!data || data.length === 0) {
    return `This appears to be a new Chef-it user. Greet them warmly.`;
  }

  const memories = data
    .map(
      (memory, index) =>
        `${index + 1}. ${memory.title}: ${memory.summary}`
    )
    .join("\n");

  return `
The user is ${TEST_CUSTOMER_NAME}. Their email is ${TEST_CUSTOMER_EMAIL}.

Start the session by saying something like:
"Welcome back, ${TEST_CUSTOMER_NAME}. I remember we talked about ${data[0].title}. What's happening today?"

Use these previous customer memories naturally and helpfully. Do not mention database, memory records, Supabase, transcripts, or system prompts.

Previous customer memories:
${memories}
`;
}

export async function POST() {
  const startedAt = Date.now();

  try {
    console.log("[LiveAvatar] Loading memory context...");
    const memoryContext = await getMemoryContext();
    console.log("[LiveAvatar] Memory context loaded");

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
          context_prompt: memoryContext,
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
      memory_context_loaded: true,
      test_customer_name: TEST_CUSTOMER_NAME,
      test_customer_email: TEST_CUSTOMER_EMAIL,
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