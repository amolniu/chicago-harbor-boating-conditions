// UI styling for each status. Pure data — safe to import anywhere.

import { Status } from "@/lib/types";

export interface StatusMeta {
  label: string;
  dot: string;
  text: string;
  soft: string;
  border: string;
  bar: string;
}

export const STATUS_META: Record<Status, StatusMeta> = {
  green: {
    label: "Go sailing",
    dot: "bg-emerald-400",
    text: "text-emerald-300",
    soft: "bg-emerald-500/10",
    border: "border-emerald-500/40",
    bar: "bg-emerald-400",
  },
  yellow: {
    label: "Caution",
    dot: "bg-amber-400",
    text: "text-amber-300",
    soft: "bg-amber-500/10",
    border: "border-amber-500/40",
    bar: "bg-amber-400",
  },
  red: {
    label: "Stay in",
    dot: "bg-rose-500",
    text: "text-rose-300",
    soft: "bg-rose-500/10",
    border: "border-rose-500/40",
    bar: "bg-rose-500",
  },
  unknown: {
    label: "No data",
    dot: "bg-slate-500",
    text: "text-slate-400",
    soft: "bg-slate-500/10",
    border: "border-slate-600/40",
    bar: "bg-slate-500",
  },
};

const ORDER: Record<Status, number> = { green: 0, yellow: 1, red: 2, unknown: 3 };
export function statusRank(s: Status): number {
  return ORDER[s];
}
