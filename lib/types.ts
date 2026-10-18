// Shared domain types used across the data layer, rules engine, and UI.

import type { WeatherAlert, HazardPeriod } from "./alerts";

export type Status = "green" | "yellow" | "red" | "unknown";

/** Canonical, unit-normalized conditions at a harbor at one moment in time. */
export interface Conditions {
  /** Wind direction the wind blows FROM, degrees true. */
  windDir: number | null;
  /** Sustained wind speed, knots. */
  windKt: number | null;
  /** Gust speed, knots. */
  gustKt: number | null;
  /** Significant wave height on the open lake, feet. */
  waveFt: number | null;
  /** Dominant wave period, seconds. */
  wavePeriodS: number | null;
  /** Direction waves come FROM, degrees true. */
  waveDir: number | null;
  /** Water temperature, °F. */
  waterTempF: number | null;
  /** Air temperature, °F. */
  airTempF: number | null;
  /** Highest active marine advisory, if any. */
  advisory: Advisory;
  /** Where the wind/wave numbers came from (buoy id or "forecast"). */
  source: string;
  /** What kind of source the wind SPEED came from: the harbor's own station, a
   *  same-shore neighbour, a validated Spotter, or the NWS gridpoint model. Lets the
   *  rating tell "this harbor is model-only by design" from "its buoy is out of the
   *  water and it has fallen to the model" (see forecastWindGap in lib/rating.ts).
   *  Optional: history summaries are rebuilt without it, and must not be capped. */
  windBasis?: WindBasis;
  /** ISO timestamp of the underlying observation. */
  observedAt: string | null;
  /** Regional HRRR thunderstorm/convective outlook (same across nearby harbors). */
  storm?: StormRisk;
  /** Active NWS watches/warnings covering this harbor, most constraining first.
   *  Separate from `advisory` (marine zone products) and `storm` (HRRR model): only
   *  this carries things like a Tornado Warning. */
  alerts?: WeatherAlert[];
  /** Every advisory/warning affecting the harbor, current OR scheduled, with its start
   *  and end — so the sail window can cap exactly the hours each one covers. */
  hazards?: HazardPeriod[];
  /** True when NWS warnings could not be checked (the feed failed): ratings top out at
   *  Caution, because "we couldn't ask" must never read as "all clear". */
  warningsUnavailable?: boolean;
}

export type Advisory = "none" | "small_craft" | "gale" | "storm";

export type WindBasis = "station" | "neighbor" | "spotter" | "model";

/** Compact HRRR storm signal carried on Conditions (see lib/storm.ts). */
export interface StormRisk {
  level: "none" | "watch" | "elevated" | "active";
  headline: string;
  capeNow: number | null;
}

/** A single hour of forecast, used by the sail-window engine. */
export interface ForecastHour {
  time: string; // ISO
  windDir: number;
  windKt: number;
  gustKt: number;
  /** Estimated open-lake wave height, feet (see lib/window.ts). */
  waveFt: number;
}

/** Result of scoring one harbor for one boat + skill. */
export interface Rating {
  status: Status;
  /** 0–100 overall comfort score (min of exit and open). */
  score: number;
  /** Open-lake sailing comfort, 0–100. */
  openScore: number;
  /** Harbor exit/entrance ease, 0–100. */
  exitScore: number;
  /** Plain-English explanation naming the binding factor. */
  reason: string;
  /** Short label of the limiting factor, e.g. "exit waves", "gusts". */
  limiter: string;
}
