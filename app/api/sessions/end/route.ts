import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const MEMORY_MODEL =
  process.env.OPENAI_MEMORY_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";

function defaultRelationship(customerEmail: string) {
  return {
    customer_email: customerEmail,
    customer_type: "unknown",
    coaching_style: "unknown",
    communication_style: "unknown",
    identity: {},
    business_profile: {},
    household_profile: {},
    culinary_preferences: [],
    dietary_needs: [],
    equipment: [],
    active_projects: [],
    consultant_notes: [],
    recent_recommendations: [],
    success_stories: [],
    lessons_learned: [],
    follow_ups: [],
    pain_points: [],
    opportunity_signals: [],
    relationship_notes: [],
    last_session_summary: "",
  };
}

async function updateCustomerRelationship({
  customerEmail,
  sessionId,
  transcript,
}: {
  customerEmail: string;
  sessionId: string;
  transcript: string;
}) {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("[Relationship Memory] Missing OPENAI_API_KEY. Skipping.");
    return;
  }

  const { data: existing } = await supabase
    .from("customer_relationships")
    .select("*")
    .eq("customer_email", customerEmail)
    .maybeSingle();

  const previousRelationship = existing || defaultRelationship(customerEmail);

  const prompt = `
You are Chef-it's private relationship memory manager.

Your job is to update a structured customer relationship profile from the latest session transcript.

Rules:
- Preserve important long-term facts.
- Add only details useful for future culinary, restaurant, business, cooking, or coaching conversations.
- Do not store small talk.
- Do not invent facts.
- Keep entries concise.
- Return valid JSON only.
- Update the existing relationship profile instead of simply appending new items.
- Merge duplicate or overlapping notes.
- Replace outdated information with more accurate newer information.
- Remove obsolete or completed follow-ups when appropriate.
- Keep only the most useful and current information.

Limits:
- consultant_notes: max 10
- lessons_learned: max 10
- follow_ups: max 10
- success_stories: max 20
- active_projects: max 10

Active projects must be structured objects:
{
  "project": "",
  "status": "active | completed | paused",
  "priority": "low | medium | high",
  "started": "",
  "last_updated": "",
  "next_follow_up": "",
  "outcome": "",
  "lesson": ""
}

When a project has a clear positive outcome, update its status to "completed" and move the win into success_stories when appropriate.

Consultant notes are George's evolving notebook. Store concise professional observations, recommendations, warnings, business insights, or coaching notes.

Success stories are positive outcomes or wins the customer reports.

If the customer reports that a recommendation worked, improved results, avoided waste, increased sales, reduced cost, solved a problem, or created a positive business/customer outcome, create or update a success story.

Success stories should be structured objects:
{
  "title": "",
  "date": "",
  "summary": "",
  "customer_feedback": "",
  "business_outcome": "",
  "lesson": ""
}

Lessons learned are reusable takeaways that should improve future advice. If a recommendation fails, partially works, or does not hit with customers, capture the lesson learned without treating it as a success story.

Previous relationship profile:
${JSON.stringify(previousRelationship, null, 2)}

Latest transcript:
${transcript}

Return JSON with these fields:
{
  "customer_type": "",
  "coaching_style": "",
  "communication_style": "",
  "identity": {},
  "business_profile": {},
  "household_profile": {},
  "culinary_preferences": [],
  "dietary_needs": [],
  "equipment": [],
  "active_projects": [],
  "consultant_notes": [],
  "recent_recommendations": [],
  "success_stories": [],
  "lessons_learned": [],
  "follow_ups": [],
  "pain_points": [],
  "opportunity_signals": [],
  "relationship_notes": [],
  "last_session_summary": "",
  "change_summary": ""
}
`;

  const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MEMORY_MODEL,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const aiData = await aiRes.json();

  if (!aiRes.ok) {
    console.error("[Relationship Memory AI Error]", aiData);
    return;
  }

  const raw = aiData?.choices?.[0]?.message?.content || "{}";
  const cleaned = raw.replace(/^```json/i, "").replace(/^```/i, "").replace(/```$/i, "").trim();

  let updated;
  try {
    updated = JSON.parse(cleaned);
  } catch (error) {
    console.error("[Relationship Memory Parse Error]", raw);
    return;
  }

  const updatedRelationship = {
    customer_email: customerEmail,
    customer_type: updated.customer_type || previousRelationship.customer_type || "unknown",
    coaching_style: updated.coaching_style || previousRelationship.coaching_style || "unknown",
    communication_style: updated.communication_style || previousRelationship.communication_style || "unknown",
    identity: updated.identity || {},
    business_profile: updated.business_profile || {},
    household_profile: updated.household_profile || {},
    culinary_preferences: updated.culinary_preferences || [],
    dietary_needs: updated.dietary_needs || [],
    equipment: updated.equipment || [],
    active_projects: updated.active_projects || [],
    consultant_notes: updated.consultant_notes || previousRelationship.consultant_notes || [],
    success_stories: updated.success_stories || previousRelationship.success_stories || [],
    lessons_learned: updated.lessons_learned || previousRelationship.lessons_learned || [],
    recent_recommendations: updated.recent_recommendations ||
    previousRelationship.recent_recommendations || [],
    follow_ups: updated.follow_ups || previousRelationship.follow_ups || [],
    pain_points: updated.pain_points || previousRelationship.pain_points || [],
    opportunity_signals: updated.opportunity_signals || previousRelationship.opportunity_signals || [],
relationship_notes: updated.relationship_notes || previousRelationship.relationship_notes || [],
    last_session_summary: updated.last_session_summary || "",
    last_session_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await supabase.from("customer_relationship_versions").insert({
    customer_email: customerEmail,
    session_id: sessionId,
    previous_relationship: previousRelationship,
    updated_relationship: updatedRelationship,
    change_summary: updated.change_summary || "Relationship profile updated.",
  });

  const { error } = await supabase
    .from("customer_relationships")
    .upsert(updatedRelationship, {
      onConflict: "customer_email",
    });

  if (error) {
    console.error("[Relationship Memory Upsert Error]", error);
  }
}

export async function POST(req: Request) {
  try {
    const { sessionId, durationSeconds, transcript } = await req.json();

    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    const { data: endedSession, error } = await supabase
      .from("sessions")
      .update({
        ended_at: new Date().toISOString(),
        duration_seconds: durationSeconds || 0,
        transcript: transcript || "",
      })
      .eq("id", sessionId)
      .select("id, customer_email, transcript")
      .single();

    if (error) {
      console.error("[Session End Error]", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (endedSession?.customer_email && transcript) {
      await updateCustomerRelationship({
        customerEmail: endedSession.customer_email,
        sessionId,
        transcript,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Session End Unexpected Error]", error);
    return NextResponse.json(
      { error: "Failed to end session tracking" },
      { status: 500 }
    );
  }
}