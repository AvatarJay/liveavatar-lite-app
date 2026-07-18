"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type Campaign = {
  id: string;
  name: string;
  campaign_code: string;
  status: string;
  source_tool: string | null;
  daily_send_limit: number;
};

type ReleaseCandidate = {
  campaignProspectId: string;
  prospectId: string;

  displayName: string;
  greetingName: string;
  email: string;

  biography: string;
  username: string;
  platform: string;
  profileUrl: string;

  reviewStatus: string | null;
  outreachStatus: string;
  marketingStatus: string;

  greetingCustomized: boolean;

  ready: boolean;
  blockedReason: string | null;

  automationStartedAt: string | null;
};

type ReleaseCandidatesResponse = {
  campaign: Campaign;
  summary: {
    approved: number;
    ready: number;
    queued: number;
    released: number;
    blocked: number;
  };
  candidates: ReleaseCandidate[];
};

type ReleaseResultItem = {
  campaignProspectId: string;
  prospectId?: string;
  email?: string;
  creatorName?: string;
  message?: string;
};

type QueueResponse = {
  requested: number;
  queuedCount: number;
  skippedCount: number;
  failedCount: number;
  queued: ReleaseResultItem[];
  skipped: ReleaseResultItem[];
  failed: ReleaseResultItem[];
};

function truncateBiography(
  biography: string,
  maxLength = 240
): string {
  if (biography.length <= maxLength) return biography;

  return `${biography.slice(0, maxLength).trim()}…`;
}

