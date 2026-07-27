"use client";

import Link from "next/link";
import { Conditions, Rating } from "@/lib/types";
import { degToCompass } from "@/lib/units";
import { BoatProfile } from "@/lib/boats";
import { STATUS_META, statusLabel } from "./status-meta";

function stat(label: string, value: string) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-sm font-medium text-slate-200">{value}</div>
    </div>
  );
}

export function HarborCard({
  id,
  name,
  conditions: c,
  rating: r,
  boat,
  favorite = false,
  onToggleFavorite,
}: {
  id: string;
  name: string;
  conditions: Conditions;
  rating: Rating;
  boat?: BoatProfile;
  favorite?: boolean;
  onToggleFavorite?: () => void;
}) {
  const meta = STATUS_META[r.status];
  const wind =
    c.windKt == null
      ? "—"
      : `${c.windDir != null ? degToCompass(c.windDir) + " " : ""}${Math.round(c.windKt)} kt${c.gustKt ? ` g${Math.round(c.gustKt)}` : ""}`;

  return (
    <Link
      href={`/harbor/${id}`}
      className={`group block rounded-2xl border ${meta.border} ${meta.soft} p-4 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/30`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
            <h3 className="truncate font-semibold text-slate-100">{name}</h3>
            {(c.storm?.level === "active" || c.storm?.level === "elevated") && (
              <span title="Thunderstorm risk" className="shrink-0">⛈</span>
            )}
          </div>
          <div className={`mt-0.5 text-xs font-medium ${meta.text}`}>{statusLabel(r.status, boat)}</div>
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <div className="text-right text-xs text-slate-500">
            <div className="font-mono text-lg leading-none text-slate-300">{r.status === "unknown" ? "—" : r.score}</div>
            <div>score</div>
          </div>
          {onToggleFavorite && (
            <button
              type="button"
              aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
              aria-pressed={favorite}
              title={favorite ? "Remove from favorites" : "Add to favorites"}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleFavorite();
              }}
              className="-mr-1 -mt-1 rounded-md p-1 text-slate-500 transition hover:text-amber-300"
            >
              <svg
                viewBox="0 0 20 20"
                strokeWidth="1.5"
                strokeLinejoin="round"
                className={`h-[18px] w-[18px] ${favorite ? "fill-amber-400 stroke-amber-400" : "fill-none stroke-current"}`}
              >
                <path d="M10 1.8l2.47 5.01 5.53.8-4 3.9.94 5.5L10 14.4l-4.94 2.6.94-5.5-4-3.9 5.53-.8L10 1.8z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <p className="mt-3 line-clamp-3 min-h-[3.5rem] text-sm text-slate-300">{r.reason}</p>

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/5 pt-3">
        {stat("Wind", wind)}
        {stat("Waves", c.waveFt != null ? `${c.waveFt.toFixed(1)} ft` : "—")}
        {stat("Water", c.waterTempF != null ? `${Math.round(c.waterTempF)}°F` : "—")}
      </div>

      {r.status !== "unknown" && (
        <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-500">
          <span className="flex items-center gap-1">
            exit <b className="font-mono text-slate-300">{r.exitScore}</b>
          </span>
          <span className="flex items-center gap-1">
            open <b className="font-mono text-slate-300">{r.openScore}</b>
          </span>
          <span className="ml-auto text-sky-400 opacity-0 transition group-hover:opacity-100">details →</span>
        </div>
      )}
    </Link>
  );
}
