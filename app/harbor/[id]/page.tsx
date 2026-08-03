"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { usePrefs } from "@/components/prefs";
import { Panel } from "@/components/Panel";
import { ScoreBars } from "@/components/ScoreBars";
import { WindChart } from "@/components/WindChart";
import { HourStrip } from "@/components/HourStrip";
import { STATUS_META, statusLabel } from "@/components/status-meta";
import { getHarbor } from "@/lib/harbors";
import { rate } from "@/lib/rating";
import { computeWindow } from "@/lib/window";
import { harborIntel } from "@/lib/intel";
import { degToCompass } from "@/lib/units";
import { fmtLocalTime } from "@/lib/astro";
import type { Conditions, ForecastHour } from "@/lib/types";
import type { IntelSeverity } from "@/lib/intel";
import type { WindPoint } from "@/lib/ndbc";

interface Bundle {
  id: string;
  name: string;
  notes: { entrance: string; docking: string; hazards: string };
  conditions: Conditions;
  windHistory: WindPoint[];
  forecast: ForecastHour[];
  marine: { advisory: Conditions["advisory"]; waveText: string | null; headline: string | null };
  discussion: { text: string; issued: string | null } | null;
  sun: { sunrise: string; sunset: string };
  stormHours: string[];
  radarStation: string;
  webcamUrl: string;
}

const ADVISORY_LABEL: Record<string, string> = {
  small_craft: "Small Craft Advisory",
  gale: "Gale Warning",
  storm: "Storm Warning",
};

const SEV: Record<IntelSeverity, { dot: string; label: string; text: string }> = {
  ok: { dot: "bg-good", label: "Clear", text: "text-good-fg" },
  watch: { dot: "bg-warn", label: "Watch", text: "text-warn-fg" },
  alert: { dot: "bg-bad", label: "Caution", text: "text-bad-fg" },
};

