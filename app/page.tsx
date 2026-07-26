"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePrefs } from "@/components/prefs";
import { HarborCard } from "@/components/HarborCard";
import { STATUS_META, statusRank } from "@/components/status-meta";
import { getHarbor, REGIONS, regionOf, type RegionId } from "@/lib/harbors";
import { rate } from "@/lib/rating";
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

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Harbor status right now</h1>
          <p className="text-sm text-slate-400">
            Rated for a <b className="text-slate-200">{boat.name}</b> · {skill} sailor
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {data && <span>updated {relative(data.updatedAt, now)}</span>}
          <button
            onClick={load}
            className="rounded-md border border-white/10 bg-slate-900 px-3 py-1.5 text-slate-300 hover:text-white"
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
                    ? "border-sky-400/50 bg-sky-500/15 text-sky-200"
                    : "border-white/10 bg-slate-900 text-slate-400 hover:text-slate-200"
                }`}
              >
                {chip.label}
                <span className="ml-1.5 font-mono text-xs text-slate-500">{counts[chip.key] ?? 0}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Best harbor right now */}
      {filtered.length > 0 && (
        <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Best harbor right now</div>
          {best.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {best.map((h) => (
                <Link
                  key={h.id}
                  href={`/harbor/${h.id}`}
                  className="flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/20"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  {h.name}
                  <span className="font-mono text-emerald-300/70">{h.rating.score}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-sm text-slate-300">
              Nothing is fully green for a {boat.name} right now — {filtered[0].name} is the closest ({filtered[0].rating.score}).
            </p>
          )}
        </div>
      )}

      {loading && !data && <SkeletonGrid />}
      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
          Couldn&apos;t load live conditions. NOAA/NDBC may be briefly unavailable — try Refresh.
        </div>
      )}

      {data && !loading && filter === "favorites" && filtered.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-400">
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
            favorite={favorites.includes(h.id)}
            onToggleFavorite={() => toggleFavorite(h.id)}
          />
        ))}
      </div>

      {ranked.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-4 text-xs text-slate-500">
          {(["green", "yellow", "red"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${STATUS_META[s].dot}`} />
              {STATUS_META[s].label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-44 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]" />
      ))}
    </div>
  );
}
