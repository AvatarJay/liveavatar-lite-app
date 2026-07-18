import type {
  ImportedContact,
  ReviewStatus,
} from "@/lib/growth/import-types";

type CsvRow = Record<string, unknown>;

const INITIAL_REJECTIONS = [
  "bustronome",
  "itt van amerika",
  "jacob cruik",
];

function cleanString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function parseNumber(value: unknown): number | null {
  const cleaned = cleanString(value).replace(/[$,%\s,]/g, "");

  if (!cleaned) return null;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;

  const cleaned = cleanString(value).toLowerCase();

  if (!cleaned) return null;
  if (["true", "yes", "1"].includes(cleaned)) return true;
  if (["false", "no", "0"].includes(cleaned)) return false;

  return null;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function splitEmails(value: unknown): string[] {
  const raw = cleanString(value);

  if (!raw) return [];

  const matches =
    raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];

  return Array.from(
    new Set(matches.map((email) => email.trim().toLowerCase()))
  );
}

function splitList(value: unknown): string[] {
  const raw = cleanString(value);

  if (!raw) return [];

  return raw
    .split(/[,;\n|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function determineInitialDecision(
  displayName: string,
  username: string
): {
  status: ReviewStatus;
  reason: string;
} {
  const combined = `${displayName} ${username}`.toLowerCase();

  const rejectedMatch = INITIAL_REJECTIONS.find((name) =>
    combined.includes(name)
  );

  if (rejectedMatch) {
    return {
      status: "rejected",
      reason: "Outside campaign scope",
    };
  }

  return {
    status: "approved",
    reason: "Experimental inclusion",
  };
}

export function parseMightyScoutRows(rows: CsvRow[]): ImportedContact[] {
  return rows.map((row, index) => {
    const allEmails = splitEmails(row["Email"]);
    const email = allEmails[0] ?? "";
    const alternateEmails = allEmails.slice(1);

    const csvFirstName = cleanString(row["First Name"]);
    const username = cleanString(row["Username"]);

    const displayName =
      csvFirstName ||
      username ||
      email;

    const greetingName = displayName;

    const initialDecision = determineInitialDecision(
      displayName,
      username
    );

    const validationErrors: string[] = [];

    if (!email) {
      validationErrors.push("No email address was provided.");
    } else if (!isValidEmail(email)) {
      validationErrors.push("The primary email address is invalid.");
    }

    if (!cleanString(row["Platform"])) {
      validationErrors.push("Platform is missing.");
    }

    const hasMultipleEmails = alternateEmails.length > 0;
    const needsReview =
      hasMultipleEmails || validationErrors.length > 0;

    let reviewStatus = initialDecision.status;
    let decisionReason = initialDecision.reason;

    if (validationErrors.length > 0) {
      reviewStatus = "hold";
      decisionReason = "Missing or questionable data";
    } else if (hasMultipleEmails) {
      decisionReason = "Verify primary email";
    }

    return {
      rowNumber: index + 2,

      email,
      alternateEmails,

      displayName,
      greetingName,
      firstName: csvFirstName,
      lastName: cleanString(row["Last Name"]),

      platform: cleanString(row["Platform"]).toLowerCase(),
      username,
      profileUrl: cleanString(row["Link"]),

      followerCount: parseNumber(row["Follower Count"]),
      followingCount: parseNumber(row["Following Count"]),
      mediaCount: parseNumber(row["Media Count"]),

      engagementRate: parseNumber(row["Engagement %"]),
      medianLikes: parseNumber(row["Median Likes"]),
      medianComments: parseNumber(row["Median Comments"]),
      medianVideoViews: parseNumber(row["Median Video Views"]),

      biography: cleanString(row["Biography"]),
      websiteUrl: cleanString(row["External Link"]),
      postingLocation: cleanString(row["Posting Location"]),
      topHashtags: splitList(row["Top Hashtags"]),

      notes: cleanString(row["Notes"]),
      isPrivate: parseBoolean(row["Private Account"]),

      reviewStatus,
      decisionReason,

      needsReview,
      reviewResolved: !needsReview,
      validationErrors,

      rawSourceData: row,
    };
  });
}