function formatDate(value: string | null): string {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function ReleaseReviewPage() {
  const params = useParams<{
    campaignId: string;
  }>();

  const campaignId = params.campaignId;

  const [data, setData] =
    useState<ReleaseCandidatesResponse | null>(null);

  const [selectedIds, setSelectedIds] = useState<
    Set<string>
  >(new Set());

  const [loading, setLoading] = useState(true);
  const [queueing, setQueueing] = useState(false);

  const [error, setError] = useState("");
  const [queueResult, setQueueResult] =
    useState<QueueResponse | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);

  const loadCandidates = useCallback(async () => {
    if (!campaignId) return;

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/growth/campaigns/${encodeURIComponent(
          campaignId
        )}/release-candidates`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const body = (await response.json()) as
        | ReleaseCandidatesResponse
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in body && body.error
            ? body.error
            : "Unable to load release candidates."
        );
      }

      setData(body as ReleaseCandidatesResponse);

      setSelectedIds((current) => {
        const readyIds = new Set(
          (body as ReleaseCandidatesResponse).candidates
            .filter((candidate) => candidate.ready)
            .map(
              (candidate) =>
                candidate.campaignProspectId
            )
        );

        return new Set(
          Array.from(current).filter((id) =>
            readyIds.has(id)
          )
        );
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to load release candidates."
      );
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  const readyCandidates = useMemo(
    () =>
      data?.candidates.filter(
        (candidate) => candidate.ready
      ) ?? [],
    [data]
  );

  const unavailableCandidates = useMemo(
    () =>
      data?.candidates.filter(
        (candidate) => !candidate.ready
      ) ?? [],
    [data]
  );

  const allReadySelected =
    readyCandidates.length > 0 &&
    readyCandidates.every((candidate) =>
      selectedIds.has(candidate.campaignProspectId)
    );

  function toggleCandidate(
    campaignProspectId: string
  ) {
    setSelectedIds((current) => {
      const next = new Set(current);

      if (next.has(campaignProspectId)) {
        next.delete(campaignProspectId);
      } else {
        next.add(campaignProspectId);
      }

      return next;
    });

    setQueueResult(null);
  }

  function toggleAllReady() {
    setSelectedIds((current) => {
      if (allReadySelected) {
        return new Set();
      }

      const next = new Set(current);

      for (const candidate of readyCandidates) {
        next.add(candidate.campaignProspectId);
      }

      return next;
    });

    setQueueResult(null);
  }

  async function queueSelected() {
  if (!campaignId || selectedIds.size === 0) return;

  setQueueing(true);
  setError("");
  setQueueResult(null);

  try {
    const response = await fetch(
      `/api/growth/campaigns/${encodeURIComponent(
        campaignId
      )}/queue`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          campaignProspectIds: Array.from(selectedIds),
        }),
      }
    );

    const body = (await response.json()) as
      | QueueResponse
      | { error?: string };

    if (!response.ok) {
      if (
        "queuedCount" in body ||
        "failedCount" in body
      ) {
        setQueueResult(body as QueueResponse);
      }

      throw new Error(
        "error" in body && body.error
          ? body.error
          : "Unable to queue the selected prospects."
      );
    }

    setQueueResult(body as QueueResponse);
    setSelectedIds(new Set());
    setConfirmOpen(false);

    await loadCandidates();
  } catch (caughtError) {
    setConfirmOpen(false);

    setError(
      caughtError instanceof Error
        ? caughtError.message
        : "Unable to queue the selected prospects."
    );
  } finally {
    setQueueing(false);
  }
}

  if (loading) {
    return (
      <main className="min-h-screen bg-black px-6 py-10 text-white">
        <div className="mx-auto max-w-7xl">
          <p className="text-zinc-400">
            Loading release review…
          </p>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-black px-6 py-10 text-white">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-3xl font-semibold">
            Release Review
          </h1>

          <p className="mt-4 text-red-400">
            {error || "Campaign data could not be loaded."}
          </p>

          <button
            type="button"
            onClick={() => void loadCandidates()}
            className="mt-6 rounded-xl border border-zinc-700 px-4 py-2 hover:bg-zinc-900"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-6 py-10 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-6 border-b border-zinc-800 pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link
              href="/admin/growth/imports"
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              ← Back to Import Review
            </Link>

            <h1 className="mt-4 text-4xl font-semibold tracking-tight">
              Release Review
            </h1>

            <p className="mt-2 text-lg text-zinc-300">
              {data.campaign.name}
            </p>

            <p className="mt-1 text-sm text-zinc-500">
              Final check before approved prospects enter the
              Creator Outreach Journey.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadCandidates()}
            disabled={queueing}
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <p className="text-sm text-zinc-500">
              Approved
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {data.summary.approved}
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-900 bg-emerald-950/30 p-5">
            <p className="text-sm text-emerald-300">
              Ready
            </p>
            <p className="mt-2 text-3xl font-semibold text-emerald-200">
              {data.summary.ready}
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <p className="text-sm text-zinc-500">
              Already released
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {data.summary.released}
            </p>
          </div>

          <div className="rounded-2xl border border-amber-900 bg-amber-950/30 p-5">
            <p className="text-sm text-amber-300">
              Blocked
            </p>
            <p className="mt-2 text-3xl font-semibold text-amber-200">
              {data.summary.blocked}
            </p>
          </div>
        </section>

        {error ? (
          <div className="mt-6 rounded-2xl border border-red-900 bg-red-950/30 p-4 text-red-200">
            {error}
          </div>
        ) : null}

        {queueResult ? (
  <div className="mt-6 rounded-2xl border border-emerald-900 bg-emerald-950/30 p-5">
    <h2 className="text-lg font-semibold text-emerald-200">
      Queue updated
    </h2>

    <div className="mt-3 flex flex-wrap gap-5 text-sm">
      <span>
        Queued: <strong>{queueResult.queuedCount}</strong>
      </span>

      <span>
        Skipped: <strong>{queueResult.skippedCount}</strong>
      </span>

      <span>
        Failed: <strong>{queueResult.failedCount}</strong>
      </span>
    </div>

    <p className="mt-3 text-sm text-emerald-300/80">
      No emails were sent. The Release Engine will evaluate
      queued prospects before handing them to Resend.
    </p>
  </div>
) : null}

        <section className="mt-8 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
          <div className="flex flex-col gap-4 border-b border-zinc-800 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={allReadySelected}
                onChange={toggleAllReady}
                disabled={readyCandidates.length === 0}
                className="h-5 w-5 rounded border-zinc-600 bg-zinc-900"
              />

              <span className="font-medium">
                Select all ready prospects
              </span>
            </label>

            <div className="text-sm text-zinc-400">
              {selectedIds.size} selected of{" "}
              {readyCandidates.length} ready
            </div>
          </div>

          {readyCandidates.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <h2 className="text-xl font-medium">
                No prospects are currently ready
              </h2>

              <p className="mt-2 text-zinc-500">
                Approved prospects that have not entered
                outreach will appear here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {readyCandidates.map((candidate) => (
                <article
                  key={candidate.campaignProspectId}
                  className="grid gap-5 px-5 py-6 lg:grid-cols-[40px_1.1fr_1fr_1.5fr_auto]"
                >
                  <div className="pt-1">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(
                        candidate.campaignProspectId
                      )}
                      onChange={() =>
                        toggleCandidate(
                          candidate.campaignProspectId
                        )
                      }
                      className="h-5 w-5 rounded border-zinc-600 bg-zinc-900"
                    />
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-lg font-semibold">
                        {candidate.greetingName}
                      </p>

                      {candidate.greetingCustomized ? (
                        <span
                          title="Greeting name was customized"
                          className="inline-flex items-center rounded-full border border-blue-700/60 bg-blue-950/60 px-2 py-0.5 text-xs text-blue-200"
                        >
                          ✎ Customized
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-1 text-sm text-zinc-400">
                      Greeting: Hi {candidate.greetingName},
                    </p>
                  </div>

                  <div>
                    <p className="font-medium">
                      {candidate.displayName}
                    </p>

                    {candidate.username ? (
                      <p className="mt-1 text-sm text-zinc-500">
                        @{candidate.username.replace(/^@/, "")}
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <p className="break-all text-sm text-zinc-200">
                      {candidate.email}
                    </p>

                    {candidate.biography ? (
                      <p className="mt-3 text-sm leading-6 text-zinc-500">
                        {truncateBiography(
                          candidate.biography
                        )}
                      </p>
                    ) : (
                      <p className="mt-3 text-sm text-zinc-600">
                        No biography available.
                      </p>
                    )}
                  </div>

                  <div className="flex items-start gap-3 lg:justify-end">
                    <span className="rounded-full border border-emerald-800 bg-emerald-950/50 px-3 py-1 text-xs text-emerald-200">
                      Ready
                    </span>

                    <Link
                      href={`/admin/growth/imports?campaignId=${encodeURIComponent(
                        campaignId
                      )}&prospectId=${encodeURIComponent(
                        candidate.prospectId
                      )}`}
                      className="text-sm text-blue-400 hover:text-blue-300"
                    >
                      Edit
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {unavailableCandidates.length > 0 ? (
          <details className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-950">
            <summary className="cursor-pointer px-5 py-5 font-medium">
              Queued, released, or unavailable (
              {unavailableCandidates.length})
            </summary>

            <div className="divide-y divide-zinc-800 border-t border-zinc-800">
              {unavailableCandidates.map((candidate) => (
                <div
                  key={candidate.campaignProspectId}
                  className="grid gap-3 px-5 py-5 text-sm md:grid-cols-[1fr_1fr_1fr]"
                >
                  <div>
                    <p className="font-medium">
                      {candidate.greetingName}
                    </p>
                    <p className="text-zinc-500">
                      {candidate.displayName}
                    </p>
                  </div>

                  <div className="break-all text-zinc-400">
                    {candidate.email}
                  </div>

                  <div className="text-zinc-500 md:text-right">
                    {candidate.blockedReason ||
                      candidate.outreachStatus}

                    {candidate.automationStartedAt ? (
                      <p className="mt-1">
                        {formatDate(
                          candidate.automationStartedAt
                        )}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </details>
        ) : null}

        <div className="sticky bottom-4 mt-8 rounded-2xl border border-zinc-700 bg-zinc-950/95 p-5 shadow-2xl backdrop-blur">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">
                {selectedIds.size} prospect
                {selectedIds.size === 1 ? "" : "s"} selected
              </p>

              <p className="mt-1 text-sm text-zinc-500">
                Selected prospects will be queued. No email will be sent immediately.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={
                selectedIds.size === 0 || queueing
              }
              className="rounded-xl bg-white px-5 py-3 font-semibold text-black hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              Approve for Outreach
            </button>
          </div>
        </div>
      </div>

      {confirmOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="queue-confirmation-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4"
        >
          <div className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-950 p-6 shadow-2xl">
            <h2
              id="queue-confirmation-title"
              className="text-2xl font-semibold"
            >
              Queue {selectedIds.size} prospect
              {selectedIds.size === 1 ? "" : "s"} for outreach?
            </h2>

            <p className="mt-4 leading-7 text-zinc-300">
               The selected prospects will enter the Chef-iT outreach
               queue. No email will be sent immediately. The Release
               Engine will evaluate eligibility, campaign limits, and
               release timing before sending anything to Resend.
            </p>

            <div className="mt-6 rounded-xl border border-amber-900 bg-amber-950/30 p-4 text-sm text-amber-200">
  This action approves the selected prospects for automated
  outreach. Confirm the greeting names and email addresses
  before continuing.
</div>

            <div className="mt-7 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={queueing}
                className="rounded-xl border border-zinc-700 px-4 py-2 hover:bg-zinc-900 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
  type="button"
  onClick={() => void queueSelected()}
  disabled={queueing}
  className="rounded-xl bg-white px-4 py-2 font-semibold text-black hover:bg-zinc-200 disabled:opacity-50"
>
  {queueing
    ? "Queueing…"
    : `Queue ${selectedIds.size}`}
</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}