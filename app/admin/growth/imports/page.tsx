"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import Papa from "papaparse";

import type {
  CampaignOption,
  ImportCommitResult,
  ImportedContact,
  ReviewStatus,
} from "@/lib/growth/import-types";

import { parseMightyScoutRows } from "@/lib/growth/mighty-scout-parser";

type CampaignResponse = {
  campaigns?: CampaignOption[];
  error?: string;
};

type ViewFilter =
  | "all"
  | "approved"
  | "hold"
  | "rejected"
  | "needs-review"
  | "multiple-emails"
  | "invalid";

const DECISION_REASONS: Record<ReviewStatus, string[]> = {
  approved: [
    "Strong campaign fit",
    "Experimental inclusion",
    "Priority creator",
    "Manually approved",
  ],
  hold: [
    "Multiple email addresses",
    "Verify primary email",
    "Review campaign fit",
    "Missing or questionable data",
    "Manual follow-up required",
  ],
  rejected: [
    "Outside campaign scope",
    "Wrong audience or platform",
    "Organization rather than creator",
    "Duplicate contact",
    "Invalid email",
    "Do not contact",
    "Other",
  ],
};

function formatNumber(value: number | null): string {
  if (value === null) return "—";

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatEngagement(value: number | null): string {
  if (value === null) return "—";
  return `${value}%`;
}

function getEngagementQuality(value: number | null) {
  if (value === null) {
    return {
      label: "Unknown",
      className: "text-zinc-500",
    };
  }

  if (value >= 5) {
    return {
      label: "Excellent",
      className: "text-green-400",
    };
  }

  if (value >= 1) {
    return {
      label: "Good",
      className: "text-blue-400",
    };
  }

  return {
    label: "Low",
    className: "text-amber-400",
  };
}

function getDecisionClasses(status: ReviewStatus) {
  if (status === "approved") {
    return "border-green-500/30 bg-green-500/10 text-green-300";
  }

  if (status === "hold") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  }

  return "border-red-500/30 bg-red-500/10 text-red-300";
}

function formatCriteriaValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (value === null || value === undefined || value === "") {
    return "—";
  }

  return String(value);
}

