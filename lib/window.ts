// Sail-window engine. Instead of only answering "can I go right now?", it scores
// the next ~24 daylight hours and finds the best block to sail — "Best window:
// 8–11 AM" or "Conditions improve after 5 PM" — so users can plan, not just react.
//
// NWS gives us hourly wind, but not hourly wave height nearshore. We estimate the
// wind-sea from wind speed + direction (fetch), which is a rough but monotonic
// signal — clearly an estimate, good enough to rank hours against each other.

import { ForecastHour, Status, type Conditions } from "./types";
import { Harbor, lakeFetchFactor } from "./harbors";
import { BoatProfile, Skill } from "./boats";
import { rate } from "./rating";
import { overlaps, worstAdvisory, sortAlerts } from "./alerts";
import { localDate, DEFAULT_TZ_FALLBACK } from "./history";

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

/** Rough wind-sea estimate (ft) for Chicago's fetch. Capped; clearly approximate. */
export function estimateWaveFt(windKt: number, windDir: number): number {
  return Math.min(8, 0.016 * windKt * windKt * lakeFetchFactor(windDir));
}

export interface ScoredHour {
  time: string;
  hour: number; // local hour 0–23
  status: Status;
  score: number;
  windKt: number;
  windDir: number;
  waveFt: number;
  daylight: boolean;
}

export interface SailWindow {
  summary: string;
  hours: ScoredHour[];
}

function localHour(iso: string, tz: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date(iso)),
  ) % 24;
}

function fmtHour(iso: string, tz: string): string {
  // Non-breaking, so "7 AM" never wraps. Some ICU builds already emit U+202F here.
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: true })
    .format(new Date(iso))
    .replace(/\s/, " ");
}

export function computeWindow(
  harbor: Harbor,
  forecast: ForecastHour[],
  boat: BoatProfile,
  skill: Skill,
  sunrise: Date | null,
  sunset: Date | null,
  ctx: {
    /** Top-of-hour ISO times HRRR flags as thunderstorm-likely: forced red. */
    stormHours?: string[];
    /** From the harbor's LIVE conditions, applied to every forecast hour the way the
     *  header applies them, so the page can't say "Caution" above "Good to go now":
     *  • windBasis "model" for a harbor that normally observes its wind caps each hour
     *    at Caution (forecastWindGap); model-only harbors are unaffected.
     *  • hazards: each advisory/warning caps exactly the hours its [onset, ends) covers —
     *    a Small Craft Advisory "from 8 PM" caps from 8 PM, not before, and stops at its
     *    end. Until 2026-10-18 the window rated every hour with advisory "none".
     *  • warningsUnavailable: NWS warnings couldn't be checked, so no hour may say "go". */
    live?: Pick<Conditions, "windBasis" | "hazards" | "warningsUnavailable">;
  } = {},
): SailWindow {
  // Clock times in the HARBOR's zone: Michigan's east shore keeps Eastern time.
  const tz = harbor.timezone ?? DEFAULT_TZ_FALLBACK;
  const stormy = new Set(ctx.stormHours ?? []);
  const hazards = ctx.live?.hazards ?? [];
  const next = forecast.slice(0, 24);
  const scored: ScoredHour[] = next.map((h) => {
    const from = Date.parse(h.time);
    const during = hazards.filter((z) => overlaps(z, from, from + HOUR_MS));
    const r = rate(
      harbor,
      {
        windDir: h.windDir, windKt: h.windKt, gustKt: h.gustKt,
        waveFt: h.waveFt, wavePeriodS: null, waveDir: h.windDir,
        waterTempF: null, airTempF: null,
        advisory: worstAdvisory(during),
        // Sorted: rate() names the cap after the first, most constraining alert.
        alerts: sortAlerts(
          during
            // Stop-level stays stop even when it also carries an advisory tier (Hurricane
            // Force Wind Warning): it pins the hour to 0, not the storm cap of 5.
            .filter((z) => (!z.advisory || z.level === "stop") && z.level !== "info")
            .map((z) => ({ event: z.event, headline: null, level: z.level, onset: z.onset, ends: z.ends })),
        ),
        source: "forecast", observedAt: h.time,
        windBasis: ctx.live?.windBasis === "model" ? "model" : undefined,
        warningsUnavailable: ctx.live?.warningsUnavailable,
      },
      boat,
      skill,
    );
    const daylight = sunrise && sunset ? isDaylight(from, sunrise, sunset) : true;
    // A forecast hour with thunderstorms is red regardless of wind/wave.
    const isStorm = stormy.has(h.time);
    return {
      time: h.time, hour: localHour(h.time, tz),
      status: isStorm ? "red" : r.status,
      score: isStorm ? 0 : r.score,
      windKt: h.windKt, windDir: h.windDir, waveFt: h.waveFt, daylight,
    };
  });

  const summary = summarize(scored, tz);
  return { summary, hours: scored };
}

