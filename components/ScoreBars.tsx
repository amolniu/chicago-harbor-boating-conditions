// The "launch score" split: harbor-exit ease vs open-lake comfort. Some days are
// fine offshore but ugly getting in and out of the gap — this makes that visible.

import { STATUS_META } from "./status-meta";
import { Status } from "@/lib/types";

function scoreStatus(score: number): Status {
  if (score >= 60) return "green";
  if (score >= 30) return "yellow";
  return "red";
}

function Bar({ label, score, hint }: { label: string; score: number; hint: string }) {
  const meta = STATUS_META[scoreStatus(score)];
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-medium text-fg">{label}</span>
        <span className={meta.text}>{score}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-raised">
        <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${Math.max(3, score)}%` }} />
      </div>
      <div className="mt-1 text-[11px] text-faint">{hint}</div>
    </div>
  );
}

export function ScoreBars({ exitScore, openScore }: { exitScore: number; openScore: number }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <Bar label="Harbor exit" score={exitScore} hint="threading the gap & docking" />
      <Bar label="Open lake" score={openScore} hint="sailing offshore" />
    </div>
  );
}
