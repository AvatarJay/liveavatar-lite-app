import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getPreferredName(relationship: any) {
  return (
    relationship?.identity?.preferred_name ||
    relationship?.identity?.name ||
    ""
  );
}

function buildFirstMessage(relationship: any) {
  // First session: always use the full Chef-it introduction.
  if (!relationship || !relationship.last_session_at) {
    return "Welcome to Chef-it. I'm George Lovato Jr., the On-Call Outdoor Chef. What's cooking?";
  }

  const preferredName = getPreferredName(relationship).trim();

  // Returning customer with a known name.
  if (preferredName) {
    const namedGreetings = [
      `Welcome back, ${preferredName}. What's happening?`,
      `Good to see you again, ${preferredName}. What's cooking today?`,
      `Hey ${preferredName}, welcome back. What can I help with today?`,
      `Hi ${preferredName}, what's cooking today?`,
    ];

    return namedGreetings[
      Math.floor(Math.random() * namedGreetings.length)
    ];
  }

  // Returning customer without a known name.
  const unnamedGreetings = [
    "Welcome back. What's happening?",
    "Good to see you again. What's cooking today?",
    "Welcome back. What can I help with today?",
    "Glad you're back. What's cooking?",
  ];

  return unnamedGreetings[
    Math.floor(Math.random() * unnamedGreetings.length)
  ];
}

function formatRelationshipMemory(relationship: any) {
  if (!relationship) {
    return `
First Visit: true
Preferred Name:
Last Session:

Customer Relationship Memory:
No useful customer history yet.
`;
  }

  const preferredName = getPreferredName(relationship);

  return `
First Visit: ${relationship.last_session_at ? "false" : "true"}
Preferred Name: ${preferredName}
Last Session: ${relationship.last_session_at || ""}

Customer Relationship Memory:

Customer Type: ${relationship.customer_type || "unknown"}
Coaching Style: ${relationship.coaching_style || "unknown"}
Communication Style: ${relationship.communication_style || "unknown"}

Identity:
${JSON.stringify(relationship.identity || {}, null, 2)}

Business Profile:
${JSON.stringify(relationship.business_profile || {}, null, 2)}

Culinary Preferences:
${JSON.stringify(relationship.culinary_preferences || [], null, 2)}

Equipment:
${JSON.stringify(relationship.equipment || [], null, 2)}

Active Projects:
${JSON.stringify(relationship.active_projects || [], null, 2)}

Consultant Notes:
${JSON.stringify(relationship.consultant_notes || [], null, 2)}

Success Stories:
${JSON.stringify(relationship.success_stories || [], null, 2)}

Lessons Learned:
${JSON.stringify(relationship.lessons_learned || [], null, 2)}

Follow Ups:
${JSON.stringify(relationship.follow_ups || [], null, 2)}

Last Session Summary:
${relationship.last_session_summary || ""}
`;
}

async function getRelationship(customerEmail?: string) {
  if (!customerEmail) return null;

  const { data, error } = await supabase
    .from("customer_relationships")
    .select("*")
    .eq("customer_email", customerEmail)
    .maybeSingle();

  if (error) {
    console.error("[Relationship Memory Error]", error);
    return null;
  }

  return data;
}

export async function POST(req: Request) {
  const startedAt = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    const customerEmail = body?.customerEmail;

    const relationship = await getRelationship(customerEmail);
    const customerSessionMemory = formatRelationshipMemory(relationship);
    const firstMessage = buildFirstMessage(relationship);

    console.log("[LiveAvatar] Creating session token...");
    console.log("[LiveAvatar] First message:", firstMessage);
    console.log("[LiveAvatar] Relationship memory:", customerSessionMemory);

    const tokenStart = Date.now();

    const tokenResponse = await fetch(
      "https://api.liveavatar.com/v1/sessions/token",
      {
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
              chefit_first_message: firstMessage,
            },
          },
        }),
      }
    );

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

    const startResponse = await fetch(
      "https://api.liveavatar.com/v1/sessions/start",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenData.data.session_token}`,
        },
      }
    );

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