export default function HarborDetail() {
  const { id } = useParams<{ id: string }>();
  const { skill, boat } = usePrefs();
  const [b, setB] = useState<Bundle | null>(null);
  const [error, setError] = useState(false);
  const harbor = getHarbor(id);

  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(false);
    fetch(`/api/harbor/${id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => live && setB(d))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [id]);

  const rating = useMemo(() => (b && harbor ? rate(harbor, b.conditions, boat, skill) : null), [b, harbor, boat, skill]);
  const sail = useMemo(
    () =>
      b && harbor
        ? computeWindow(harbor, b.forecast, boat, skill, new Date(b.sun.sunrise), new Date(b.sun.sunset), b.stormHours)
        : null,
    [b, harbor, boat, skill],
  );
  const intel = useMemo(() => (b && harbor ? harborIntel(harbor, b.conditions, boat, skill) : null), [b, harbor, boat, skill]);

  if (!harbor) return <NotFound />;
  if (error) return <Message>Couldn&apos;t load this harbor&apos;s data. Try again shortly.</Message>;
  if (!b || !rating || !sail || !intel) return <Loading name={harbor.name} />;

  const c = b.conditions;
  const meta = STATUS_META[rating.status];
  // Cache-bust live images off the observation time (pure — changes when data refetches).
  const bust = encodeURIComponent(c.observedAt ?? b.id);

  return (
    <div>
      <Link href="/" className="text-sm text-muted hover:text-fg">← All harbors</Link>

      {/* Header */}
      <div className={`mt-3 rounded-2xl border ${meta.border} ${meta.soft} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`h-4 w-4 rounded-full ${meta.dot}`} />
            <h1 className="text-2xl font-bold tracking-tight">{b.name}</h1>
            <span className={`text-sm font-semibold ${meta.text}`}>{statusLabel(rating.status, boat)}</span>
          </div>
          <div className="text-right text-xs text-faint">
            <div className="font-mono text-2xl text-fg">{rating.status === "unknown" ? "—" : rating.score}</div>
            <div>
              {c.source}
              {harbor.buoyStation && c.source !== harbor.buoyStation ? " (nearby)" : ""} ·{" "}
              {c.observedAt ? fmtLocalTime(new Date(c.observedAt)) : "—"}
            </div>
          </div>
        </div>
        <p className="mt-3 text-fg">{rating.reason}</p>
        <div className="mt-3 flex flex-col items-start gap-2">
          {c.advisory !== "none" && (
            <div className="inline-flex items-center gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-1.5 text-sm text-warn-fg">
              ⚠ {ADVISORY_LABEL[c.advisory]} in effect{b.marine.headline ? ` — ${b.marine.headline}` : ""}
            </div>
          )}
          {c.storm && c.storm.level !== "none" && (
            <div
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                c.storm.level === "watch"
                  ? "border-warn/40 bg-warn/10 text-warn-fg"
                  : "border-bad/40 bg-bad/10 text-bad-fg"
              }`}
            >
              ⛈ {c.storm.headline}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Launch score */}
        <Panel title="Launch score — exit vs open lake" className="lg:col-span-2">
          <ScoreBars exitScore={rating.exitScore} openScore={rating.openScore} />
          <p className="mt-3 text-xs text-faint">
            Limiting factor right now: <b className="text-fg">{rating.limiter}</b>. Harbor exit reflects{" "}
            {harbor.name}&apos;s breakwater geometry for the current wind; open lake is offshore comfort.
          </p>
        </Panel>

        {/* Recommended sail window */}
        <Panel title="Recommended sail window" className="lg:col-span-2">
          <p className="mb-3 text-lg font-medium text-strong">{sail.summary}</p>
          <HourStrip hours={sail.hours} />
          <p className="mt-2 text-xs text-faint">
            Next 24 h, rated for your boat + skill. Dim cells are after dark. Wave heights in the forecast are
            wind-sea estimates.
          </p>
        </Panel>

        {/* Harbor intelligence — condition-aware */}
        <Panel title="Harbor intelligence" className="lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            {intel.map((it) => {
              const s = SEV[it.severity];
              return (
                <div key={it.label} className="rounded-lg border border-line-soft bg-surface p-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
                    <span className="text-sm font-semibold text-fg">{it.label}</span>
                    <span className={`ml-auto text-[10px] font-medium uppercase tracking-wide ${s.text}`}>{s.label}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-fg">{it.impact}</p>
                  {it.note && <p className="mt-1 text-xs text-faint">{it.note}</p>}
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-faint">
            Live reads combine the current conditions with {harbor.name}&apos;s exposure model, rated for your boat +
            skill. The grey local notes are seed knowledge, refined over time with sailor input.
          </p>
        </Panel>

        {/* Live wind */}
        <Panel title="Live wind — last 24 h">
          <WindChart data={b.windHistory} />
          <div className="mt-2 flex gap-4 text-xs text-muted">
            <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-brand" /> sustained</span>
            <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 border-t border-dashed border-brand/60" /> gust</span>
          </div>
        </Panel>

        {/* Conditions now */}
        <Panel title="Conditions now">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Stat label="Wind" value={c.windKt != null ? `${c.windDir != null ? degToCompass(c.windDir) + " " : ""}${Math.round(c.windKt)} kt` : "—"} />
            <Stat label="Gusts" value={c.gustKt != null ? `${Math.round(c.gustKt)} kt` : "—"} />
            <Stat label="Waves" value={c.waveFt != null ? `${c.waveFt.toFixed(1)} ft${c.wavePeriodS ? ` @ ${Math.round(c.wavePeriodS)}s` : ""}` : "—"} />
            <Stat label="Wave dir" value={c.waveDir != null ? degToCompass(c.waveDir) : "—"} />
            <Stat label="Water temp" value={c.waterTempF != null ? `${Math.round(c.waterTempF)}°F` : "—"} />
            <Stat label="Air temp" value={c.airTempF != null ? `${Math.round(c.airTempF)}°F` : "—"} />
            <Stat label="Sunrise" value={fmtLocalTime(new Date(b.sun.sunrise))} />
            <Stat label="Sunset" value={fmtLocalTime(new Date(b.sun.sunset))} />
          </dl>
        </Panel>

        {/* Wave forecast */}
        <Panel title="Wave & marine forecast">
          <p className="text-fg">{b.marine.waveText ?? "No nearshore wave line available."}</p>
          <p className="mt-2 text-xs text-faint">
            Zone {harbor.marineZone} · advisory:{" "}
            <b className="text-fg">{c.advisory === "none" ? "none" : ADVISORY_LABEL[c.advisory]}</b>
          </p>
        </Panel>

        {/* Radar */}
        <Panel title={`Radar (${b.radarStation})`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://radar.weather.gov/ridge/standard/${b.radarStation}_loop.gif?t=${bust}`}
            alt={`NWS ${b.radarStation} radar loop`}
            className="w-full rounded-lg border border-line"
          />
        </Panel>

        {/* Webcam — only for harbors that have one */}
        {b.webcamUrl && (
          <Panel title="Lakefront webcam (GLERL)">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${b.webcamUrl}?t=${bust}`}
              alt="GLERL lakefront webcam"
              className="w-full rounded-lg border border-line"
            />
            <p className="mt-2 text-[11px] text-faint">NOAA GLERL camera — nearest public lakefront view.</p>
          </Panel>
        )}

        {/* Forecast discussion */}
        <Panel title="NOAA forecast discussion" className="lg:col-span-2">
          {b.discussion ? (
            <details>
              <summary className="cursor-pointer text-sm text-brand">
                Read the LOT Area Forecast Discussion
                {b.discussion.issued ? ` (issued ${fmtLocalTime(new Date(b.discussion.issued))})` : ""}
              </summary>
              <pre className="scroll-thin mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-sunken p-3 text-xs leading-relaxed text-fg">
                {b.discussion.text}
              </pre>
            </details>
          ) : (
            <p className="text-sm text-faint">Discussion unavailable right now.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-faint">{label}</dt>
      <dd className="font-medium text-fg">{value}</dd>
    </div>
  );
}

function Loading({ name }: { name: string }) {
  return (
    <div>
      <Link href="/" className="text-sm text-muted hover:text-fg">← All harbors</Link>
      <h1 className="mt-3 text-2xl font-bold">{name}</h1>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-40 animate-pulse rounded-2xl border border-line bg-surface" />
        ))}
      </div>
    </div>
  );
}

function NotFound() {
  return <Message>Harbor not found. <Link href="/" className="text-brand">Back to the board</Link>.</Message>;
}

function Message({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-line bg-surface p-6 text-fg">{children}</div>;
}
