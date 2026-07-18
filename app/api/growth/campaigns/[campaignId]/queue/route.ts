import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

type QueueRequest = {
  campaignProspectIds: string[];
};

type CampaignProspectRow = {
  id: string;
  campaign_id: string;
  prospect_id: string;
  review_status: string | null;
  outreach_status: string | null;
  tracking_token: string | null;
};

type ProspectRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  greeting_name: string | null;
  marketing_status: string | null;
};

type QueueSuccess = {
  campaignProspectId: string;
  prospectId: string;
  email: string;
  greetingName: string;
};

type QueueIssue = {
  campaignProspectId: string;
  email?: string;
  message: string;
};

function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function writeCampaignEvent({
  campaignId,
  prospectId,
  campaignProspectId,
  eventType,
  eventData,
}: {
  campaignId: string;
  prospectId: string;
  campaignProspectId: string;
  eventType: string;
  eventData: Record<string, unknown>;
}) {
  const { error } = await supabase.from("campaign_events").insert({
    campaign_id: campaignId,
    prospect_id: prospectId,
    campaign_prospect_id: campaignProspectId,
    source_system: "growth_engine",
    event_type: eventType,
    event_data: eventData,
  });

  if (error) {
    console.error(
      `Unable to write ${eventType} for ${campaignProspectId}:`,
      error
    );
  }
}

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{
      campaignId: string;
    }>;
  }
) {
  const { campaignId } = await context.params;

  let body: QueueRequest;

  try {
    body = (await request.json()) as QueueRequest;
  } catch {
    return NextResponse.json(
      { error: "The request body must be valid JSON." },
      { status: 400 }
    );
  }

  const campaignProspectIds = Array.from(
    new Set(
      (body.campaignProspectIds ?? [])
        .map((id) => id?.trim())
        .filter(Boolean)
    )
  );

  if (!campaignId) {
    return NextResponse.json(
      { error: "A campaign ID is required." },
      { status: 400 }
    );
  }

  if (campaignProspectIds.length === 0) {
    return NextResponse.json(
      { error: "Select at least one prospect to queue." },
      { status: 400 }
    );
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("growth_campaigns")
    .select("id, name")
    .eq("id", campaignId)
    .maybeSingle();

  if (campaignError) {
    return NextResponse.json(
      { error: campaignError.message },
      { status: 500 }
    );
  }

  if (!campaign) {
    return NextResponse.json(
      { error: "The selected campaign was not found." },
      { status: 404 }
    );
  }

  const {
    data: membershipRows,
    error: membershipError,
  } = await supabase
    .from("campaign_prospects")
    .select(
      `
        id,
        campaign_id,
        prospect_id,
        review_status,
        outreach_status,
        tracking_token
      `
    )
    .eq("campaign_id", campaignId)
    .in("id", campaignProspectIds);

  if (membershipError) {
    return NextResponse.json(
      { error: membershipError.message },
      { status: 500 }
    );
  }

  const memberships =
    (membershipRows ?? []) as CampaignProspectRow[];

  const membershipById = new Map(
    memberships.map((membership) => [membership.id, membership])
  );

  const prospectIds = Array.from(
    new Set(memberships.map((membership) => membership.prospect_id))
  );

  const { data: prospectRows, error: prospectError } =
    prospectIds.length > 0
      ? await supabase
          .from("prospects")
          .select(
            `
              id,
              email,
              display_name,
              greeting_name,
              marketing_status
            `
          )
          .in("id", prospectIds)
      : { data: [], error: null };

  if (prospectError) {
    return NextResponse.json(
      { error: prospectError.message },
      { status: 500 }
    );
  }

  const prospects = (prospectRows ?? []) as ProspectRow[];

  const prospectById = new Map(
    prospects.map((prospect) => [prospect.id, prospect])
  );

  const queued: QueueSuccess[] = [];
  const skipped: QueueIssue[] = [];
  const failed: QueueIssue[] = [];

  for (const campaignProspectId of campaignProspectIds) {
    const membership = membershipById.get(campaignProspectId);

    if (!membership) {
      skipped.push({
        campaignProspectId,
        message:
          "The campaign prospect was not found in this campaign.",
      });
      continue;
    }

    if (membership.review_status !== "approved") {
      skipped.push({
        campaignProspectId,
        message: `Prospect is not approved. Current status: ${
          membership.review_status ?? "unknown"
        }.`,
      });
      continue;
    }

    if (
      membership.outreach_status &&
      membership.outreach_status !== "not_started"
    ) {
      skipped.push({
        campaignProspectId,
        message: `Prospect is already ${membership.outreach_status}.`,
      });
      continue;
    }

    const prospect = prospectById.get(membership.prospect_id);

    if (!prospect) {
      failed.push({
        campaignProspectId,
        message: "The associated prospect record was not found.",
      });
      continue;
    }

    const email = normalizeEmail(prospect.email);
    const greetingName =
      normalizeText(prospect.greeting_name) ||
      normalizeText(prospect.display_name) ||
      "there";

    if (!isValidEmail(email)) {
      skipped.push({
        campaignProspectId,
        email,
        message: "The prospect does not have a valid email address.",
      });
      continue;
    }

    if (
      prospect.marketing_status &&
      prospect.marketing_status !== "eligible"
    ) {
      skipped.push({
        campaignProspectId,
        email,
        message: `Marketing status is ${prospect.marketing_status}.`,
      });
      continue;
    }

    const trackingToken =
      membership.tracking_token?.trim() || randomUUID();

    const { data: queuedMembership, error: queueError } =
      await supabase
        .from("campaign_prospects")
        .update({
          outreach_status: "queued",
          tracking_token: trackingToken,
          scheduled_send_at: null,
          automation_started_at: null,
          automation_stopped_at: null,
          stop_reason: null,
        })
        .eq("id", campaignProspectId)
        .eq("campaign_id", campaignId)
        .eq("review_status", "approved")
        .eq("outreach_status", "not_started")
        .select("id")
        .maybeSingle();

    if (queueError) {
      failed.push({
        campaignProspectId,
        email,
        message: queueError.message,
      });
      continue;
    }

    if (!queuedMembership) {
      skipped.push({
        campaignProspectId,
        email,
        message:
          "The prospect is no longer ready to queue. Refresh and try again.",
      });
      continue;
    }

    await writeCampaignEvent({
      campaignId,
      prospectId: prospect.id,
      campaignProspectId,
      eventType: "campaign.prospect_queued",
      eventData: {
        email,
        greeting_name: greetingName,
        tracking_token: trackingToken,
        queued_at: new Date().toISOString(),
      },
    });

    queued.push({
      campaignProspectId,
      prospectId: prospect.id,
      email,
      greetingName,
    });
  }

  return NextResponse.json({
    campaign: {
      id: campaign.id,
      name: campaign.name,
    },
    requested: campaignProspectIds.length,
    queuedCount: queued.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    queued,
    skipped,
    failed,
  });
}