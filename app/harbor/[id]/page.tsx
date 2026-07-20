"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { usePrefs } from "@/components/prefs";
import { Panel } from "@/components/Panel";
import { ScoreBars } from "@/components/ScoreBars";
import { WindChart } from "@/components/WindChart";
import { HourStrip } from "@/components/HourStrip";
import { STATUS_META } from "@/components/status-meta";
import { getHarbor } from "@/lib/harbors";
import { getBoat } from "@/lib/boats";
import { rate } from "@/lib/rating";
import { computeWindow } from "@/lib/window";
import { degToCompass } from "@/lib/units";
import { fmtLocalTime } from "@/lib/astro";
import type { Conditions, ForecastHour } from "@/lib/types";
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
  radarStation: string;
}

const ADVISORY_LABEL: Record<string, string> = {
  small_craft: "Small Craft Advisory",
  gale: "Gale Warning",
  storm: "Storm Warning",
};

export default function HarborDetail() {
  const { id } = useParams<{ id: string }>();
  const { boatId, skill } = usePrefs();
  const [b, setB] = useState<Bundle | null>(null);
  const [error, setError] = useState(false);
  const harbor = getHarbor(id);
  const boat = getBoat(boatId);

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
      b && harbor ? computeWindow(harbor, b.forecast, boat, skill, new Date(b.sun.sunrise), new Date(b.sun.sunset)) : null,
    [b, harbor, boat, skill],
  );

  if (!harbor) return <NotFound />;
  if (error) return <Message>Couldn&apos;t load this harbor&apos;s data. Try again shortly.</Message>;
  if (!b || !rating || !sail) return <Loading name={harbor.name} />;

  const c = b.conditions;
  const meta = STATUS_META[rating.status];
  // Cache-bust live images off the observation time (pure — changes when data refetches).
  const bust = encodeURIComponent(c.observedAt ?? b.id);

  return (
    <div>
      <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">← All harbors</Link>

      {/* Header */}
      <div className={`mt-3 rounded-2xl border ${meta.border} ${meta.soft} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`h-4 w-4 rounded-full ${meta.dot}`} />
            <h1 className="text-2xl font-bold tracking-tight">{b.name}</h1>
            <span className={`text-sm font-semibold ${meta.text}`}>{meta.label}</span>
          </div>
          <div className="text-right text-xs text-slate-500">
            <div className="font-mono text-2xl text-slate-200">{rating.status === "unknown" ? "—" : rating.score}</div>
            <div>
              {c.source} · {c.observedAt ? fmtLocalTime(new Date(c.observedAt)) : "—"}
            </div>
          </div>
        </div>
        <p className="mt-3 text-slate-200">{rating.reason}</p>
        {c.advisory !== "none" && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-200">
            ⚠ {ADVISORY_LABEL[c.advisory]} in effect{b.marine.headline ? ` — ${b.marine.headline}` : ""}
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Launch score */}
        <Panel title="Launch score — exit vs open lake" className="lg:col-span-2">
          <ScoreBars exitScore={rating.exitScore} openScore={rating.openScore} />
          <p className="mt-3 text-xs text-slate-500">
            Limiting factor right now: <b className="text-slate-300">{rating.limiter}</b>. Harbor exit reflects{" "}
            {harbor.name}&apos;s breakwater geometry for the current wind; open lake is offshore comfort.
          </p>
        </Panel>

        {/* Recommended sail window */}
        <Panel title="Recommended sail window" className="lg:col-span-2">
          <p className="mb-3 text-lg font-medium text-slate-100">{sail.summary}</p>
          <HourStrip hours={sail.hours} />
          <p className="mt-2 text-xs text-slate-500">
            Next 24 h, rated for your boat + skill. Dim cells are after dark. Wave heights in the forecast are
            wind-sea estimates.
          </p>
        </Panel>

        {/* Live wind */}
        <Panel title="Live wind — last 24 h">
          <WindChart data={b.windHistory} />
          <div className="mt-2 flex gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-sky-400" /> sustained</span>
            <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 border-t border-dashed border-sky-400/60" /> gust</span>
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
          <p className="text-slate-200">{b.marine.waveText ?? "No nearshore wave line available."}</p>
          <p className="mt-2 text-xs text-slate-500">
            Zone {harbor.marineZone} · advisory:{" "}
            <b className="text-slate-300">{c.advisory === "none" ? "none" : ADVISORY_LABEL[c.advisory]}</b>
          </p>
        </Panel>

        {/* Harbor intelligence */}
        <Panel title="Harbor intelligence">
          <ul className="space-y-2 text-sm">
            <Note label="Entrance" text={b.notes.entrance} />
            <Note label="Docking" text={b.notes.docking} />
            <Note label="Hazards" text={b.notes.hazards} />
          </ul>
          <p className="mt-3 text-[11px] text-slate-500">Seed local knowledge — refined over time with sailor input.</p>
        </Panel>

        {/* Radar */}
        <Panel title="Radar — Chicago (KLOT)">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://radar.weather.gov/ridge/standard/K${b.radarStation}_loop.gif?t=${bust}`}
            alt="NWS Chicago radar loop"
            className="w-full rounded-lg border border-white/10"
          />
        </Panel>

        {/* Webcam */}
        <Panel title="Lakefront webcam (GLERL)">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://www.glerl.noaa.gov/metdata/chi/chi01.jpg?t=${bust}`}
            alt="GLERL Chicago lakefront webcam"
            className="w-full rounded-lg border border-white/10"
          />
          <p className="mt-2 text-[11px] text-slate-500">NOAA GLERL Chicago camera — nearest public lakefront view.</p>
        </Panel>

        {/* Forecast discussion */}
        <Panel title="NOAA forecast discussion" className="lg:col-span-2">
          {b.discussion ? (
            <details>
              <summary className="cursor-pointer text-sm text-sky-400">
                Read the LOT Area Forecast Discussion
                {b.discussion.issued ? ` (issued ${fmtLocalTime(new Date(b.discussion.issued))})` : ""}
              </summary>
              <pre className="scroll-thin mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-xs leading-relaxed text-slate-300">
                {b.discussion.text}
              </pre>
            </details>
          ) : (
            <p className="text-sm text-slate-500">Discussion unavailable right now.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-200">{value}</dd>
    </div>
  );
}

function Note({ label, text }: { label: string; text: string }) {
  return (
    <li>
      <span className="font-semibold text-slate-300">{label}:</span> <span className="text-slate-400">{text}</span>
    </li>
  );
}

function Loading({ name }: { name: string }) {
  return (
    <div>
      <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">← All harbors</Link>
      <h1 className="mt-3 text-2xl font-bold">{name}</h1>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-40 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]" />
        ))}
      </div>
    </div>
  );
}

function NotFound() {
  return <Message>Harbor not found. <Link href="/" className="text-sky-400">Back to the board</Link>.</Message>;
}

function Message({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-slate-300">{children}</div>;
}
