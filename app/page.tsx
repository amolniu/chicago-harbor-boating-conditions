"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePrefs } from "@/components/prefs";
import { HarborCard } from "@/components/HarborCard";
import { STATUS_META, statusRank } from "@/components/status-meta";
import { getHarbor } from "@/lib/harbors";
import { rate } from "@/lib/rating";
import { Conditions } from "@/lib/types";

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
  const { skill, boat } = usePrefs();
  const [data, setData] = useState<ApiConditions | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

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


  const ranked = useMemo(() => {
    if (!data) return [];
    return data.harbors
      .map((h) => {
        const harbor = getHarbor(h.id)!;
        return { ...h, rating: rate(harbor, h.conditions, boat, skill) };
      })
      .sort((a, b) => statusRank(a.rating.status) - statusRank(b.rating.status) || b.rating.score - a.rating.score);
  }, [data, boat, skill]);

  const best = ranked.filter((h) => h.rating.status === "green").slice(0, 3);

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

      {/* Best harbor right now */}
      {ranked.length > 0 && (
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
              Nothing is fully green for a {boat.name} right now — {ranked[0].name} is the closest ({ranked[0].rating.score}).
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ranked.map((h) => (
          <HarborCard key={h.id} id={h.id} name={h.name} conditions={h.conditions} rating={h.rating} />
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
