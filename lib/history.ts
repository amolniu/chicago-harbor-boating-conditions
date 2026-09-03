// Historical context — "rougher than 90% of September afternoons", "green 7 of the
// last 10 days". Pure + isomorphic on purpose: the server aggregates snapshots into
// one compact summary per DAY-AFTERNOON, and the browser re-rates those days with the
// user's own boat + skill (same convention as the board — personalization never
// happens server-side). The unit of comparison is an afternoon (12:00–18:00 local),
// because that's when people decide whether to go out, and because it makes the
// percentile claim honest: we compare afternoons to afternoons, not to 3 AM calms.

import type { Harbor } from "./harbors";
import type { BoatProfile, Skill } from "./boats";
import type { Conditions, Status } from "./types";
import { rate } from "./rating";

/** One day's afternoon, averaged from its snapshots. The server builds these. */
export interface DaySummary {
  /** Local calendar date, YYYY-MM-DD, in the harbor's timezone. */
  date: string;
  windKt: number | null;
  gustKt: number | null;
  /** Circular mean — 350° and 10° average to 0°, not 180°. */
  windDir: number | null;
  waveFt: number | null;
  wavePeriodS: number | null;
  waveDir: number | null;
  waterTempF: number | null;
  /** Worst advisory seen that afternoon. */
  advisory: Conditions["advisory"];
  /** Snapshot count behind the averages — a 1-sample day is weak evidence. */
  samples: number;
}

export const DEFAULT_TZ_FALLBACK = "America/Chicago";

/** Minimum days before percentile copy is worth showing at all. */
export const MIN_DAYS_FOR_PERCENTILE = 8;
/** Prefer same-calendar-month comparisons once the month has this many days. */
export const MIN_DAYS_FOR_MONTH_BUCKET = 8;
/** The streak window: "green X of the last N days". */
export const STREAK_DAYS = 10;

const ADVISORY_RANK: Record<Conditions["advisory"], number> = {
  none: 0,
  small_craft: 1,
  gale: 2,
  storm: 3,
};

export function worstAdvisory(list: Conditions["advisory"][]): Conditions["advisory"] {
  return list.reduce((a, b) => (ADVISORY_RANK[b] > ADVISORY_RANK[a] ? b : a), "none");
}

