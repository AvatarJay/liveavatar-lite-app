import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type {
  ImportCommitRequest,
  ImportCommitResult,
  ImportedContact,
} from "@/lib/growth/import-types";

export const runtime = "nodejs";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function safeInteger(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function safeNumber(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return value;
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function buildProspectPayload(
  contact: ImportedContact,
  source: string
) {
  const displayName = normalizeText(contact.displayName);

  // Greeting name is allowed to contain one name, multiple names,
  // or a channel/brand name. Fall back to display name when blank.
  const greetingName =
    normalizeText(contact.greetingName) ?? displayName;

  return {
    email: normalizeEmail(contact.email),

    display_name: displayName,
    greeting_name: greetingName,
    first_name: normalizeText(contact.firstName),
    last_name: normalizeText(contact.lastName),

    prospect_type: "influencer",
    source,

    platform: normalizeText(contact.platform),
    username: normalizeText(contact.username),
    profile_url: normalizeText(contact.profileUrl),

    follower_count: safeInteger(contact.followerCount),
    following_count: safeInteger(contact.followingCount),
    media_count: safeInteger(contact.mediaCount),

    engagement_rate: safeNumber(contact.engagementRate),
    median_likes: safeNumber(contact.medianLikes),
    median_comments: safeNumber(contact.medianComments),
    median_video_views: safeNumber(contact.medianVideoViews),

    biography: normalizeText(contact.biography),
    website_url: normalizeText(contact.websiteUrl),
    posting_location: normalizeText(contact.postingLocation),

    top_hashtags: contact.topHashtags,
    alternate_emails: contact.alternateEmails,
    raw_source_data: contact.rawSourceData,

    marketing_status: "eligible",
    notes: normalizeText(contact.notes),
  };
}

export async function POST(request: NextRequest) {
  const result: ImportCommitResult = {
    totalRows: 0,
    createdProspects: 0,
    updatedProspects: 0,
    createdCampaignMemberships: 0,
    existingCampaignMemberships: 0,
    approved: 0,
    held: 0,
    rejected: 0,
    invalid: 0,
    errors: [],
  };

  try {
    const body = (await request.json()) as ImportCommitRequest;

    if (!body.campaignId) {
      return NextResponse.json(
        { error: "A campaign must be selected." },
        { status: 400 }
      );
    }

    if (!Array.isArray(body.contacts) || body.contacts.length === 0) {
      return NextResponse.json(
        { error: "No contacts were provided." },
        { status: 400 }
      );
    }

    const source = body.source?.trim() || "CSV";
    result.totalRows = body.contacts.length;

    const { data: campaign, error: campaignError } = await supabase
      .from("growth_campaigns")
      .select("id, shopify_promo_code")
      .eq("id", body.campaignId)
      .single();

    if (campaignError || !campaign) {
      return NextResponse.json(
        { error: "The selected campaign was not found." },
        { status: 404 }
      );
    }

    for (const contact of body.contacts) {
      if (contact.reviewStatus === "approved") {
        result.approved += 1;
      }

      if (contact.reviewStatus === "hold") {
        result.held += 1;
      }

      if (contact.reviewStatus === "rejected") {
        result.rejected += 1;
      }

      if (
        contact.validationErrors.length > 0 ||
        !contact.email.trim()
      ) {
        result.invalid += 1;

        result.errors.push({
          rowNumber: contact.rowNumber,
          email: contact.email,
          message:
            contact.validationErrors.join(" ") ||
            "The contact does not have a valid email.",
        });

        continue;
      }

      const normalizedEmail = normalizeEmail(contact.email);

      const { data: existingProspect, error: lookupError } =
        await supabase
          .from("prospects")
          .select("id")
          .ilike("email", normalizedEmail)
          .maybeSingle();

      if (lookupError) {
        result.errors.push({
          rowNumber: contact.rowNumber,
          email: normalizedEmail,
          message: lookupError.message,
        });

        continue;
      }

      let prospectId: string;

      if (existingProspect) {
        const { error: updateError } = await supabase
          .from("prospects")
          .update(buildProspectPayload(contact, source))
          .eq("id", existingProspect.id);

        if (updateError) {
          result.errors.push({
            rowNumber: contact.rowNumber,
            email: normalizedEmail,
            message: updateError.message,
          });

          continue;
        }

        prospectId = existingProspect.id;
        result.updatedProspects += 1;
      } else {
        const { data: createdProspect, error: insertError } =
          await supabase
            .from("prospects")
            .insert(buildProspectPayload(contact, source))
            .select("id")
            .single();

        if (insertError || !createdProspect) {
          result.errors.push({
            rowNumber: contact.rowNumber,
            email: normalizedEmail,
            message:
              insertError?.message ||
              "Unable to create prospect.",
          });

          continue;
        }

        prospectId = createdProspect.id;
        result.createdProspects += 1;
      }

      const {
        data: existingMembership,
        error: membershipLookupError,
      } = await supabase
        .from("campaign_prospects")
        .select("id")
        .eq("campaign_id", body.campaignId)
        .eq("prospect_id", prospectId)
        .maybeSingle();

      if (membershipLookupError) {
        result.errors.push({
          rowNumber: contact.rowNumber,
          email: normalizedEmail,
          message: membershipLookupError.message,
        });

        continue;
      }

      const membershipPayload = {
        review_status: contact.reviewStatus,
        outreach_status: "not_started",

        decision_reason:
          normalizeText(contact.decisionReason),
        import_source: source,
        source_row_number: contact.rowNumber,

        promo_code: campaign.shopify_promo_code,

        approved_at:
          contact.reviewStatus === "approved"
            ? new Date().toISOString()
            : null,

        rejected_at:
          contact.reviewStatus === "rejected"
            ? new Date().toISOString()
            : null,

        reviewed_by: "Jay",
      };

      let campaignProspectId: string;

      if (existingMembership) {
        const { error: updateMembershipError } = await supabase
          .from("campaign_prospects")
          .update(membershipPayload)
          .eq("id", existingMembership.id);

        if (updateMembershipError) {
          result.errors.push({
            rowNumber: contact.rowNumber,
            email: normalizedEmail,
            message: updateMembershipError.message,
          });

          continue;
        }

        campaignProspectId = existingMembership.id;
        result.existingCampaignMemberships += 1;
      } else {
        const {
          data: createdMembership,
          error: createMembershipError,
        } = await supabase
          .from("campaign_prospects")
          .insert({
            campaign_id: body.campaignId,
            prospect_id: prospectId,
            ...membershipPayload,
          })
          .select("id")
          .single();

        if (createMembershipError || !createdMembership) {
          result.errors.push({
            rowNumber: contact.rowNumber,
            email: normalizedEmail,
            message:
              createMembershipError?.message ||
              "Unable to create campaign membership.",
          });

          continue;
        }

        campaignProspectId = createdMembership.id;
        result.createdCampaignMemberships += 1;
      }

      const { error: eventError } = await supabase
        .from("campaign_events")
        .insert({
          campaign_id: body.campaignId,
          prospect_id: prospectId,
          campaign_prospect_id: campaignProspectId,
          source_system: "import",
          event_type: "contact.imported",
          event_data: {
            source,
            row_number: contact.rowNumber,
            review_status: contact.reviewStatus,
            decision_reason: contact.decisionReason,
            needs_review: contact.needsReview,
            review_resolved: contact.reviewResolved,
            display_name: contact.displayName,
            greeting_name:
              contact.greetingName?.trim() ||
              contact.displayName?.trim() ||
              null,
          },
        });

      if (eventError) {
        console.error(
          `Unable to create import event for ${normalizedEmail}:`,
          eventError
        );
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Contact import failed:", error);

    return NextResponse.json(
      { error: "Unexpected import failure." },
      { status: 500 }
    );
  }
}