import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENGINE_NAME = "Chef-iT Growth Engine";
const ENGINE_VERSION = "1.0.0";
const MAX_QUEUE_ROWS_PER_CAMPAIGN = 250;

type GrowthCampaignRow = {
  id: string;
  name: string;
  campaign_code: string;
  status: string;
  daily_send_limit: number;
  release_interval_minutes: number;
  send_window_start: string;
  send_window_end: string;
  campaign_timezone: string;
  max_release_attempts: number;
};

type CampaignProspectRow = {
  id: string;
  campaign_id: string;
  prospect_id: string;
  review_status: string | null;
  outreach_status: string | null;
  queued_at: string | null;
  created_at: string;
  released_at: string | null;
  release_attempted_at: string | null;
  release_attempt_count: number;
  next_attempt_at: string | null;
  tracking_token: string | null;
};

type ProspectRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  greeting_name: string | null;
  marketing_status: string | null;
};

type ExistingCustomerMatch = {
  found: boolean;
  reason:
    | "existing_customer"
    | "minutes_purchased"
    | "first_session_started"
    | null;
  customerId: string | null;
  matchedAt: string | null;
  matchedSource:
    | "customers"
    | "purchases"
    | "sessions"
    | null;
};

type CustomerRow = {
  id: string;
  email: string | null;
  created_at: string | null;
};

type PurchaseRow = {
  id: string;
  customer_email: string | null;
  created_at: string | null;
};

type SessionRow = {
  id: string;
  customer_email: string | null;
  started_at: string | null;
};

type CampaignDecision = {
  campaignId: string;
  campaignName: string;
  campaignProspectId?: string;
  prospectId?: string;
  email?: string;
  decisionCode: string;
  decisionReason: string;
  wouldRelease: boolean;
  atomicClaimed: boolean;
  stopped: boolean;
};

type CampaignSummary = {
  campaignId: string;
  campaignName: string;
  campaignCode: string;
  status: string;
  insideSendWindow: boolean;
  localDate: string;
  localTime: string;
  dailyLimit: number;
  releasedToday: number;
  remainingToday: number;
  intervalMinutes: number;
  intervalElapsed: boolean;
  queuedCount: number;
  evaluatedCount: number;
  wouldReleaseCount: number;
  atomicClaims: number;
  stoppedCount: number;
  decisions: CampaignDecision[];
};

function normalizeText(
  value: string | null | undefined
): string {
  return value?.trim() ?? "";
}

function normalizeEmail(
  value: string | null | undefined
): string {
  return normalizeText(value).toLowerCase();
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseTimeToMinutes(value: string): number | null {
  const normalized = value.trim();
  const match = normalized.match(
    /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/
  );

  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return hours * 60 + minutes;
}

function getZonedDateTimeParts(
  date: Date,
  timeZone: string
): {
  dateKey: string;
  timeLabel: string;
  minutesSinceMidnight: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const values = new Map(
    parts.map((part) => [part.type, part.value])
  );

  const year = values.get("year") ?? "0000";
  const month = values.get("month") ?? "00";
  const day = values.get("day") ?? "00";
  const hour = Number(values.get("hour") ?? "0");
  const minute = Number(values.get("minute") ?? "0");

  return {
    dateKey: `${year}-${month}-${day}`,
    timeLabel: `${String(hour).padStart(
      2,
      "0"
    )}:${String(minute).padStart(2, "0")}`,
    minutesSinceMidnight: hour * 60 + minute,
  };
}

function isInsideSendWindow({
  currentMinutes,
  startTime,
  endTime,
}: {
  currentMinutes: number;
  startTime: string;
  endTime: string;
}): boolean {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);

  if (startMinutes === null || endMinutes === null) {
    return false;
  }

  return (
    currentMinutes >= startMinutes &&
    currentMinutes < endMinutes
  );
}

