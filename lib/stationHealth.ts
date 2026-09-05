// Station health — automated drift and sensor-failure detection.
//
// Written after a week in which three separate station problems were live in
// production simultaneously and NONE was visible from the outside:
//
//   1. CHII2 went whole-station dark. Live wind fell back to a neighbour, so the
//      board looked fine while five harbors' history quietly froze.
//   2. Waukegan and Great Lakes Marina were reading a Chicago crib 48-53 km south
//      while a wind-reporting buoy sat 2-3 km off their breakwater.
//   3. 45198 kept reporting wind SPEED on every row and DIRECTION on none. The
//      file was fresh, the station looked healthy, and the null direction silently
//      disabled the exposure model for all ten Chicago harbors — deleting the
//      harbor-exit half of every score, the thing the product exists to compute.
//
// The third is the reason this module measures each COLUMN rather than just asking
// "is the feed fresh?". A station is not simply up or down; it can lose one sensor
// and keep the rest, and that failure is both quieter and more damaging than an
// outage, because nothing looks wrong.
//
// Severity is CONTEXT-AWARE: a dead column only matters if some harbor actually
// depends on this station for it. 45198 reporting no water temperature is fine;
// 45198 reporting no wind direction is critical, because ten harbors steer their
// exposure model by it. Isomorphic and pure — the fetching lives in the caller.

import type { BuoyRow } from "./ndbc";
import { HARBORS, WIND_FALLBACK, PRIMARY_WAVE_STATION } from "./harbors";

/** The fields the app actually consumes from a station. */
export type HealthColumn = "windDir" | "windKt" | "gustKt" | "waveFt" | "waterTempF";

export const HEALTH_COLUMNS: HealthColumn[] = ["windDir", "windKt", "gustKt", "waveFt", "waterTempF"];

/** Newest row older than this ⇒ the station is dark. Deliberately looser than the
 *  3 h runtime staleness guard: this is a weekly report, not a live gate, and a
 *  brief gap shouldn't page anyone. */
export const DARK_AGE_H = 6;

/** Fill rates are measured over this many hours, NOT over a row count. Row counts
 *  lie on slow or dying stations: 200 rows reaches back 20 days on a station
 *  reporting hourly, so a feed that has been silent for a week still shows a
 *  beautiful fill rate. Time is the honest denominator. */
export const RECENT_WINDOW_H = 48;

/** A depended-on column below this fill rate is a broken sensor, not a blip.
 *  45198's dead direction read 0.00 over 200 rows; healthy columns sit near 1.0,
 *  so anything in between is genuinely ambiguous and worth a human look. */
export const MIN_FILL = 0.5;

/** Gusts are legitimately absent in calm air on some platforms, so they need a
 *  lower bar before being called broken. */
export const MIN_FILL_GUST = 0.2;

/**
 * Sensors a platform physically does not carry, declared per station.
 *
 * This exists because capability CANNOT be inferred from the data. The obvious rule —
 * "a column empty across the whole file means the platform has no such sensor" — is
 * the same observation as "the sensor died more than 45 days ago", and realtime2 only
 * holds ~45 days. So an inferred rule quietly flips a dead sensor into a healthy one
 * the moment the last working row scrolls out of the window, silencing the check on
 * exactly the failure it exists to catch.
 *
 * That is not hypothetical. Measured 2026-09-05: 45198's GST is already 0% across the
 * entire file (the anemometer's gust output died ~44 days ago) and its WDIR is down to
 * 13.2% and falling — around 13 September the last real direction row ages out, and an
 * inferred rule would have started calling a buoy that twenty harbors steer by
 * "healthy, no wind vane fitted".
 *
 * So the default is inverted: an all-null depended-on column is a FAULT unless the
 * platform is declared here. A new sensorless platform therefore complains until
 * someone records what it carries, which is the safe direction for a safety check —
 * the failure mode is a nag, not silence.
 *
 * Verified against the full realtime2 files on 2026-09-05.
 */
export const SENSORLESS: Record<string, HealthColumn[]> = {
  // Lakefront/shore met stations — anemometer and air temp only.
  CHII2: ["waveFt", "waterTempF"],
  CMTI2: ["waveFt", "waterTempF"],
  CNII2: ["waveFt", "waterTempF"],
  FPTM4: ["waveFt", "waterTempF"],
  // River-mouth met station: no wave sensor, but water temp reads 99%.
  MNMM4: ["waveFt"],
  // 45161 reports no waves (this is why Grand Haven/Muskegon/Whitehall use GLOS
  // Spotters for waves) but DOES carry a water-temp probe at ~98% — the harbors.ts
  // comments claiming otherwise are wrong.
  "45161": ["waveFt"],
};

export type HealthStatus = "ok" | "degraded" | "dark" | "unknown";

