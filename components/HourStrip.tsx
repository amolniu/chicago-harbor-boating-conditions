// The next-24h sail-window strip: one cell per forecast hour, colored by rating,
// daylight hours emphasized. Turns "when is it good?" into a glance.

import type { ScoredHour } from "@/lib/window";
import { STATUS_META } from "./status-meta";
import { degToCompass } from "@/lib/units";

const TZ = "America/Chicago";
const fmtHour = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: true }).format(new Date(iso)).replace(" ", "");

export function HourStrip({ hours }: { hours: ScoredHour[] }) {
  if (!hours.length) return <div className="text-sm text-faint">No hourly forecast available.</div>;
  return (
    <div className="scroll-thin overflow-x-auto pb-1">
      <div className="flex gap-1">
        {hours.map((h) => (
          <div key={h.time} className="flex w-11 shrink-0 flex-col items-center gap-1" title={`${fmtHour(h.time)} · ${Math.round(h.windKt)} kt ${degToCompass(h.windDir)} · ~${h.waveFt.toFixed(1)} ft`}>
            <div className="text-[10px] text-faint">{fmtHour(h.time)}</div>
            <div
              className={`h-8 w-full rounded ${STATUS_META[h.status].bar} ${h.daylight ? "" : "opacity-30"}`}
            />
            <div className="text-[10px] font-mono text-muted">{Math.round(h.windKt)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