function getGitCommit(): string | null {
  const value =
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.GIT_COMMIT_SHA?.trim() ||
    "";

  return value || null;
}

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!cronSecret) {
    console.error("CRON_SECRET is not configured.");
    return false;
  }

  const authorization =
    request.headers.get("authorization") ?? "";

  return authorization === `Bearer ${cronSecret}`;
}

async function writeEvaluationEvent({
  engineRunId,
  campaignId,
  campaignProspectId,
  prospectId,
  decisionCode,
  decisionReason,
  eventData,
}: {
  engineRunId: string;
  campaignId: string;
  campaignProspectId: string;
  prospectId: string;
  decisionCode: string;
  decisionReason: string;
  eventData: Record<string, unknown>;
}) {
  const { error } = await supabase
    .from("campaign_events")
    .insert({
      campaign_id: campaignId,
      campaign_prospect_id: campaignProspectId,
      prospect_id: prospectId,
      source_system: "growth_engine",
      event_type: "campaign.prospect_release_evaluated",
      decision_code: decisionCode,
      decision_source: "release_engine",
      engine_run_id: engineRunId,
      event_data: {
        dry_run: true,
        engine_name: ENGINE_NAME,
        engine_version: ENGINE_VERSION,
        decision_reason: decisionReason,
        evaluated_at: new Date().toISOString(),
        ...eventData,
      },
    });

  if (error) {
    console.error(
      `Unable to write evaluation event for ${campaignProspectId}:`,
      error
    );
  }
}

async function countReleasedToday({
  campaignId,
  campaignTimezone,
  localDate,
  now,
}: {
  campaignId: string;
  campaignTimezone: string;
  localDate: string;
  now: Date;
}): Promise<number> {
  /*
   * Query a 48-hour UTC window, then compare each timestamp
   * using the campaign's local calendar date. This avoids
   * assuming that the campaign timezone shares UTC midnight.
   */
  const lowerBound = new Date(
    now.getTime() - 48 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("campaign_prospects")
    .select("released_at")
    .eq("campaign_id", campaignId)
    .not("released_at", "is", null)
    .gte("released_at", lowerBound)
    .lte("released_at", now.toISOString());

  if (error) {
    throw new Error(
      `Unable to count today's releases: ${error.message}`
    );
  }

  return (data ?? []).filter((row) => {
    if (!row.released_at) return false;

    const releaseDate = new Date(row.released_at);

    if (Number.isNaN(releaseDate.getTime())) {
      return false;
    }

    return (
      getZonedDateTimeParts(
        releaseDate,
        campaignTimezone
      ).dateKey === localDate
    );
  }).length;
}

async function getLatestReleaseAt(
  campaignId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("campaign_prospects")
    .select("released_at")
    .eq("campaign_id", campaignId)
    .not("released_at", "is", null)
    .order("released_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to load the latest release: ${error.message}`
    );
  }

  return data?.released_at ?? null;
}