// Sunrise/sunset are for one day, and the forecast spans two. Shift them by whole days
// to the day nearest the hour (by solar midday), then compare instants: no clock or
// zone involved, so it holds in any browser. Sun times drift ~2 min/day — negligible.
// An hour counts if it STARTS no more than 30 min before sunrise and ENDS no more than
// 30 min after sunset, so "green through X" is never more than half an hour past dark.
// Until 2026-10-21 the sunset side tested the hour's start: with a 6:54 PM sunset the
// 7 PM hour counted, and the window read "Good to go now — green through 8 PM".
function isDaylight(t: number, sunrise: Date, sunset: Date): boolean {
  const k = Math.round((t - (sunrise.getTime() + sunset.getTime()) / 2) / DAY_MS);
  return t >= sunrise.getTime() + k * DAY_MS - HOUR_MS / 2 && t + HOUR_MS <= sunset.getTime() + k * DAY_MS + HOUR_MS / 2;
}

// A run is consecutive HOURS, not consecutive entries: with the night filtered out,
// today's 6 PM sits next to tomorrow's 7 AM, and until 2026-10-20 they merged into
// "Best window today: 4 PM–10 AM". A gap in time ends a run just as a status change does.
function bestRun(hours: ScoredHour[], target: Status): ScoredHour[] | null {
  let best: ScoredHour[] | null = null;
  let cur: ScoredHour[] = [];
  const flush = () => {
    if (cur.length && (!best || cur.length > best.length)) best = cur;
    cur = [];
  };
  for (const h of hours) {
    const prev = cur[cur.length - 1];
    if (prev && Date.parse(h.time) - Date.parse(prev.time) > HOUR_MS) flush();
    if (h.status === target) cur.push(h);
    else flush();
  }
  flush();
  return best;
}

interface Clock {
  tz: string;
  /** The harbor's calendar date at the first forecast hour. */
  today: string;
}

const dayOf = (iso: string, c: Clock) => localDate(new Date(iso), c.tz);

/** When the run ends: the top of the hour after its last one. */
function runEnd(run: ScoredHour[], c: Clock): string {
  return fmtHour(new Date(Date.parse(run[run.length - 1].time) + HOUR_MS).toISOString(), c.tz);
}

/** "4–7 PM", "11 AM–2 PM"; prefixed with the day unless it's today: "tomorrow 7–10 AM". */
function runLabel(run: ScoredHour[], c: Clock): string {
  const start = fmtHour(run[0].time, c.tz);
  const end = runEnd(run, c);
  const range = start.slice(-2) === end.slice(-2) ? `${start.slice(0, -3)}–${end}` : `${start}–${end}`;
  const days = Math.round((Date.parse(dayOf(run[0].time, c)) - Date.parse(c.today)) / DAY_MS);
  if (days === 0) return range;
  if (days === 1) return `tomorrow ${range}`;
  return `${new Intl.DateTimeFormat("en-US", { timeZone: c.tz, weekday: "long" }).format(new Date(run[0].time))} ${range}`;
}

function summarize(scored: ScoredHour[], tz: string): string {
  const daytime = scored.filter((s) => s.daylight);
  if (!daytime.length) return "No daylight hours in range.";

  const c: Clock = { tz, today: localDate(new Date(scored[0].time), tz) };
  // "Now" is the first forecast hour — while it's light. After dark the first daylight
  // hour is tomorrow morning, and that must not read as "Good to go now".
  const now = daytime[0] === scored[0] ? daytime[0] : null;
  const isToday = (run: ScoredHour[]) => dayOf(run[0].time, c) === c.today;
  // Today's best window first, even when tomorrow's is longer: at 3 PM, "go now, green
  // through 7 PM" beats "tomorrow 7 AM–3 PM". Tomorrow only when today has none.
  const todayHours = daytime.filter((h) => dayOf(h.time, c) === c.today);
  const best = (target: Status) =>
    [todayHours, daytime].map((hs) => bestRun(hs, target)).find((r) => r && r.length >= 2) ?? null;

  const green = best("green");
  if (green) {
    if (green[0] === now) return `Good to go now — green through ${runEnd(green, c)}.`;
    return isToday(green) ? `Best window today: ${runLabel(green, c)} (green).` : `Best window: ${runLabel(green, c)} (green).`;
  }
  if (now?.status === "green") return "Green right now, but the good window is short — go soon.";
  const yellow = best("yellow");
  if (yellow) {
    if (yellow[0] === now) return `Marginal now; sailable (yellow) until ${runEnd(yellow, c)}.`;
    return `No green window in the next 24 h. Best you'll get is yellow ${runLabel(yellow, c)}${isToday(yellow) ? " today" : ""}.`;
  }
  return "Conditions stay rough through the outlook — no good window in the next 24 h.";
}
