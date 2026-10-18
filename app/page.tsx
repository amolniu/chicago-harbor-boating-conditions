"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePrefs } from "@/components/prefs";
import { HarborCard } from "@/components/HarborCard";
import { STATUS_META, statusLabel, statusRank } from "@/components/status-meta";
import { getHarbor, REGIONS, regionOf, type RegionId } from "@/lib/harbors";
import { rate, forecastWindGap, lostSourceNote } from "@/lib/rating";
import { RECALL_URL } from "@/lib/recalls";
import { Conditions } from "@/lib/types";

type FilterKey = "all" | "favorites" | RegionId;

interface ApiConditions {
  updatedAt: string;
  harbors: { id: string; name: string; conditions: Conditions }[];
}

function relative(iso: string, now: number): string {
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)} h ago`;
}

export default function Board() {
  const { skill, boat, favorites, toggleFavorite } = usePrefs();
  const [data, setData] = useState<ApiConditions | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<FilterKey>("all");

  async function load() {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/conditions", { cache: "no-store" });
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Initial load + refresh every 5 min. load() sets loading state then fetches.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(t);
      clearInterval(clock);
    };
  }, []);

  useEffect(() => {
    // Remember the last-used filter.
    const f = localStorage.getItem("harborFilter");
    const valid = new Set<string>(["all", "favorites", ...REGIONS.map((r) => r.id)]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (f && valid.has(f)) setFilter(f as FilterKey);
  }, []);
  useEffect(() => {
    localStorage.setItem("harborFilter", filter);
  }, [filter]);


  const ranked = useMemo(() => {
    if (!data) return [];
    return data.harbors
      .map((h) => {
        const harbor = getHarbor(h.id)!;
        return { ...h, rating: rate(harbor, h.conditions, boat, skill) };
      })
      .sort((a, b) => statusRank(a.rating.status) - statusRank(b.rating.status) || b.rating.score - a.rating.score);
  }, [data, boat, skill]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: ranked.length, favorites: 0 };
    for (const r of REGIONS) c[r.id] = 0;
    for (const h of ranked) {
      const rg = regionOf(h.id);
      if (rg) c[rg] += 1;
      if (favorites.includes(h.id)) c.favorites += 1;
    }
    return c;
  }, [ranked, favorites]);

  const filtered = useMemo(() => {
    if (filter === "all") return ranked;
    if (filter === "favorites") return ranked.filter((h) => favorites.includes(h.id));
    return ranked.filter((h) => regionOf(h.id) === filter);
  }, [ranked, filter, favorites]);

  const best = filtered.filter((h) => h.rating.status === "green").slice(0, 3);
  // Harbors whose own buoy/Spotter is out (usually for the winter) and that now rate on
  // the forecast model, capped at Caution. Said once, up front, so a board full of
  // yellow in November reads as "the buoys are out", not "the lake is rough everywhere".
  const onForecast = filtered.filter((h) => forecastWindGap(getHarbor(h.id)!, h.conditions));
  // Blame the season only when it is true of every harbor listed: a fixed station (the
  // crib, Menominee, Fayette) going quiet is a fault, not the calendar.
  const allSeasonal = onForecast.every((h) => lostSourceNote(getHarbor(h.id)!));
  const unchecked = filtered.filter((h) => h.conditions.warningsUnavailable);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Harbor status right now</h1>
          <p className="text-sm text-muted">
            Rated for a <b className="text-fg">{boat.name}</b> · {skill} sailor
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-faint">
          {data && <span>updated {relative(data.updatedAt, now)}</span>}
          <button
            onClick={load}
            className="rounded-md border border-line bg-raised px-3 py-1.5 text-fg hover:text-strong"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Region + favorites filter */}
      {ranked.length > 0 && (
        <div className="mb-5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {(
            [
              { key: "all", label: "All" },
              { key: "favorites", label: "★ Favorites" },
              ...REGIONS.map((r) => ({ key: r.id, label: r.label })),
            ] as { key: FilterKey; label: string }[]
          ).map((chip) => {
            const active = filter === chip.key;
            return (
              <button
                key={chip.key}
                onClick={() => setFilter(chip.key)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition ${
                  active
                    ? "border-brand/50 bg-brand/15 text-brand-fg"
                    : "border-line bg-raised text-muted hover:text-fg"
                }`}
              >
                {chip.label}
                <span className="ml-1.5 font-mono text-xs text-faint">{counts[chip.key] ?? 0}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Best harbor right now */}
      {filtered.length > 0 && (
        <div className="mb-6 rounded-2xl border border-line bg-surface p-4">
          <div className="text-xs uppercase tracking-wide text-faint">Best harbor right now</div>
          {best.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {best.map((h) => (
                <Link
                  key={h.id}
                  href={`/harbor/${h.id}`}
                  className="flex items-center gap-2 rounded-full border border-good/40 bg-good/10 px-3 py-1.5 text-sm text-good-fg hover:bg-good/20"
                >
                  <span className="h-2 w-2 rounded-full bg-good" />
                  {h.name}
                  <span className="font-mono text-good-fg/70">{h.rating.score}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-sm text-fg">
              Nothing is fully green for a {boat.name} right now — {filtered[0].name} is the closest ({filtered[0].rating.score}).
            </p>
          )}
        </div>
      )}

      {unchecked.length > 0 && (
        <div className="mb-6 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn-fg">
          <span aria-hidden="true">⚠ </span>
          {unchecked.length === filtered.length ? (
            <>NWS warnings couldn&apos;t be checked just now, so ratings top out at Caution until they can be.</>
          ) : (
            // Only some failed (one harbor's point lookup): name them — the rest are fine.
            <>
              NWS warnings couldn&apos;t be checked just now for{" "}
              <span className="font-semibold">{unchecked.map((h) => h.name).join(", ")}</span>, so{" "}
              {unchecked.length === 1 ? "its rating tops" : "their ratings top"} out at Caution until they can be.
            </>
          )}{" "}
          Check{" "}
          <a className="underline" href="https://www.weather.gov/" target="_blank" rel="noreferrer">
            weather.gov
          </a>{" "}
          for warnings before you go.
        </div>
      )}

      {onForecast.length > 0 && (
        <div className="mb-6 rounded-xl border border-line bg-raised px-4 py-3 text-sm text-muted">
          <span aria-hidden="true">ℹ </span>
          {onForecast.length === 1 ? (
            <>
              <span className="text-fg">{onForecast[0].name}</span> has lost its own wind source
              {allSeasonal ? " (seasonal buoys come out of the water for the winter)" : ""}, so it rates on the NWS
              forecast model and tops out at Caution until that source is back.
            </>
          ) : (
            <>
              {onForecast.length === filtered.length ? "Every harbor here has" : `${onForecast.length} harbors have`} lost
              their own wind source{allSeasonal ? " (seasonal buoys come out of the water for the winter)" : ""}, so they
              rate on the NWS forecast model and top out at Caution until those sources are back:{" "}
              <span className="text-fg">{onForecast.map((h) => h.name).join(", ")}</span>.
            </>
          )}
        </div>
      )}

      {loading && !data && <SkeletonGrid />}
      {error && (
        <div className="rounded-xl border border-bad/40 bg-bad/10 p-4 text-sm text-bad-fg">
          Couldn&apos;t load live conditions. NOAA/NDBC may be briefly unavailable — try Refresh.
        </div>
      )}

      {data && !loading && filter === "favorites" && filtered.length === 0 && (
        <div className="rounded-xl border border-line bg-surface p-6 text-center text-sm text-muted">
          No favorites yet — tap the ☆ on any harbor to pin it here.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((h) => (
          <HarborCard
            key={h.id}
            id={h.id}
            name={h.name}
            conditions={h.conditions}
            rating={h.rating}
            boat={boat}
            favorite={favorites.includes(h.id)}
            onToggleFavorite={() => toggleFavorite(h.id)}
          />
        ))}
      </div>

      {ranked.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-4 text-xs text-faint">
          {(["green", "yellow", "red"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${STATUS_META[s].dot}`} />
              {statusLabel(s, boat)}
            </span>
          ))}
        </div>
      )}

      <RecallBanner />
    </div>
  );
}

/** Sister-site banner. Sits BELOW the board on purpose: the harbor grid is what someone
 *  opened the app to read, and a promo above it would push the actual answer down the
 *  page. Named as ours rather than dressed up as a third-party notice. */
function RecallBanner() {
  return (
    <a
      href={RECALL_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-brand/30 bg-brand/5 px-4 py-3 hover:bg-brand/10"
    >
      <span aria-hidden="true">📡</span>
      <span className="text-sm font-semibold text-strong">Recall Monitor</span>
      <span className="text-sm text-fg">
        Boats, engines, lifejackets and more — recall alerts across US and Canadian databases.
      </span>
      <span className="ml-auto whitespace-nowrap text-sm text-brand">Our sister site ↗</span>
    </a>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-44 animate-pulse rounded-2xl border border-line bg-surface" />
      ))}
    </div>
  );
}
