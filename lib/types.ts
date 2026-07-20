// Shared domain types used across the data layer, rules engine, and UI.

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
  /** ISO timestamp of the underlying observation. */
  observedAt: string | null;
}

export type Advisory = "none" | "small_craft" | "gale" | "storm";

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
