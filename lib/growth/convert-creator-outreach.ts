import { supabase } from "@/lib/supabase";

const DEFAULT_RESEND_CONVERTED_EVENT =
  "creator.outreach.converted";

export type CreatorConversionReason =
  "first_session_started";

type ConvertCreatorOutreachInput = {
  email: string;
  reason: CreatorConversionReason;
  customerId?: string | null;
  sourceId?: string | null;
};

type CampaignProspectRow = {
  id: string;
  campaign_id: string;
  prospect_id: string;
  outreach_status: string | null;
};

function normalizeEmail(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

async function emitConvertedEvent({
  email,
  reason,
  campaignId,
  campaignProspectId,
  prospectId,
  sourceId,
  convertedAt,
}: {
  email: string;
  reason: CreatorConversionReason;
  campaignId: string;
  campaignProspectId: string;
  prospectId: string;
  sourceId: string | null;
  convertedAt: string;
}) {
  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  const eventName =
    process.env.RESEND_CREATOR_CONVERTED_EVENT?.trim() ||
    DEFAULT_RESEND_CONVERTED_EVENT;

  const response = await fetch(
    "https://api.resend.com/events/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key":
          `growth-conversion/${campaignProspectId}/${reason}`,
      },
      body: JSON.stringify({
        event: eventName,
        email,
        payload: {
          conversion_reason: reason,
          campaign_id: campaignId,
          campaign_prospect_id: campaignProspectId,
          prospect_id: prospectId,
          source_id: sourceId,
          converted_at: convertedAt,
        },
      }),
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    }
  );

  let responseBody: Record<string, unknown> | null = null;

  try {
    responseBody =
      (await response.json()) as Record<string, unknown>;
  } catch {
    responseBody = null;
  }

  if (!response.ok) {
    throw new Error(
      `Resend conversion event failed with status ${response.status}: ` +
        JSON.stringify(responseBody)
    );
  }

  return responseBody;
}

export async function convertCreatorOutreach({
  email,
  reason,
  customerId = null,
  sourceId = null,
}: ConvertCreatorOutreachInput) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return {
      converted: false,
      reason: "missing_email",
      membershipsConverted: 0,
    };
  }

  const convertedAt = new Date().toISOString();

  /*
   * Find every prospect identity using this email. Using all matching
   * records prevents an older import from continuing outreach.
   */
  const { data: prospects, error: prospectError } =
    await supabase
      .from("prospects")
      .select("id, email")
      .ilike("email", normalizedEmail);

  if (prospectError) {
    throw new Error(
      `Unable to find creator prospect: ${prospectError.message}`
    );
  }

  const prospectIds = (prospects ?? []).map(
    (prospect) => prospect.id as string
  );

  if (prospectIds.length === 0) {
    return {
      converted: false,
      reason: "prospect_not_found",
      membershipsConverted: 0,
    };
  }

  /*
   * Convert only outreach journeys that have begun. Queued contacts
   * continue to be handled by the Release Engine's customer check.
   */
  const { data: memberships, error: membershipError } =
    await supabase
      .from("campaign_prospects")
      .select(
        "id, campaign_id, prospect_id, outreach_status"
      )
      .in("prospect_id", prospectIds)
      .in("outreach_status", [
        "released",
        "releasing",
        "active",
      ]);

  if (membershipError) {
    throw new Error(
      `Unable to find active creator outreach: ${membershipError.message}`
    );
  }

  const rows =
    (memberships ?? []) as CampaignProspectRow[];

  let membershipsConverted = 0;

  for (const membership of rows) {
    /*
     * Notify Resend first. If the external call fails, the database
     * remains eligible for another idempotent attempt on a later
     * session or purchase.
     */
    await emitConvertedEvent({
      email: normalizedEmail,
      reason,
      campaignId: membership.campaign_id,
      campaignProspectId: membership.id,
      prospectId: membership.prospect_id,
      sourceId,
      convertedAt,
    });

    const { data: updatedMembership, error: updateError } =
      await supabase
        .from("campaign_prospects")
        .update({
          outreach_status: "converted",
          stop_reason: reason,
          decision_reason:
            `Creator outreach converted: ${reason}.`,
          automation_stopped_at: convertedAt,
          release_claim_token: null,
          release_claimed_at: null,
          next_attempt_at: null,
          release_error_code: null,
          release_error_message: null,
        })
        .eq("id", membership.id)
        .eq("campaign_id", membership.campaign_id)
        .in("outreach_status", [
          "released",
          "releasing",
          "active",
        ])
        .select("id")
        .maybeSingle();

    if (updateError) {
      throw new Error(
        `Unable to convert campaign prospect: ${updateError.message}`
      );
    }

    /*
     * Another idempotent invocation may already have converted it.
     */
    if (!updatedMembership) {
      continue;
    }

    const { error: relationshipError } =
      await supabase
        .from("creator_relationships")
        .upsert(
          {
            prospect_id: membership.prospect_id,
            customer_id: customerId,
            relationship_type: "creator",
            relationship_stage: "follow_up",
            follow_up_status: "not_started",
            source_campaign_id: membership.campaign_id,
            source_campaign_prospect_id: membership.id,
            relationship_reason: reason,
            became_customer_at: null,
            last_activity_at: convertedAt,
          },
          {
            onConflict:
              "prospect_id,relationship_type",
          }
        );

    if (relationshipError) {
      throw new Error(
        `Unable to create creator follow-up relationship: ` +
          relationshipError.message
      );
    }

    const { error: eventError } = await supabase
      .from("campaign_events")
      .insert({
        campaign_id: membership.campaign_id,
        campaign_prospect_id: membership.id,
        prospect_id: membership.prospect_id,
        source_system: "growth_engine",
        event_type: "campaign.prospect_converted",
        decision_code: reason,
        decision_source: "conversion_service",
        event_data: {
          email: normalizedEmail,
          conversion_reason: reason,
          customer_id: customerId,
          source_id: sourceId,
          converted_at: convertedAt,
          resend_event:
            process.env.RESEND_CREATOR_CONVERTED_EVENT ||
            DEFAULT_RESEND_CONVERTED_EVENT,
        },
      });

    if (eventError) {
      throw new Error(
        `Unable to write conversion audit event: ${eventError.message}`
      );
    }

    membershipsConverted += 1;
  }

  return {
    converted: membershipsConverted > 0,
    reason,
    membershipsConverted,
  };
}