async function isSuppressed(
  normalizedEmail: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("marketing_suppressions")
    .select("id")
    .eq("email_normalized", normalizedEmail)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to check marketing suppression: ${error.message}`
    );
  }

  return Boolean(data);
}

async function findExistingCustomer(
  normalizedEmail: string
): Promise<ExistingCustomerMatch> {
  /*
   * Precedence:
   * 1. Canonical customer identity
   * 2. Purchase history
   * 3. Session history
   */

  const { data: customerRows, error: customerError } =
    await supabase
      .from("customers")
      .select("id, email, created_at")
      .ilike("email", normalizedEmail)
      .limit(10);

  if (customerError) {
    throw new Error(
      `Unable to check customers: ${customerError.message}`
    );
  }

  const customer = (
    (customerRows ?? []) as CustomerRow[]
  ).find(
    (row) => normalizeEmail(row.email) === normalizedEmail
  );

  if (customer) {
    return {
      found: true,
      reason: "existing_customer",
      customerId: customer.id,
      matchedAt: customer.created_at,
      matchedSource: "customers",
    };
  }

  const { data: purchaseRows, error: purchaseError } =
    await supabase
      .from("purchases")
      .select("id, customer_email, created_at")
      .ilike("customer_email", normalizedEmail)
      .order("created_at", { ascending: false })
      .limit(10);

  if (purchaseError) {
    throw new Error(
      `Unable to check purchases: ${purchaseError.message}`
    );
  }

  const purchase = (
    (purchaseRows ?? []) as PurchaseRow[]
  ).find(
    (row) =>
      normalizeEmail(row.customer_email) ===
      normalizedEmail
  );

  if (purchase) {
    return {
      found: true,
      reason: "minutes_purchased",
      customerId: null,
      matchedAt: purchase.created_at,
      matchedSource: "purchases",
    };
  }

  const { data: sessionRows, error: sessionError } =
    await supabase
      .from("sessions")
      .select("id, customer_email, started_at")
      .ilike("customer_email", normalizedEmail)
      .order("started_at", { ascending: false })
      .limit(10);

  if (sessionError) {
    throw new Error(
      `Unable to check sessions: ${sessionError.message}`
    );
  }

  const session = (
    (sessionRows ?? []) as SessionRow[]
  ).find(
    (row) =>
      normalizeEmail(row.customer_email) ===
      normalizedEmail
  );

  if (session) {
    return {
      found: true,
      reason: "first_session_started",
      customerId: null,
      matchedAt: session.started_at,
      matchedSource: "sessions",
    };
  }

  return {
    found: false,
    reason: null,
    customerId: null,
    matchedAt: null,
    matchedSource: null,
  };
}

async function claimCampaignProspect({
  campaignId,
  campaignProspectId,
  claimToken,
  claimedAt,
}: {
  campaignId: string;
  campaignProspectId: string;
  claimToken: string;
  claimedAt: string;
}): Promise<boolean> {
  /*
   * This update is atomic because it succeeds only while the
   * row is still queued. If another engine claimed it first,
   * Supabase returns no matching row.
   */
  const { data, error } = await supabase
    .from("campaign_prospects")
    .update({
      outreach_status: "releasing",
      release_claim_token: claimToken,
      release_claimed_at: claimedAt,
    })
    .eq("id", campaignProspectId)
    .eq("campaign_id", campaignId)
    .eq("review_status", "approved")
    .eq("outreach_status", "queued")
    .is("release_claim_token", null)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to claim campaign prospect: ${error.message}`
    );
  }

  return Boolean(data);
}

async function returnDryRunClaimToQueue({
  campaignId,
  campaignProspectId,
  claimToken,
}: {
  campaignId: string;
  campaignProspectId: string;
  claimToken: string;
}): Promise<boolean> {
  /*
   * The claim token prevents this engine from returning a row
   * owned by another invocation.
   */
  const { data, error } = await supabase
    .from("campaign_prospects")
    .update({
      outreach_status: "queued",
      release_claim_token: null,
      release_claimed_at: null,
    })
    .eq("id", campaignProspectId)
    .eq("campaign_id", campaignId)
    .eq("outreach_status", "releasing")
    .eq("release_claim_token", claimToken)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to return dry-run claim to queue: ${error.message}`
    );
  }

  return Boolean(data);
}

async function stopClaimedProspect({
  campaignId,
  campaignProspectId,
  claimToken,
  stopReason,
  stoppedAt,
}: {
  campaignId: string;
  campaignProspectId: string;
  claimToken: string;
  stopReason: string;
  stoppedAt: string;
}): Promise<boolean> {
  const { data, error } = await supabase
    .from("campaign_prospects")
    .update({
      outreach_status: "stopped",
      stop_reason: stopReason,
      decision_reason:
        `Acquisition stopped: ${stopReason}.`,
      automation_stopped_at: stoppedAt,
      release_claim_token: null,
      release_claimed_at: null,
      next_attempt_at: null,
      release_error_code: null,
      release_error_message: null,
    })
    .eq("id", campaignProspectId)
    .eq("campaign_id", campaignId)
    .eq("outreach_status", "releasing")
    .eq("release_claim_token", claimToken)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to stop claimed prospect: ${error.message}`
    );
  }

  return Boolean(data);
}

