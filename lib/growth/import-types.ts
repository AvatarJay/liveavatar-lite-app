export type ReviewStatus = "approved" | "hold" | "rejected";

export type CampaignOption = {
  id: string;
  name: string;
  campaign_code: string;
  status: string;
  source_tool: string | null;
  hypothesis: string | null;
  description: string | null;
  targeting_criteria: Record<string, unknown>;
  shopify_promo_code: string | null;
  daily_send_limit: number;
};

export type ImportedContact = {
  rowNumber: number;

  email: string;
  alternateEmails: string[];

  displayName: string;
  greetingName: string;
  firstName: string;
  lastName: string;

  platform: string;
  username: string;
  profileUrl: string;

  followerCount: number | null;
  followingCount: number | null;
  mediaCount: number | null;

  engagementRate: number | null;
  medianLikes: number | null;
  medianComments: number | null;
  medianVideoViews: number | null;

  biography: string;
  websiteUrl: string;
  postingLocation: string;
  topHashtags: string[];

  notes: string;
  isPrivate: boolean | null;

  reviewStatus: ReviewStatus;
  decisionReason: string;

  needsReview: boolean;
  reviewResolved: boolean;
  validationErrors: string[];

  rawSourceData: Record<string, unknown>;
};

export type ImportCommitRequest = {
  campaignId: string;
  source: string;
  contacts: ImportedContact[];
};

export type ImportCommitResult = {
  totalRows: number;
  createdProspects: number;
  updatedProspects: number;
  createdCampaignMemberships: number;
  existingCampaignMemberships: number;
  approved: number;
  held: number;
  rejected: number;
  invalid: number;
  errors: Array<{
    rowNumber: number;
    email: string;
    message: string;
  }>;
};