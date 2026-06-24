import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type SessionRow = {
  id: string;
  customer_email: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  sponsor_name: string | null;
  transcript: string | null;
};

type MemoryRow = {
  id: string;
  customer_email: string;
  title: string | null;
  summary: string;
  created_at: string;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function formatMinutes(seconds: number) {
  return `${Math.round(seconds / 60)} min`;
}

export default async function AdminPage() {
  const { data: sessions } = await supabase
    .from("sessions")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(50);

  const { data: memories } = await supabase
    .from("user_memories")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);

  const sessionRows = (sessions || []) as SessionRow[];
  const memoryRows = (memories || []) as MemoryRow[];

  const totalSessions = sessionRows.length;
  const totalSeconds = sessionRows.reduce(
    (sum, session) => sum + (session.duration_seconds || 0),
    0
  );

  const averageSeconds =
    totalSessions > 0 ? Math.round(totalSeconds / totalSessions) : 0;

  const transcriptCount = sessionRows.filter(
    (session) => session.transcript && session.transcript.trim().length > 0
  ).length;

  const sponsorCounts = sessionRows.reduce<Record<string, number>>(
    (counts, session) => {
      const sponsor = session.sponsor_name || "No Sponsor";
      counts[sponsor] = (counts[sponsor] || 0) + 1;
      return counts;
    },
    {}
  );

  return (
    <main className="min-h-screen bg-black text-white p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <p className="text-sm uppercase tracking-[0.25em] text-zinc-500">
            Chef-it Admin
          </p>
          <h1 className="mt-2 text-4xl font-bold">Analytics Dashboard</h1>
          <p className="mt-3 text-zinc-400">
            Session usage, sponsor activity, transcripts, and customer memories.
          </p>
        </div>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <p className="text-sm text-zinc-500">Total Sessions</p>
            <p className="mt-3 text-3xl font-bold">{totalSessions}</p>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <p className="text-sm text-zinc-500">Total Minutes</p>
            <p className="mt-3 text-3xl font-bold">
              {formatMinutes(totalSeconds)}
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <p className="text-sm text-zinc-500">Avg. Session</p>
            <p className="mt-3 text-3xl font-bold">
              {formatMinutes(averageSeconds)}
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <p className="text-sm text-zinc-500">Transcripts</p>
            <p className="mt-3 text-3xl font-bold">{transcriptCount}</p>
          </div>
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="text-xl font-bold">Sponsor Sessions</h2>

            <div className="mt-5 space-y-3">
              {Object.entries(sponsorCounts).length === 0 ? (
                <p className="text-zinc-500">No sponsor data yet.</p>
              ) : (
                Object.entries(sponsorCounts).map(([sponsor, count]) => (
                  <div
                    key={sponsor}
                    className="flex items-center justify-between rounded-xl bg-zinc-900 p-4"
                  >
                    <span>{sponsor}</span>
                    <span className="font-bold">{count}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="text-xl font-bold">Recent Memories</h2>

            <div className="mt-5 space-y-4">
              {memoryRows.length === 0 ? (
                <p className="text-zinc-500">No memories saved yet.</p>
              ) : (
                memoryRows.map((memory) => (
                  <div key={memory.id} className="rounded-xl bg-zinc-900 p-4">
                    <p className="font-semibold">
                      {memory.title || "Untitled Memory"}
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      {memory.customer_email}
                    </p>
                    <p className="mt-3 text-sm text-zinc-300">
                      {memory.summary}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
          <h2 className="text-xl font-bold">Recent Sessions</h2>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500">
                  <th className="py-3 pr-4">Started</th>
                  <th className="py-3 pr-4">Customer</th>
                  <th className="py-3 pr-4">Sponsor</th>
                  <th className="py-3 pr-4">Duration</th>
                  <th className="py-3 pr-4">Transcript</th>
                </tr>
              </thead>

              <tbody>
                {sessionRows.length === 0 ? (
                  <tr>
                    <td className="py-5 text-zinc-500" colSpan={5}>
                      No sessions yet.
                    </td>
                  </tr>
                ) : (
                  sessionRows.map((session) => (
                    <tr key={session.id} className="border-b border-zinc-900">
                      <td className="py-4 pr-4 text-zinc-300">
                        {formatDate(session.started_at)}
                      </td>
                      <td className="py-4 pr-4 text-zinc-300">
                        {session.customer_email || "—"}
                      </td>
                      <td className="py-4 pr-4 text-zinc-300">
                        {session.sponsor_name || "—"}
                      </td>
                      <td className="py-4 pr-4 text-zinc-300">
                        {formatMinutes(session.duration_seconds || 0)}
                      </td>
                      <td className="py-4 pr-4">
                        {session.transcript ? (
                          <span className="rounded-full bg-green-500/15 px-3 py-1 text-xs text-green-400">
                            Saved
                          </span>
                        ) : (
                          <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-500">
                            None
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}