async function upsertCreatorRelationship({
  prospectId,
  customerId,
  campaignId,
  campaignProspectId,
  relationshipReason,
  matchedAt,
}: {
  prospectId: string;
  customerId: string | null;
  campaignId: string;
  campaignProspectId: string;
  relationshipReason: string;
  matchedAt: string | null;
}) {
  const activityAt = matchedAt || new Date().toISOString();

  const { data, error } = await supabase
    .from("creator_relationships")
    .upsert(
      {
        prospect_id: prospectId,
        customer_id: customerId,
        relationship_type: "creator",
        relationship_stage: "follow_up",
        follow_up_status: "not_started",
        source_campaign_id: campaignId,
        source_campaign_prospect_id:
          campaignProspectId,
        relationship_reason: relationshipReason,
        became_customer_at: matchedAt,
        last_activity_at: activityAt,
      },
      {
        onConflict: "prospect_id,relationship_type",
      }
    )
    .select(
      `
        id,
        prospect_id,
        customer_id,
        relationship_type,
        relationship_stage,
        follow_up_status
      `
    )
    .single();

  if (error) {
    throw new Error(
      `Unable to upsert creator relationship: ${error.message}`
    );
  }

  return data;
}

async function writeClaimEvent({
  engineRunId,
  campaignId,
  campaignProspectId,
  prospectId,
  eventType,
  decisionCode,
  decisionReason,
  claimToken,
}: {
  engineRunId: string;
  campaignId: string;
  campaignProspectId: string;
  prospectId: string;
  eventType:
    | "campaign.prospect_claimed"
    | "campaign.prospect_claim_released"
    | "campaign.prospect_claim_failed";
  decisionCode: string;
  decisionReason: string;
  claimToken: string;
}) {
  const { error } = await supabase
    .from("campaign_events")
    .insert({
      campaign_id: campaignId,
      campaign_prospect_id: campaignProspectId,
      prospect_id: prospectId,
      source_system: "growth_engine",
      event_type: eventType,
      decision_code: decisionCode,
      decision_source: "release_engine",
      engine_run_id: engineRunId,
      event_data: {
        dry_run: true,
        engine_name: ENGINE_NAME,
        engine_version: ENGINE_VERSION,
        claim_token: claimToken,
        decision_reason: decisionReason,
        occurred_at: new Date().toISOString(),
      },
    });

  if (error) {
    throw new Error(
      `Unable to write ${eventType}: ${error.message}`
    );
  }
}

async function writeCustomerTransitionEvent({
  engineRunId,
  campaignId,
  campaignProspectId,
  prospectId,
  eventType,
  decisionCode,
  decisionReason,
  eventData,
}: {
  engineRunId: string;
  campaignId: string;
  campaignProspectId: string;
  prospectId: string;
  eventType:
    | "campaign.prospect_existing_customer_detected"
    | "campaign.prospect_stopped"
    | "creator.relationship_upserted";
  decisionCode: string;
  decisionReason: string;
  eventData: Record<string, unknown>;
}) {
  const { error } = await supabase
    .from("campaign_events")
    .insert({
      campaign_id: campaignId,
      campaign_prospect_id: campaignProspectId,
      prospect_id: prospectId,
      source_system: "growth_engine",
      event_type: eventType,
      decision_code: decisionCode,
      decision_source: "release_engine",
      engine_run_id: engineRunId,
      event_data: {
        dry_run_delivery: true,
        engine_name: ENGINE_NAME,
        engine_version: ENGINE_VERSION,
        decision_reason: decisionReason,
        occurred_at: new Date().toISOString(),
        ...eventData,
      },
    });

  if (error) {
    throw new Error(
      `Unable to write ${eventType}: ${error.message}`
    );
  }
}