export default function ImportContactsPage() {
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [source, setSource] = useState("MightyScout");

  const [fileName, setFileName] = useState("");
  const [contacts, setContacts] = useState<ImportedContact[]>([]);

  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");

  const [loadingCampaigns, setLoadingCampaigns] = useState(true);

  const [parsingFile, setParsingFile] = useState(false);
  const [importing, setImporting] = useState(false);

  const [showConfirmation, setShowConfirmation] = useState(false);

  const [allowUnresolvedWarnings, setAllowUnresolvedWarnings] = useState(false);

  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportCommitResult | null>(null);

  useEffect(() => {
    async function loadCampaigns() {
      try {
        const response = await fetch("/api/growth/campaigns", {
          cache: "no-store",
        });

        const responseText = await response.text();

        let payload: CampaignResponse;

        try {
          payload = JSON.parse(responseText) as CampaignResponse;
        } catch {
          throw new Error(
            `Campaign API returned ${response.status} ${response.statusText} instead of JSON.`,
          );
        }

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load campaigns.");
        }

        const loadedCampaigns = payload.campaigns ?? [];

        setCampaigns(loadedCampaigns);

        if (loadedCampaigns.length > 0) {
          setCampaignId(loadedCampaigns[0].id);
        }
      } catch (campaignError) {
        setError(
          campaignError instanceof Error
            ? campaignError.message
            : "Unable to load campaigns.",
        );
      } finally {
        setLoadingCampaigns(false);
      }
    }

    void loadCampaigns();
  }, []);

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === campaignId) ?? null,
    [campaignId, campaigns],
  );

  const summary = useMemo(() => {
    return contacts.reduce(
      (totals, contact) => {
        totals.total += 1;
        totals[contact.reviewStatus] += 1;

        if (contact.needsReview && !contact.reviewResolved) {
          totals.needsReview += 1;
        }

        if (contact.alternateEmails.length > 0) {
          totals.multipleEmails += 1;
        }

        if (contact.validationErrors.length > 0) {
          totals.invalid += 1;
        }

        return totals;
      },
      {
        total: 0,
        approved: 0,
        hold: 0,
        rejected: 0,
        needsReview: 0,
        multipleEmails: 0,
        invalid: 0,
      },
    );
  }, [contacts]);

  const visibleContacts = useMemo(() => {
    if (viewFilter === "approved") {
      return contacts.filter((contact) => contact.reviewStatus === "approved");
    }

    if (viewFilter === "hold") {
      return contacts.filter((contact) => contact.reviewStatus === "hold");
    }

    if (viewFilter === "rejected") {
      return contacts.filter((contact) => contact.reviewStatus === "rejected");
    }

    if (viewFilter === "needs-review") {
      return contacts.filter(
        (contact) => contact.needsReview && !contact.reviewResolved,
      );
    }

    if (viewFilter === "multiple-emails") {
      return contacts.filter((contact) => contact.alternateEmails.length > 0);
    }

    if (viewFilter === "invalid") {
      return contacts.filter((contact) => contact.validationErrors.length > 0);
    }

    return contacts;
  }, [contacts, viewFilter]);

  function updateContact(rowNumber: number, update: Partial<ImportedContact>) {
    setContacts((current) =>
      current.map((contact) =>
        contact.rowNumber === rowNumber
          ? {
              ...contact,
              ...update,
            }
          : contact,
      ),
    );
  }

  function updateDecision(rowNumber: number, reviewStatus: ReviewStatus) {
    const defaultReason = DECISION_REASONS[reviewStatus][0];

    updateContact(rowNumber, {
      reviewStatus,
      decisionReason: defaultReason,
    });
  }

  function resolveReview(rowNumber: number) {
    updateContact(rowNumber, {
      reviewResolved: true,
    });
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) return;

    setError("");
    setResult(null);
    setContacts([]);
    setViewFilter("all");
    setFileName(file.name);
    setParsingFile(true);
    setAllowUnresolvedWarnings(false);

    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header) => header.trim(),

      complete: (parseResult) => {
        if (parseResult.errors.length > 0) {
          console.warn("CSV parsing warnings:", parseResult.errors);
        }

        const parsed = parseMightyScoutRows(parseResult.data);

        setContacts(parsed);
        setParsingFile(false);
      },

      error: (parseError) => {
        setError(parseError.message);
        setParsingFile(false);
      },
    });
  }

  async function commitImport() {
    setError("");
    setResult(null);
    setImporting(true);

    try {
      const response = await fetch("/api/growth/imports/commit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          campaignId,
          source,
          contacts,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to import contacts.");
      }

      setResult(payload as ImportCommitResult);
      setShowConfirmation(false);
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Unable to import contacts.",
      );
    } finally {
      setImporting(false);
    }
  }

  const importBlocked =
    !campaignId ||
    contacts.length === 0 ||
    summary.invalid > 0 ||
    (summary.needsReview > 0 && !allowUnresolvedWarnings);

  return (
    <main className="min-h-screen bg-black p-6 text-white">
      <div className="mx-auto max-w-[1600px]">
        <header className="mb-8">
          <p className="text-sm uppercase tracking-[0.25em] text-zinc-500">
            Chef-iT Growth Engine
          </p>

          <h1 className="mt-2 text-4xl font-bold">Import Contacts</h1>

          <p className="mt-3 max-w-3xl text-zinc-400">
            Upload a contact list, review every prospect, and assign them to a
            growth experiment.
          </p>
        </header>

        {error ? (
          <div className="mb-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-3">
          <label className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <span className="text-sm text-zinc-500">Experiment</span>

            <select
              value={campaignId}
              onChange={(event) => setCampaignId(event.target.value)}
              disabled={loadingCampaigns}
              className="mt-3 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white"
            >
              {loadingCampaigns ? (
                <option>Loading campaigns...</option>
              ) : campaigns.length === 0 ? (
                <option value="">No campaigns available</option>
              ) : (
                campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <span className="text-sm text-zinc-500">Source</span>

            <input
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="mt-3 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white"
            />
          </label>

          <label className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <span className="text-sm text-zinc-500">CSV file</span>

            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="mt-3 block w-full text-sm text-zinc-300 file:mr-4 file:rounded-xl file:border-0 file:bg-white file:px-4 file:py-3 file:font-semibold file:text-black"
            />

            <p className="mt-2 text-xs text-zinc-500">
              {fileName || "No file selected"}
            </p>
          </label>
        </section>

        {selectedCampaign ? (
          <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.2em] text-zinc-500">
                  Experiment context
                </p>

                <h2 className="mt-2 text-2xl font-bold">
                  {selectedCampaign.name}
                </h2>

                {selectedCampaign.hypothesis ? (
                  <p className="mt-3 max-w-4xl text-zinc-400">
                    {selectedCampaign.hypothesis}
                  </p>
                ) : null}
              </div>

              <div className="grid min-w-[280px] gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-zinc-900 p-4">
                  <p className="text-xs text-zinc-500">Promo code</p>
                  <p className="mt-1 font-semibold">
                    {selectedCampaign.shopify_promo_code || "Not assigned"}
                  </p>
                </div>

                <div className="rounded-xl bg-zinc-900 p-4">
                  <p className="text-xs text-zinc-500">Daily release</p>
                  <p className="mt-1 font-semibold">
                    {selectedCampaign.daily_send_limit}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(selectedCampaign.targeting_criteria ?? {})
                .filter(([key]) => !["rejected_initially"].includes(key))
                .map(([key, value]) => (
                  <div
                    key={key}
                    className="rounded-xl border border-zinc-800 bg-black p-4"
                  >
                    <p className="text-xs uppercase tracking-wide text-zinc-500">
                      {key.replaceAll("_", " ")}
                    </p>
                    <p className="mt-2 text-sm text-zinc-300">
                      {formatCriteriaValue(value)}
                    </p>
                  </div>
                ))}
            </div>
          </section>
        ) : null}

        {parsingFile ? (
          <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-400">
            Reading and validating CSV...
          </div>
        ) : null}

        {contacts.length > 0 ? (
          <>
            <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              {[
                {
                  label: "All prospects",
                  value: summary.total,
                  filter: "all" as ViewFilter,
                },
                {
                  label: "Approved",
                  value: summary.approved,
                  filter: "approved" as ViewFilter,
                },
                {
                  label: "Hold",
                  value: summary.hold,
                  filter: "hold" as ViewFilter,
                },
                {
                  label: "Rejected",
                  value: summary.rejected,
                  filter: "rejected" as ViewFilter,
                },
                {
                  label: "Needs review",
                  value: summary.needsReview,
                  filter: "needs-review" as ViewFilter,
                },
                {
                  label: "Multiple emails",
                  value: summary.multipleEmails,
                  filter: "multiple-emails" as ViewFilter,
                },
                {
                  label: "Invalid",
                  value: summary.invalid,
                  filter: "invalid" as ViewFilter,
                },
              ].map((card) => (
                <button
                  key={card.label}
                  type="button"
                  onClick={() => setViewFilter(card.filter)}
                  className={`rounded-2xl border p-5 text-left transition ${
                    viewFilter === card.filter
                      ? "border-white bg-white text-black"
                      : "border-zinc-800 bg-zinc-950 text-white hover:border-zinc-600"
                  }`}
                >
                  <p
                    className={`text-sm ${
                      viewFilter === card.filter
                        ? "text-zinc-600"
                        : "text-zinc-500"
                    }`}
                  >
                    {card.label}
                  </p>

                  <p className="mt-3 text-3xl font-bold">{card.value}</p>
                </button>
              ))}
            </section>

            <section className="mt-6 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
              <div className="flex flex-col gap-4 border-b border-zinc-800 p-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-xl font-bold">Review prospects</h2>

                  <p className="mt-1 text-sm text-zinc-500">
                    Showing {visibleContacts.length} of {contacts.length}{" "}
                    prospects.
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  {summary.needsReview > 0 ? (
                    <label className="flex items-center gap-2 text-sm text-zinc-400">
                      <input
                        type="checkbox"
                        checked={allowUnresolvedWarnings}
                        onChange={(event) =>
                          setAllowUnresolvedWarnings(event.target.checked)
                        }
                      />
                      Allow unresolved warnings
                    </label>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => setShowConfirmation(true)}
                    disabled={importBlocked}
                    className="rounded-xl bg-white px-5 py-3 font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Review final import
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[1850px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500">
                      <th className="px-4 py-3">Row</th>
                      <th className="px-4 py-3">Channel / Brand</th>
                      <th className="px-4 py-3">Greeting Name</th>
                      <th className="px-4 py-3">Email</th>
                      <th className="px-4 py-3">Platform</th>
                      <th className="px-4 py-3">Followers</th>
                      <th className="px-4 py-3">Median views</th>
                      <th className="px-4 py-3">Engagement</th>
                      <th className="px-4 py-3">Decision</th>
                      <th className="px-4 py-3">Reason</th>
                      <th className="px-4 py-3">Review</th>
                    </tr>
                  </thead>

                  <tbody>
                    {visibleContacts.map((contact) => {
                      const engagementQuality = getEngagementQuality(
                        contact.engagementRate,
                      );

                      return (
                        <tr
                          key={contact.rowNumber}
                          className="border-b border-zinc-900 align-top"
                        >
                          <td className="px-4 py-4 text-zinc-500">
                            {contact.rowNumber}
                          </td>

                          <td className="px-4 py-4">
                            <input
                              value={contact.displayName}
                              onChange={(event) => {
                                const nextDisplayName = event.target.value;
                                const greetingWasDefault =
                                  contact.greetingName.trim() ===
                                  contact.displayName.trim();

                                updateContact(contact.rowNumber, {
                                  displayName: nextDisplayName,
                                  ...(greetingWasDefault
                                    ? {
                                        greetingName: nextDisplayName,
                                      }
                                    : {}),
                                });
                              }}
                              className="w-72 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2"
                            />

                            <a
                              href={contact.profileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 block text-xs text-blue-400 hover:underline"
                            >
                              {contact.username || "Open profile"}
                            </a>

                            {contact.biography ? (
                              <p className="mt-2 max-w-72 line-clamp-2 text-xs text-zinc-500">
                                {contact.biography}
                              </p>
                            ) : null}
                          </td>

                          <td className="px-4 py-4">
                            <input
                              value={contact.greetingName}
                              onChange={(event) =>
                                updateContact(contact.rowNumber, {
                                  greetingName: event.target.value,
                                })
                              }
                              className={`w-72 rounded-lg border px-3 py-2 transition ${
                                contact.greetingName.trim() !==
                                contact.displayName.trim()
                                  ? "border-blue-500/40 bg-blue-950/30 text-blue-100"
                                  : "border-zinc-800 bg-zinc-900 text-white"
                              }`}
                              placeholder="Name used in greeting"
                            />

                            <p className="mt-2 max-w-72 text-xs text-zinc-500">
                              Used in the email greeting. One name, multiple
                              names, or the channel name are all valid.
                            </p>
                          </td>

                          <td className="px-4 py-4">
                            <input
                              value={contact.email}
                              onChange={(event) =>
                                updateContact(contact.rowNumber, {
                                  email: event.target.value
                                    .trim()
                                    .toLowerCase(),
                                })
                              }
                              className="w-72 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2"
                            />

                            {contact.alternateEmails.length > 0 ? (
                              <div className="mt-2 max-w-72 text-xs text-amber-400">
                                <p className="font-semibold">
                                  Alternate emails
                                </p>

                                {contact.alternateEmails.map(
                                  (alternateEmail) => (
                                    <button
                                      key={alternateEmail}
                                      type="button"
                                      onClick={() =>
                                        updateContact(contact.rowNumber, {
                                          email: alternateEmail,
                                          reviewResolved: true,
                                        })
                                      }
                                      className="mt-1 block text-left hover:underline"
                                    >
                                      Use {alternateEmail}
                                    </button>
                                  ),
                                )}
                              </div>
                            ) : null}
                          </td>

                          <td className="px-4 py-4 capitalize text-zinc-300">
                            {contact.platform || "—"}
                          </td>

                          <td className="px-4 py-4 text-zinc-300">
                            {formatNumber(contact.followerCount)}
                          </td>

                          <td className="px-4 py-4 text-zinc-300">
                            {formatNumber(contact.medianVideoViews)}
                          </td>

                          <td className="px-4 py-4">
                            <p className="text-zinc-300">
                              {formatEngagement(contact.engagementRate)}
                            </p>

                            <p
                              className={`mt-1 text-xs font-semibold ${engagementQuality.className}`}
                            >
                              {engagementQuality.label}
                            </p>
                          </td>

                          <td className="px-4 py-4">
                            <select
                              value={contact.reviewStatus}
                              onChange={(event) =>
                                updateDecision(
                                  contact.rowNumber,
                                  event.target.value as ReviewStatus,
                                )
                              }
                              className={`rounded-lg border px-3 py-2 ${getDecisionClasses(
                                contact.reviewStatus,
                              )}`}
                            >
                              <option value="approved">Approve</option>
                              <option value="hold">Hold</option>
                              <option value="rejected">Reject</option>
                            </select>
                          </td>

                          <td className="px-4 py-4">
                            <select
                              value={contact.decisionReason}
                              onChange={(event) =>
                                updateContact(contact.rowNumber, {
                                  decisionReason: event.target.value,
                                })
                              }
                              className="w-64 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2"
                            >
                              {DECISION_REASONS[contact.reviewStatus].map(
                                (reason) => (
                                  <option key={reason} value={reason}>
                                    {reason}
                                  </option>
                                ),
                              )}
                            </select>
                          </td>

                          <td className="px-4 py-4">
                            {contact.needsReview && !contact.reviewResolved ? (
                              <div className="max-w-64 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                                <p>
                                  {contact.validationErrors.length > 0
                                    ? contact.validationErrors.join(" ")
                                    : "Multiple email addresses require review."}
                                </p>

                                {contact.validationErrors.length === 0 ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      resolveReview(contact.rowNumber)
                                    }
                                    className="mt-3 rounded-lg bg-amber-300 px-3 py-2 font-semibold text-black"
                                  >
                                    Confirm primary email
                                  </button>
                                ) : null}
                              </div>
                            ) : (
                              <span className="rounded-full bg-green-500/10 px-3 py-1 text-xs text-green-400">
                                Ready
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}

        {showConfirmation ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
            <section className="w-full max-w-2xl rounded-3xl border border-zinc-700 bg-zinc-950 p-7 shadow-2xl">
              <p className="text-sm uppercase tracking-[0.2em] text-zinc-500">
                Final review
              </p>

              <h2 className="mt-2 text-3xl font-bold">Confirm Import</h2>

              <div className="mt-6 space-y-3 rounded-2xl bg-black p-5 text-sm">
                <div className="flex justify-between gap-6">
                  <span className="text-zinc-500">Experiment</span>
                  <span className="text-right font-semibold">
                    {selectedCampaign?.name}
                  </span>
                </div>

                <div className="flex justify-between gap-6">
                  <span className="text-zinc-500">Source</span>
                  <span className="font-semibold">{source}</span>
                </div>

                <div className="flex justify-between gap-6">
                  <span className="text-zinc-500">CSV file</span>
                  <span className="max-w-sm truncate font-semibold">
                    {fileName}
                  </span>
                </div>

                <div className="border-t border-zinc-800 pt-3">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Total prospects</span>
                    <span>{summary.total}</span>
                  </div>

                  <div className="mt-2 flex justify-between">
                    <span className="text-zinc-500">Approved</span>
                    <span>{summary.approved}</span>
                  </div>

                  <div className="mt-2 flex justify-between">
                    <span className="text-zinc-500">Held</span>
                    <span>{summary.hold}</span>
                  </div>

                  <div className="mt-2 flex justify-between">
                    <span className="text-zinc-500">Rejected</span>
                    <span>{summary.rejected}</span>
                  </div>

                  <div className="mt-2 flex justify-between">
                    <span className="text-zinc-500">Unresolved warnings</span>
                    <span>{summary.needsReview}</span>
                  </div>
                </div>
              </div>

              <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setShowConfirmation(false)}
                  disabled={importing}
                  className="rounded-xl border border-zinc-700 px-5 py-3 font-semibold text-zinc-300"
                >
                  Back to review
                </button>

                <button
                  type="button"
                  onClick={commitImport}
                  disabled={importing}
                  className="rounded-xl bg-white px-5 py-3 font-semibold text-black disabled:opacity-50"
                >
                  {importing ? "Importing..." : "Confirm Import"}
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {result ? (
          <section className="mt-6 rounded-2xl border border-green-500/30 bg-green-500/10 p-6">
            <h2 className="text-xl font-bold text-green-300">
              Import complete
            </h2>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-sm text-green-200/70">New prospects</p>
                <p className="mt-1 text-2xl font-bold">
                  {result.createdProspects}
                </p>
              </div>

              <div>
                <p className="text-sm text-green-200/70">Updated prospects</p>
                <p className="mt-1 text-2xl font-bold">
                  {result.updatedProspects}
                </p>
              </div>

              <div>
                <p className="text-sm text-green-200/70">
                  New campaign records
                </p>
                <p className="mt-1 text-2xl font-bold">
                  {result.createdCampaignMemberships}
                </p>
              </div>

              <div>
                <p className="text-sm text-green-200/70">Errors</p>
                <p className="mt-1 text-2xl font-bold">
                  {result.errors.length}
                </p>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