/** Circular mean of bearings (degrees). Null when the list is empty. */
export function circularMeanDeg(dirs: number[]): number | null {
  if (!dirs.length) return null;
  let x = 0;
  let y = 0;
  for (const d of dirs) {
    x += Math.cos((d * Math.PI) / 180);
    y += Math.sin((d * Math.PI) / 180);
  }
  // All-cancelling directions (e.g. 0° and 180°) have no meaningful mean.
  if (Math.hypot(x, y) < 1e-9) return null;
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

interface SnapshotLike {
  takenAt: Date;
  windDir: number | null;
  windKt: number | null;
  gustKt: number | null;
  waveFt: number | null;
  wavePeriodS: number | null;
  waveDir: number | null;
  waterTempF: number | null;
  advisory: string;
}

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

/** Local calendar date for a timestamp in the harbor's timezone. */
function localDate(t: Date, timezone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
}

/** Collapse afternoon snapshots (already hour-filtered by the query) into one
 *  DaySummary per local day, newest first. */
export function summarizeAfternoons(rows: SnapshotLike[], timezone: string): DaySummary[] {
  const byDay = new Map<string, SnapshotLike[]>();
  for (const r of rows) {
    const d = localDate(r.takenAt, timezone);
    const g = byDay.get(d);
    if (g) g.push(r);
    else byDay.set(d, [r]);
  }
  const num = (pick: (r: SnapshotLike) => number | null) => (g: SnapshotLike[]) =>
    mean(g.map(pick).filter((v): v is number => v != null));
  const out: DaySummary[] = [];
  for (const [date, g] of byDay) {
    out.push({
      date,
      windKt: num((r) => r.windKt)(g),
      gustKt: num((r) => r.gustKt)(g),
      windDir: circularMeanDeg(g.map((r) => r.windDir).filter((v): v is number => v != null)),
      waveFt: num((r) => r.waveFt)(g),
      wavePeriodS: num((r) => r.wavePeriodS)(g),
      waveDir: num((r) => r.waveDir)(g),
      waterTempF: num((r) => r.waterTempF)(g),
      advisory: worstAdvisory(g.map((r) => r.advisory as Conditions["advisory"])),
      samples: g.length,
    });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** A day re-rated for a specific boat + skill. Days without wind can't be rated. */
export interface RatedDay {
  date: string;
  status: Status;
  score: number;
}

export function rateDay(day: DaySummary, harbor: Harbor, boat: BoatProfile, skill: Skill): RatedDay {
  if (day.windKt == null) return { date: day.date, status: "unknown", score: 0 };
  const c: Conditions = {
    windDir: day.windDir,
    windKt: day.windKt,
    gustKt: day.gustKt,
    waveFt: day.waveFt,
    wavePeriodS: day.wavePeriodS,
    waveDir: day.waveDir,
    waterTempF: day.waterTempF,
    airTempF: null,
    advisory: day.advisory,
    source: "history",
    observedAt: null,
    // Storm outlooks and NWS alerts aren't reconstructable per historical afternoon;
    // the percentile compares the enduring stuff — wind, waves, advisories.
  };
  const r = rate(harbor, c, boat, skill);
  return { date: day.date, status: r.status, score: r.score };
}

export interface GreenStreak {
  green: number;
  rated: number;
  window: number;
}

/** "Green X of the last N days", skipping today (it isn't over yet) and unrated days. */
export function greenStreak(
  days: DaySummary[],
  harbor: Harbor,
  boat: BoatProfile,
  skill: Skill,
  today: string,
  window = STREAK_DAYS,
): GreenStreak {
  const past = days.filter((d) => d.date < today).slice(0, window);
  const rated = past.map((d) => rateDay(d, harbor, boat, skill)).filter((r) => r.status !== "unknown");
  return { green: rated.filter((r) => r.status === "green").length, rated: rated.length, window };
}

export interface Percentile {
  /** Share (0–100) of comparison afternoons that were CALMER than today — i.e.
   *  "rougher than {pct}% of {bucketLabel}". */
  roughness: number;
  bucketLabel: string;
  comparedDays: number;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Where today's afternoon sits against history, re-rated for this boat + skill.
 *  Uses same-calendar-month afternoons when enough exist (so August is judged
 *  against Augusts), otherwise every recorded afternoon. Null until there's enough
 *  history to make the claim honestly, or when today can't be rated. */
export function roughnessPercentile(
  days: DaySummary[],
  harbor: Harbor,
  boat: BoatProfile,
  skill: Skill,
  today: string,
): Percentile | null {
  const todaySummary = days.find((d) => d.date === today);
  if (!todaySummary) return null;
  const todayRated = rateDay(todaySummary, harbor, boat, skill);
  if (todayRated.status === "unknown") return null;

  const past = days.filter((d) => d.date !== today);
  const month = Number(today.slice(5, 7)) - 1;
  const sameMonth = past.filter((d) => Number(d.date.slice(5, 7)) - 1 === month);
  const useMonth = sameMonth.length >= MIN_DAYS_FOR_MONTH_BUCKET;
  const bucket = useMonth ? sameMonth : past;
  if (bucket.length < MIN_DAYS_FOR_PERCENTILE) return null;

  const scores = bucket
    .map((d) => rateDay(d, harbor, boat, skill))
    .filter((r) => r.status !== "unknown")
    .map((r) => r.score);
  if (scores.length < MIN_DAYS_FOR_PERCENTILE) return null;

  // Rougher = lower score. Count comparison days that were calmer (scored higher).
  const calmer = scores.filter((s) => s > todayRated.score).length;
  return {
    roughness: Math.round((calmer / scores.length) * 100),
    bucketLabel: useMonth ? `${MONTHS[month]} afternoons` : "recorded afternoons",
    comparedDays: scores.length,
  };
}