export interface StationReport {
  station: string;
  /** Age of the newest row, hours. Null when the feed returned nothing at all. */
  ageHours: number | null;
  /** Rows inside the recent window — the denominator behind `fill`. */
  rowsSampled: number;
  /** Fill rate 0–1 per column over the RECENT WINDOW. */
  fill: Record<HealthColumn, number>;
  /** Columns this platform is DECLARED not to carry (see SENSORLESS). CNII2 has no
   *  water-temperature probe; that is its design, not a fault, and flagging it would
   *  train everyone to ignore this report. Declared, never inferred — see the note on
   *  SENSORLESS for why inference silently breaks. */
  absentSensors: HealthColumn[];
  /** Columns some harbor actually depends on this station for. */
  usedFor: HealthColumn[];
  usedBy: string[];
  status: HealthStatus;
  /** Plain-language problems, most serious first. Empty when healthy. */
  findings: string[];
}

const minFillFor = (c: HealthColumn) => (c === "gustKt" ? MIN_FILL_GUST : MIN_FILL);

const COLUMN_LABEL: Record<HealthColumn, string> = {
  windDir: "wind direction",
  windKt: "wind speed",
  gustKt: "gusts",
  waveFt: "wave height",
  waterTempF: "water temperature",
};

/** Why a dead column matters, so the report explains itself without the reader
 *  having to know the rating engine. */
const COLUMN_CONSEQUENCE: Record<HealthColumn, string> = {
  windDir: "the exposure model can't run — exit waves and crosswind are skipped, making scores optimistic",
  windKt: "the harbor can't be rated at all",
  gustKt: "gust-driven scores read low, so squally days look calmer than they are",
  waveFt: "waves fall back to the model, losing the observed blend",
  waterTempF: "the cold-water warning goes silent",
};

export interface StationUsage {
  station: string;
  columns: HealthColumn[];
  harbors: string[];
}

/**
 * Which stations the app depends on, and for what.
 *
 * MIRRORS the chains built in lib/conditions.ts assemble(): windChain =
 * [buoyStation, ...WIND_FALLBACK] (empty fallback when windFromGrid), and dataChain
 * adds waveBuoy.station and PRIMARY_WAVE_STATION for waves and water temperature.
 * If those chains change, change this too — the tests pin the parts that matter.
 *
 * The point of computing usage at all: severity depends on it. 45198 reporting no
 * water temperature is unremarkable; 45198 reporting no wind DIRECTION is critical,
 * because ten harbors run their exposure model off it.
 */
export function stationUsage(): StationUsage[] {
  const acc = new Map<string, { columns: Set<HealthColumn>; harbors: Set<string> }>();
  const touch = (station: string | undefined, columns: HealthColumn[], harborId: string) => {
    if (!station) return;
    const g = acc.get(station) ?? { columns: new Set<HealthColumn>(), harbors: new Set<string>() };
    for (const c of columns) g.columns.add(c);
    g.harbors.add(harborId);
    acc.set(station, g);
  };

  for (const h of HARBORS) {
    const fallback = h.windFromGrid ? [] : WIND_FALLBACK;
    // Wind chain: every station in it can end up supplying speed, direction or gust,
    // since those now resolve independently.
    for (const s of [h.buoyStation, ...fallback]) touch(s, ["windDir", "windKt", "gustKt"], h.id);
    // A dedicated wave buoy supplies waves and leads for water temperature.
    touch(h.waveBuoy?.station, ["waveFt", "waterTempF"], h.id);
    // Water temp and wave fallbacks walk the wider data chain.
    for (const s of [h.buoyStation, ...(h.windFromGrid ? [] : [PRIMARY_WAVE_STATION]), ...fallback]) {
      touch(s, ["waterTempF"], h.id);
    }
  }

  return Array.from(acc, ([station, g]) => ({
    station,
    columns: HEALTH_COLUMNS.filter((c) => g.columns.has(c)),
    harbors: Array.from(g.harbors).sort(),
  })).sort((a, b) => a.station.localeCompare(b.station));
}

/**
 * Assess one station.
 *
 * `rows` should be the WHOLE realtime2 file (~45 days), not a recent slice. Two
 * different questions are asked of it: fill rates come from the last
 * RECENT_WINDOW_H hours, while "does this platform even carry this sensor?" needs
 * the full history — a column that is empty across 45 days was never instrumented,
 * and reporting that as a fault every week is how a health check gets ignored.
 */
