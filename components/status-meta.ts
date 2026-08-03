// UI styling for each status. Pure data — safe to import anywhere.

import { Status } from "@/lib/types";
import { BoatProfile, CraftKind } from "@/lib/boats";

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
    dot: "bg-good",
    text: "text-good-fg",
    soft: "bg-good/10",
    border: "border-good/40",
    bar: "bg-good",
  },
  yellow: {
    label: "Caution",
    dot: "bg-warn",
    text: "text-warn-fg",
    soft: "bg-warn/10",
    border: "border-warn/40",
    bar: "bg-warn",
  },
  red: {
    label: "Stay in",
    dot: "bg-bad",
    text: "text-bad-fg",
    soft: "bg-bad/10",
    border: "border-bad/40",
    bar: "bg-bad",
  },
  unknown: {
    label: "No data",
    dot: "bg-idle",
    text: "text-muted",
    soft: "bg-idle/10",
    border: "border-line",
    bar: "bg-idle",
  },
};

/** Status label for the selected craft. Only the green label changes: it's a call to
 *  action, and "Go sailing" is wrong on a paddleboard. Yellow/red/unknown read the same
 *  whatever you're on. Boats without a craft (incl. custom ones) default to sail. */
const GO_LABEL: Record<CraftKind, string> = {
  sail: "Go sailing",
  paddle: "Go kayaking / paddleboarding",
};

export function statusLabel(status: Status, boat?: BoatProfile): string {
  if (status === "green") return GO_LABEL[boat?.craft ?? "sail"];
  return STATUS_META[status].label;
}

const ORDER: Record<Status, number> = { green: 0, yellow: 1, red: 2, unknown: 3 };
export function statusRank(s: Status): number {
  return ORDER[s];
}
