// Sail-window engine. Instead of only answering "can I go right now?", it scores
// the next ~24 daylight hours and finds the best block to sail — "Best window:
// 8–11 AM" or "Conditions improve after 5 PM" — so users can plan, not just react.
//
// NWS gives us hourly wind, but not hourly wave height nearshore. We estimate the
// wind-sea from wind speed + direction (fetch), which is a rough but monotonic
// signal — clearly an estimate, good enough to rank hours against each other.

import { ForecastHour, Status } from "./types";
import { Harbor, lakeFetchFactor } from "./harbors";
import { BoatProfile, Skill } from "./boats";
import { rate } from "./rating";

const TZ = "America/Chicago";

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

function localHour(iso: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false }).format(new Date(iso)),
  ) % 24;
}

function fmtHour(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: true })
    .format(new Date(iso))
    .replace(" ", " ");
}

export function computeWindow(
  harbor: Harbor,
  forecast: ForecastHour[],
  boat: BoatProfile,
  skill: Skill,
  sunrise: Date | null,
  sunset: Date | null,
  stormHours: string[] = [],
): SailWindow {
  const stormy = new Set(stormHours);
  const next = forecast.slice(0, 24);
  const scored: ScoredHour[] = next.map((h) => {
    const r = rate(
      harbor,
      {
        windDir: h.windDir, windKt: h.windKt, gustKt: h.gustKt,
        waveFt: h.waveFt, wavePeriodS: null, waveDir: h.windDir,
        waterTempF: null, airTempF: null, advisory: "none",
        source: "forecast", observedAt: h.time,
      },
      boat,
      skill,
    );
    const t = new Date(h.time);
    const daylight = sunrise && sunset ? isDaylight(t, sunrise, sunset) : true;
    // A forecast hour with thunderstorms is red regardless of wind/wave.
    const isStorm = stormy.has(h.time);
    return {
      time: h.time, hour: localHour(h.time),
      status: isStorm ? "red" : r.status,
      score: isStorm ? 0 : r.score,
      windKt: h.windKt, windDir: h.windDir, waveFt: h.waveFt, daylight,
    };
  });

  const daytime = scored.filter((s) => s.daylight);
  const summary = summarize(daytime);
  return { summary, hours: scored };
}

// Sunrise/sunset are for the harbor's own day; a forecast hour is "daylight" if
// its clock time falls between them (compared on hour-of-day to span multiple days).
function isDaylight(t: Date, sunrise: Date, sunset: Date): boolean {
  const h = t.getHours() + t.getMinutes() / 60;
  const sr = sunrise.getHours() + sunrise.getMinutes() / 60;
  const ss = sunset.getHours() + sunset.getMinutes() / 60;
  return h >= sr - 0.5 && h <= ss + 0.5;
}

function bestRun(hours: ScoredHour[], target: Status): ScoredHour[] | null {
  let best: ScoredHour[] | null = null;
  let cur: ScoredHour[] = [];
  const flush = () => {
    if (cur.length && (!best || cur.length > best.length)) best = cur;
    cur = [];
  };
  for (const h of hours) {
    if (h.status === target) cur.push(h);
    else flush();
  }
  flush();
  return best;
}

function runLabel(run: ScoredHour[]): string {
  const start = fmtHour(run[0].time);
  const endIso = new Date(new Date(run[run.length - 1].time).getTime() + 3600_000).toISOString();
  return `${start}–${fmtHour(endIso)}`;
}

function summarize(daytime: ScoredHour[]): string {
  if (!daytime.length) return "No daylight hours in range.";

  const nowGreen = daytime[0].status === "green";
  const green = bestRun(daytime, "green");
  const yellow = bestRun(daytime, "yellow");

  if (green && green.length >= 2) {
    if (green[0].time === daytime[0].time) {
      return `Good to go now — green through ${runLabel(green).split("–")[1]}.`;
    }
    return `Best window today: ${runLabel(green)} (green).`;
  }
  if (nowGreen) return "Green right now, but the good window is short — go soon.";
  if (yellow && yellow.length >= 2) {
    if (yellow[0].time === daytime[0].time) return `Marginal now; sailable (yellow) until ${runLabel(yellow).split("–")[1]}.`;
    return `Nothing green today. Best you'll get is yellow ${runLabel(yellow)}.`;
  }
  return "Conditions stay rough through the outlook — no good window in the next 24 h.";
}