async function evaluateCampaign({
  engineRunId,
  campaign,
  now,
}: {
  engineRunId: string;
  campaign: GrowthCampaignRow;
  now: Date;
}): Promise<CampaignSummary> {
  const zonedNow = getZonedDateTimeParts(
    now,
    campaign.campaign_timezone
  );

  const insideWindow = isInsideSendWindow({
    currentMinutes: zonedNow.minutesSinceMidnight,
    startTime: campaign.send_window_start,
    endTime: campaign.send_window_end,
  });

  const releasedToday = await countReleasedToday({
    campaignId: campaign.id,
    campaignTimezone: campaign.campaign_timezone,
    localDate: zonedNow.dateKey,
    now,
  });

  const remainingToday = Math.max(
    campaign.daily_send_limit - releasedToday,
    0
  );

  const latestReleaseAt = await getLatestReleaseAt(
    campaign.id
  );

  let intervalElapsed = true;

  if (latestReleaseAt) {
    const latestRelease = new Date(latestReleaseAt);

    if (!Number.isNaN(latestRelease.getTime())) {
      const nextAllowedAt =
        latestRelease.getTime() +
        campaign.release_interval_minutes * 60 * 1000;

      intervalElapsed = now.getTime() >= nextAllowedAt;
    }
  }

  const { data: queueRows, error: queueError } =
    await supabase
      .from("campaign_prospects")
      .select(
        `
          id,
          campaign_id,
          prospect_id,
          review_status,
          outreach_status,
          queued_at,
          created_at,
          released_at,
          release_attempted_at,
          release_attempt_count,
          next_attempt_at,
          tracking_token
        `
      )
      .eq("campaign_id", campaign.id)
      .eq("review_status", "approved")
      .eq("outreach_status", "queued")
      .or(
        `next_attempt_at.is.null,next_attempt_at.lte.${now.toISOString()}`
      )
      .order("queued_at", {
        ascending: true,
        nullsFirst: false,
      })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(MAX_QUEUE_ROWS_PER_CAMPAIGN);

  if (queueError) {
    throw new Error(
      `Unable to load the campaign queue: ${queueError.message}`
    );
  }

  const memberships =
    (queueRows ?? []) as CampaignProspectRow[];

  const decisions: CampaignDecision[] = [];

  if (
    !insideWindow ||
    remainingToday <= 0 ||
    !intervalElapsed ||
    memberships.length === 0
  ) {
    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      campaignCode: campaign.campaign_code,
      status: campaign.status,
      insideSendWindow: insideWindow,
      localDate: zonedNow.dateKey,
      localTime: zonedNow.timeLabel,
      dailyLimit: campaign.daily_send_limit,
      releasedToday,
      remainingToday,
      intervalMinutes:
        campaign.release_interval_minutes,
      intervalElapsed,
      queuedCount: memberships.length,
      evaluatedCount: 0,
      wouldReleaseCount: 0,
      atomicClaims: 0,
      stoppedCount: 0,
      decisions,
    };
  }

  const prospectIds = Array.from(
    new Set(
      memberships.map(
        (membership) => membership.prospect_id
      )
    )
  );

  const { data: prospectRows, error: prospectError } =
    await supabase
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
      .in("id", prospectIds);

  if (prospectError) {
    throw new Error(
      `Unable to load queued prospects: ${prospectError.message}`
    );
  }

  const prospects = (prospectRows ?? []) as ProspectRow[];

  const prospectById = new Map(
    prospects.map((prospect) => [
      prospect.id,
      prospect,
    ])
  );

  /*
   * The engine evaluates queued prospects until it finds one
   * releasable candidate. Existing customers may be permanently
   * stopped, but no email is delivered during Commit 3.
   */
  for (const membership of memberships) {
  const prospect = prospectById.get(
    membership.prospect_id
  );

  let decisionCode = "";
  let decisionReason = "";
  let wouldRelease = false;
  let atomicClaimed = false;
  let stopped = false;
  let email = "";

  if (!prospect) {
    decisionCode = "prospect_not_found";
    decisionReason =
      "The campaign membership has no associated prospect record.";
  } else {
    email = normalizeEmail(prospect.email);

    const marketingStatus =
      normalizeText(prospect.marketing_status) ||
      "eligible";

    if (!isValidEmail(email)) {
      decisionCode = "invalid_email";
      decisionReason =
        "The prospect does not have a valid email address.";
    } else if (marketingStatus !== "eligible") {
      decisionCode = "marketing_ineligible";
      decisionReason =
        `Marketing status is ${marketingStatus}.`;
    } else if (
      membership.release_attempt_count >=
      campaign.max_release_attempts
    ) {
      decisionCode = "maximum_attempts_reached";
      decisionReason =
        `The prospect has reached the maximum of ` +
        `${campaign.max_release_attempts} release attempts.`;
    } else if (await isSuppressed(email)) {
      decisionCode = "globally_suppressed";
      decisionReason =
        "The normalized email exists in marketing_suppressions.";
    } else {
      const claimToken = randomUUID();
      const claimedAt = new Date().toISOString();

      atomicClaimed = await claimCampaignProspect({
        campaignId: campaign.id,
        campaignProspectId: membership.id,
        claimToken,
        claimedAt,
      });

      if (!atomicClaimed) {
        decisionCode = "atomic_claim_failed";
        decisionReason =
          "Another engine invocation claimed the prospect first.";

        await writeClaimEvent({
          engineRunId,
          campaignId: campaign.id,
          campaignProspectId: membership.id,
          prospectId: membership.prospect_id,
          eventType: "campaign.prospect_claim_failed",
          decisionCode,
          decisionReason,
          claimToken,
        });
      } else {
        await writeClaimEvent({
          engineRunId,
          campaignId: campaign.id,
          campaignProspectId: membership.id,
          prospectId: membership.prospect_id,
          eventType: "campaign.prospect_claimed",
          decisionCode: "atomic_claim_success",
          decisionReason:
            "The prospect was claimed exclusively.",
          claimToken,
        });

        const customerMatch =
          await findExistingCustomer(email);

        if (
          customerMatch.found &&
          customerMatch.reason
        ) {
          decisionCode = customerMatch.reason;
          decisionReason =
            `Acquisition stopped because the email matched ` +
            `${customerMatch.matchedSource}.`;

          await writeCustomerTransitionEvent({
            engineRunId,
            campaignId: campaign.id,
            campaignProspectId: membership.id,
            prospectId: membership.prospect_id,
            eventType:
              "campaign.prospect_existing_customer_detected",
            decisionCode,
            decisionReason,
            eventData: {
              email,
              matched_source:
                customerMatch.matchedSource,
              matched_at: customerMatch.matchedAt,
              customer_id:
                customerMatch.customerId,
            },
          });

          const relationship =
            await upsertCreatorRelationship({
              prospectId: membership.prospect_id,
              customerId: customerMatch.customerId,
              campaignId: campaign.id,
              campaignProspectId: membership.id,
              relationshipReason:
                customerMatch.reason,
              matchedAt: customerMatch.matchedAt,
            });

          await writeCustomerTransitionEvent({
            engineRunId,
            campaignId: campaign.id,
            campaignProspectId: membership.id,
            prospectId: membership.prospect_id,
            eventType:
              "creator.relationship_upserted",
            decisionCode:
              "creator_relationship_follow_up",
            decisionReason:
              "The creator was placed into the general follow-up relationship stage.",
            eventData: {
              creator_relationship_id:
                relationship.id,
              relationship_type:
                relationship.relationship_type,
              relationship_stage:
                relationship.relationship_stage,
              follow_up_status:
                relationship.follow_up_status,
              customer_id:
                relationship.customer_id,
            },
          });

          const stoppedAt =
            new Date().toISOString();

          const stopSucceeded =
            await stopClaimedProspect({
              campaignId: campaign.id,
              campaignProspectId: membership.id,
              claimToken,
              stopReason: customerMatch.reason,
              stoppedAt,
            });

          if (!stopSucceeded) {
            throw new Error(
              "The claimed existing customer could not be safely stopped."
            );
          }

          stopped = true;

          await writeCustomerTransitionEvent({
            engineRunId,
            campaignId: campaign.id,
            campaignProspectId: membership.id,
            prospectId: membership.prospect_id,
            eventType: "campaign.prospect_stopped",
            decisionCode:
              customerMatch.reason,
            decisionReason,
            eventData: {
              email,
              stop_reason:
                customerMatch.reason,
              stopped_at: stoppedAt,
              creator_relationship_id:
                relationship.id,
            },
          });
        } else {
          decisionCode = "atomic_claim_success";
          decisionReason =
            "The prospect was claimed exclusively and would be released.";

          wouldRelease = true;

          const returnedToQueue =
            await returnDryRunClaimToQueue({
              campaignId: campaign.id,
              campaignProspectId: membership.id,
              claimToken,
            });

          if (!returnedToQueue) {
            throw new Error(
              "The dry-run claim could not be safely returned to the queue."
            );
          }

          await writeClaimEvent({
            engineRunId,
            campaignId: campaign.id,
            campaignProspectId: membership.id,
            prospectId: membership.prospect_id,
            eventType:
              "campaign.prospect_claim_released",
            decisionCode:
              "dry_run_claim_released",
            decisionReason:
              "The releasable dry-run claim was safely returned to the queue.",
            claimToken,
          });
        }
      }
    }
  }

  const decision: CampaignDecision = {
    campaignId: campaign.id,
    campaignName: campaign.name,
    campaignProspectId: membership.id,
    prospectId: membership.prospect_id,
    email: email || undefined,
    decisionCode,
    decisionReason,
    wouldRelease,
    atomicClaimed,
    stopped,
  };

  decisions.push(decision);

  await writeEvaluationEvent({
    engineRunId,
    campaignId: campaign.id,
    campaignProspectId: membership.id,
    prospectId: membership.prospect_id,
    decisionCode,
    decisionReason,
    eventData: {
      email: email || null,
      queue_position_evaluated:
        decisions.length,
      release_attempt_count:
        membership.release_attempt_count,
      max_release_attempts:
        campaign.max_release_attempts,
      next_attempt_at:
        membership.next_attempt_at,
      would_release: wouldRelease,
      atomic_claimed: atomicClaimed,
      stopped,
    },
  });

  /*
   * Existing customers are stopped, then evaluation continues
   * until one genuinely releasable prospect is identified.
   */
  if (wouldRelease) {
    break;
  }
}