export function assessStation(
  station: string,
  rows: BuoyRow[],
  usedFor: HealthColumn[],
  usedBy: string[],
  now: number = Date.now(),
): StationReport {
  const recent = rows.filter((r) => now - r.time <= RECENT_WINDOW_H * 3600_000);
  const fill = Object.fromEntries(
    HEALTH_COLUMNS.map((c) => [c, recent.length ? recent.filter((r) => r[c] != null).length / recent.length : 0]),
  ) as Record<HealthColumn, number>;
  // DECLARED absent, not inferred from the data — see SENSORLESS.
  const absentSensors = SENSORLESS[station.toUpperCase()] ?? [];
  // Nothing at all in the whole ~45-day file. For an undeclared column this means the
  // sensor is dead rather than merely intermittent, and it is worth saying so.
  const neverReported = (c: HealthColumn) => !rows.some((r) => r[c] != null);

  const newest = rows.length ? Math.max(...rows.map((r) => r.time)) : null;
  const ageHours = newest == null ? null : (now - newest) / 3600_000;

  const findings: string[] = [];
  let status: HealthStatus = "ok";

  if (!rows.length) {
    status = "unknown";
    findings.push("no data returned — the feed is unreachable or the station id is wrong");
  } else if (ageHours != null && ageHours > DARK_AGE_H) {
    status = "dark";
    findings.push(
      `no rows for ${ageHours < 48 ? `${ageHours.toFixed(0)} h` : `${(ageHours / 24).toFixed(0)} days`} — whole-station outage` +
        (usedBy.length
          ? `; ${usedBy.length} harbor${usedBy.length === 1 ? " falls" : "s fall"} back to a neighbour, so live conditions look fine while history freezes`
          : ""),
    );
  } else {
    for (const c of usedFor) {
      // A sensor the platform is DECLARED not to carry is not a failure — the app's
      // fallback chains cover it, and flagging it weekly would drown the real findings.
      if (absentSensors.includes(c)) continue;
      if (fill[c] < minFillFor(c)) {
        status = "degraded";
        findings.push(
          neverReported(c)
            ? `${COLUMN_LABEL[c]} has not been reported ONCE in the whole ~45-day file while the feed is fresh — the sensor is dead, not intermittent. ${COLUMN_CONSEQUENCE[c]}. If this platform never carried one, declare it in SENSORLESS so this stops being reported.`
            : `${COLUMN_LABEL[c]} reported on ${(fill[c] * 100).toFixed(0)}% of rows in the last ${RECENT_WINDOW_H} h while the feed is fresh — ${COLUMN_CONSEQUENCE[c]}`,
        );
      }
    }
  }

  return { station, ageHours, rowsSampled: recent.length, fill, absentSensors, usedFor, usedBy, status, findings };
}

/** Comparison of a station's wind against a reference, for drift detection. */
export interface DriftReport {
  station: string;
  reference: string;
  referenceKm: number;
  samples: number;
  meanKt: number;
  referenceMeanKt: number;
  ratio: number;
  status: "ok" | "under" | "over" | "insufficient";
  finding: string | null;
}

/** Reading LOW is the failure worth breaking on: a sheltered or drifting station
 *  makes conditions look safer than they are. Reading high is merely conservative
 *  and is expected when the reference sits further offshore. */
export const RATIO_LOW = 0.7;
export const RATIO_HIGH = 1.6;
export const MIN_DRIFT_SAMPLES = 12;

export function assessDrift(
  station: string,
  ours: number[],
  reference: string,
  referenceKm: number,
  refValues: number[],
): DriftReport {
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const enough = ours.length >= MIN_DRIFT_SAMPLES && refValues.length >= MIN_DRIFT_SAMPLES;
  const meanKt = ours.length ? mean(ours) : 0;
  const referenceMeanKt = refValues.length ? mean(refValues) : 0;
  const ratio = referenceMeanKt > 0 ? meanKt / referenceMeanKt : 0;

  let status: DriftReport["status"] = "ok";
  let finding: string | null = null;
  if (!enough) {
    status = "insufficient";
  } else if (ratio < RATIO_LOW) {
    status = "under";
    finding =
      `reads ${meanKt.toFixed(1)} kt against ${referenceMeanKt.toFixed(1)} kt at ${reference} ` +
      `(${referenceKm.toFixed(0)} km) — ratio ${ratio.toFixed(2)}. Under-reading makes conditions look safer than they are.`;
  } else if (ratio > RATIO_HIGH) {
    status = "over";
    finding = `reads ${ratio.toFixed(2)}× ${reference} — conservative, but worth a look if it drifts further.`;
  }
  return { station, reference, referenceKm, samples: Math.min(ours.length, refValues.length), meanKt, referenceMeanKt, ratio, status, finding };
}

export interface HealthSummary {
  checkedAt: string;
  stations: StationReport[];
  drift: DriftReport[];
  /** Stations needing attention, most serious first. */
  problems: StationReport[];
  driftProblems: DriftReport[];
  ok: boolean;
}

const SEVERITY: Record<HealthStatus, number> = { dark: 0, degraded: 1, unknown: 2, ok: 3 };

export function summarize(stations: StationReport[], drift: DriftReport[], checkedAt = new Date()): HealthSummary {
  const problems = stations
    .filter((s) => s.status !== "ok")
    .sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || a.station.localeCompare(b.station));
  const driftProblems = drift.filter((d) => d.status === "under" || d.status === "over");
  return {
    checkedAt: checkedAt.toISOString(),
    stations: [...stations].sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || a.station.localeCompare(b.station)),
    drift,
    problems,
    driftProblems,
    // "unknown" and "over" are reported but don't fail the check — a transient fetch
    // failure or a conservative reading shouldn't cry wolf every week.
    ok: !problems.some((p) => p.status === "dark" || p.status === "degraded") && !driftProblems.some((d) => d.status === "under"),
  };
}
