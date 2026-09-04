// Station health — an operations page, deliberately not linked from the nav.
//
// Somewhere to look when you want to know whether the data underneath the board is
// sound. The scheduled check at /api/cron/health answers the same question for a
// machine; this answers it for a person, including WHY each problem matters.

import Link from "next/link";
import { Panel } from "@/components/Panel";
import { runHealthCheck } from "@/lib/health";
import type { HealthStatus } from "@/lib/stationHealth";

export const dynamic = "force-dynamic";

const META: Record<HealthStatus, { dot: string; label: string; text: string }> = {
  ok: { dot: "bg-good", label: "Healthy", text: "text-good-fg" },
  degraded: { dot: "bg-warn", label: "Sensor down", text: "text-warn-fg" },
  dark: { dot: "bg-bad", label: "Station dark", text: "text-bad-fg" },
  unknown: { dot: "bg-idle", label: "Unreachable", text: "text-muted" },
};

const COL_LABEL: Record<string, string> = {
  windDir: "dir",
  windKt: "wind",
  gustKt: "gust",
  waveFt: "wave",
  waterTempF: "temp",
};

export default async function HealthPage() {
  const s = await runHealthCheck();
  const checked = new Date(s.checkedAt);

  return (
    <div>
      <Link href="/" className="text-sm text-muted hover:text-fg">
        ← All harbors
      </Link>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Station health</h1>
        <span className="text-xs text-faint">
          checked {checked.toISOString().replace("T", " ").slice(0, 16)} UTC
        </span>
      </div>

      <p className="mt-2 max-w-[70ch] text-sm text-muted">
        Every NDBC station the app reads, and whether each column it depends on is actually reporting. A
        station can be fresh and still have a dead sensor — that failure is quieter than an outage and
        can silently change what the ratings say.
      </p>

      <div className="mt-4">
        {s.problems.length === 0 ? (
          <Panel>
            <p className="text-good-fg">
              <span className="mr-2">✓</span>
              All {s.stations.length} stations healthy — every column the app depends on is reporting.
            </p>
          </Panel>
        ) : (
          <Panel title={`${s.problems.length} station${s.problems.length === 1 ? "" : "s"} need attention`}>
            <ul className="flex flex-col gap-3">
              {s.problems.map((p) => (
                <li key={p.station} className="rounded-lg border border-line-soft bg-raised p-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${META[p.status].dot}`} />
                    <span className="font-mono font-semibold text-strong">{p.station}</span>
                    <span className={`text-xs font-semibold ${META[p.status].text}`}>{META[p.status].label}</span>
                    <span className="text-xs text-faint">
                      {p.usedBy.length} harbor{p.usedBy.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {p.findings.map((f) => (
                      <li key={f} className="text-sm text-fg">
                        {f}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-xs text-faint">{p.usedBy.join(", ")}</p>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>

      <Panel title="All stations" className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="pb-2 pr-3 font-semibold">Station</th>
                <th className="pb-2 pr-3 font-semibold">Status</th>
                <th className="pb-2 pr-3 font-semibold">Age</th>
                <th className="pb-2 pr-3 font-semibold">Depended-on columns (fill rate)</th>
                <th className="pb-2 font-semibold">Harbors</th>
              </tr>
            </thead>
            <tbody>
              {s.stations.map((st) => (
                <tr key={st.station} className="border-t border-line-soft">
                  <td className="py-2 pr-3 font-mono text-strong">{st.station}</td>
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${META[st.status].dot}`} />
                      <span className={META[st.status].text}>{META[st.status].label}</span>
                    </span>
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-muted">
                    {st.ageHours == null ? "—" : st.ageHours < 1 ? "<1 h" : `${st.ageHours.toFixed(0)} h`}
                  </td>
                  <td className="py-2 pr-3">
                    <span className="flex flex-wrap gap-1.5">
                      {st.usedFor.map((c) => {
                        // A sensor this platform never carried is "n/a", not a red 0% —
                        // the fallback chain covers it and it is not a fault.
                        const absent = st.absentSensors.includes(c);
                        const pct = Math.round(st.fill[c] * 100);
                        const bad = !absent && pct < 50;
                        return (
                          <span
                            key={c}
                            title={absent ? "this platform has no such sensor" : undefined}
                            className={`rounded px-1.5 py-0.5 font-mono text-xs ${
                              bad
                                ? "bg-bad/15 text-bad-fg"
                                : absent
                                  ? "border border-dashed border-line text-faint"
                                  : "bg-sunken text-muted"
                            }`}
                          >
                            {COL_LABEL[c] ?? c} {absent ? "n/a" : `${pct}%`}
                          </span>
                        );
                      })}
                    </span>
                  </td>
                  <td className="py-2 tabular-nums text-muted">{st.usedBy.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-faint">
          Fill rate is the share of rows in the last 48 <em>hours</em> carrying that value — measured over
          time rather than a row count, because a stalled feed&apos;s last 200 rows can look perfect while
          the station has been silent for a week. Only columns some harbor actually depends on are shown,
          and <span className="whitespace-nowrap">n/a</span> means the platform never carried that sensor
          (its absence is covered by the fallback chain, not a fault). Deeper drift checking — does this
          station still agree with its neighbours? — runs separately via{" "}
          <span className="font-mono">npm run validate:stations</span>.
        </p>
      </Panel>
    </div>
  );
}
