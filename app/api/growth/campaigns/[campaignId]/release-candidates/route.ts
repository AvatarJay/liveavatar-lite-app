import { NextResponse } from "next/server";

import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CampaignProspectRow = {
  id: string;
  campaign_id: string;
  prospect_id: string;
  review_status: string | null;
  outreach_status: string | null;
  decision_reason: string | null;
  tracking_token: string | null;
  automation_started_at: string | null;
  created_at: string;
};

type ProspectRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  greeting_name: string | null;
  biography: string | null;
  username: string | null;
  platform: string | null;
  profile_url: string | null;
  marketing_status: string | null;
};

function normalizeText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      campaignId: string;
    }>;
  }
) {
  try {
    const { campaignId } = await context.params;

    if (!campaignId) {
      return NextResponse.json(
        { error: "A campaign ID is required." },
        { status: 400 }
      );
    }

    const { data: campaign, error: campaignError } = await supabase
      .from("growth_campaigns")
      .select(
        `
          id,
          name,
          campaign_code,
          status,
          source_tool,
          daily_send_limit
        `
      )
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
      error: membershipsError,
    } = await supabase
      .from("campaign_prospects")
      .select(
        `
          id,
          campaign_id,
          prospect_id,
          review_status,
          outreach_status,
          decision_reason,
          tracking_token,
          automation_started_at,
          created_at
        `
      )
      .eq("campaign_id", campaignId)
      .eq("review_status", "approved")
      .order("created_at", { ascending: true });

    if (membershipsError) {
      return NextResponse.json(
        { error: membershipsError.message },
        { status: 500 }
      );
    }

    const memberships =
      (membershipRows ?? []) as CampaignProspectRow[];

    const prospectIds = Array.from(
      new Set(memberships.map((row) => row.prospect_id))
    );

    const { data: prospectRows, error: prospectsError } =
      prospectIds.length > 0
        ? await supabase
            .from("prospects")
            .select(
              `
                id,
                email,
                display_name,
                greeting_name,
                biography,
                username,
                platform,
                profile_url,
                marketing_status
              `
            )
            .in("id", prospectIds)
        : {
            data: [],
            error: null,
          };

    if (prospectsError) {
      return NextResponse.json(
        { error: prospectsError.message },
        { status: 500 }
      );
    }

    const prospects = (prospectRows ?? []) as ProspectRow[];

    const prospectById = new Map(
      prospects.map((prospect) => [prospect.id, prospect])
    );

    const candidates = memberships
      .map((membership) => {
        const prospect = prospectById.get(membership.prospect_id);

        if (!prospect) return null;

        const email = normalizeText(prospect.email).toLowerCase();
        const displayName =
          normalizeText(prospect.display_name) ||
          normalizeText(prospect.username) ||
          email;

        const greetingName =
          normalizeText(prospect.greeting_name) || displayName;

        const outreachStatus =
          normalizeText(membership.outreach_status) || "not_started";

        const marketingStatus =
          normalizeText(prospect.marketing_status) || "eligible";

        const ready =
          outreachStatus === "not_started" &&
          marketingStatus === "eligible" &&
          isValidEmail(email);

        let blockedReason: string | null = null;

        if (!isValidEmail(email)) {
          blockedReason = "Missing or invalid email address";
        } else if (marketingStatus !== "eligible") {
          blockedReason = `Marketing status: ${marketingStatus}`;
        } else if (
          outreachStatus !== "not_started" &&
          outreachStatus !== "queued" &&
          outreachStatus !== "released"
        ) {
          blockedReason = `Outreach status: ${outreachStatus}`;
        }

        return {
          campaignProspectId: membership.id,
          prospectId: prospect.id,

          displayName,
          greetingName,
          email,

          biography: normalizeText(prospect.biography),
          username: normalizeText(prospect.username),
          platform: normalizeText(prospect.platform),
          profileUrl: normalizeText(prospect.profile_url),

          reviewStatus: membership.review_status,
          outreachStatus,
          marketingStatus,

          greetingCustomized:
            greetingName.toLocaleLowerCase() !==
            displayName.toLocaleLowerCase(),

          ready,
          blockedReason,

          automationStartedAt:
            membership.automation_started_at,
        };
      })
      .filter(
        (
          candidate
        ): candidate is NonNullable<typeof candidate> =>
          candidate !== null
      );

const readyCount = candidates.filter(
  (candidate) => candidate.ready
).length;

const queuedCount = candidates.filter(
  (candidate) => candidate.outreachStatus === "queued"
).length;

const releasedCount = candidates.filter(
  (candidate) => candidate.outreachStatus === "released"
).length;

const blockedCount = candidates.filter(
  (candidate) =>
    candidate.blockedReason !== null &&
    candidate.outreachStatus !== "queued" &&
    candidate.outreachStatus !== "released"
).length;

return NextResponse.json({
  campaign,
  summary: {
    approved: candidates.length,
    ready: readyCount,
    queued: queuedCount,
    released: releasedCount,
    blocked: blockedCount,
  },
  candidates,
});

  } catch (error) {
    console.error("Unable to load release candidates:", error);

    return NextResponse.json(
      { error: "Unable to load release candidates." },
      { status: 500 }
    );
  }
}