return {
  campaignId: campaign.id,
  campaignName: campaign.name,
  campaignCode: campaign.campaign_code,
  status: campaign.status,
  insideSendWindow: insideWindow,
  localDate: zonedNow.dateKey,
  localTime: zonedNow.timeLabel,
  dailyLimit: campaign.daily_send_limit,
  releasedToday,
  remainingToday,
  intervalMinutes: campaign.release_interval_minutes,
  intervalElapsed,
  queuedCount: memberships.length,
  evaluatedCount: decisions.length,
  wouldReleaseCount: decisions.filter(
    (decision) => decision.wouldRelease
  ).length,
  atomicClaims: decisions.filter(
    (decision) => decision.atomicClaimed
  ).length,
  stoppedCount: decisions.filter(
    (decision) => decision.stopped
  ).length,
  decisions,
};
}


async function runDryReleaseEngine() {
  const startedAt = new Date();
  const gitCommit = getGitCommit();

  const { data: engineRun, error: runInsertError } =
    await supabase
      .from("release_engine_runs")
      .insert({
        started_at: startedAt.toISOString(),
        status: "running",
        engine_name: ENGINE_NAME,
        engine_version: ENGINE_VERSION,
        git_commit: gitCommit,
        result_summary: {
          dry_run: true,
        },
      })
      .select("id")
      .single();

  if (runInsertError || !engineRun) {
    throw new Error(
      runInsertError?.message ||
        "Unable to create the Release Engine run."
    );
  }

  const engineRunId = engineRun.id as string;

  try {
    const { data: campaignRows, error: campaignError } =
      await supabase
        .from("growth_campaigns")
        .select(
          `
            id,
            name,
            campaign_code,
            status,
            daily_send_limit,
            release_interval_minutes,
            send_window_start,
            send_window_end,
            campaign_timezone,
            max_release_attempts
          `
        )
        .eq("status", "active")
        .order("created_at", { ascending: true });

    if (campaignError) {
      throw new Error(
        `Unable to load active campaigns: ${campaignError.message}`
      );
    }

    const campaigns =
      (campaignRows ?? []) as GrowthCampaignRow[];

    const campaignSummaries: CampaignSummary[] = [];

    for (const campaign of campaigns) {
      const summary = await evaluateCampaign({
        engineRunId,
        campaign,
        now: startedAt,
      });

      campaignSummaries.push(summary);
    }

    const prospectsEvaluated =
      campaignSummaries.reduce(
        (total, campaign) =>
          total + campaign.evaluatedCount,
        0
      );

    const prospectsWouldRelease =
      campaignSummaries.reduce(
        (total, campaign) =>
          total + campaign.wouldReleaseCount,
        0
      );

    const atomicClaims =
      campaignSummaries.reduce(
        (total, campaign) =>
          total + campaign.atomicClaims,
        0
      );

    const prospectsStopped =
      campaignSummaries.reduce(
        (total, campaign) =>
          total + campaign.stoppedCount,
        0
      );

    const completedAt = new Date();

    const resultSummary = {
      dry_run: true,
      engine_run_id: engineRunId,
      engine_name: ENGINE_NAME,
      engine_version: ENGINE_VERSION,
      git_commit: gitCommit,
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      campaigns_checked: campaigns.length,
      prospects_evaluated: prospectsEvaluated,
      prospects_would_release:
        prospectsWouldRelease,
      atomic_claims: atomicClaims,
      prospects_stopped: prospectsStopped,
      prospects_released: 0,
      campaigns: campaignSummaries,
    };

    const { error: runUpdateError } = await supabase
      .from("release_engine_runs")
      .update({
        completed_at: completedAt.toISOString(),
        status: "completed",
        campaigns_checked: campaigns.length,
        prospects_evaluated: prospectsEvaluated,
        atomic_claims: atomicClaims,
        prospects_stopped: prospectsStopped,
        prospects_released: 0,
        prospects_failed: 0,
        result_summary: resultSummary,
        error_message: null,
      })
      .eq("id", engineRunId);

    if (runUpdateError) {
      throw new Error(
        `Unable to finish the engine run: ${runUpdateError.message}`
      );
    }

    return resultSummary;
  } catch (error) {
    const completedAt = new Date();
    const message =
      error instanceof Error
        ? error.message
        : "Unknown Release Engine error.";

    const { error: failureUpdateError } = await supabase
      .from("release_engine_runs")
      .update({
        completed_at: completedAt.toISOString(),
        status: "failed",
        error_message: message,
        result_summary: {
          dry_run: true,
          engine_run_id: engineRunId,
          error: message,
        },
      })
      .eq("id", engineRunId);

    if (failureUpdateError) {
      console.error(
        "Unable to record the failed engine run:",
        failureUpdateError
      );
    }

    throw error;
  }
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        error: "Unauthorized.",
      },
      {
        status: 401,
      }
    );
  }

  try {
    const result = await runDryReleaseEngine();

    return NextResponse.json(result, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(
      "Release Engine dry run failed:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Release Engine dry run failed.",
        dry_run: true,
      },
      {
        status: 500,
      }
    );
  }
}