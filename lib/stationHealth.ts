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
import { HARBORS, windNeighbors, type Harbor } from "./harbors";
import type { GlosWaveRef } from "./glos";

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

export type SourceKind = "ndbc" | "glos";

export type HealthStatus = "ok" | "degraded" | "dark" | "unknown";

export interface StationReport {
  station: string;
  /** Where this source comes from — the two are fetched differently but graded alike. */
  kind: SourceKind;
  /** Friendly name for display ("Bay de Noc Spotter"); falls back to the id. */
  label: string;
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
  // Accurate as of 9ae26c4: the exit metrics are no longer SKIPPED without a bearing —
  // rate() substitutes the harbor's worst-case geometry — so the bias is pessimistic, not
  // optimistic. Still worth fixing: every harbor collapses to its own worst case, which is
  // precisely the differentiation this product exists to provide.
  windDir:
    "the exposure model can't run — the rating falls back to this harbor's worst-case geometry, " +
    "so scores read pessimistically and stop telling harbors apart",
  windKt: "the harbor can't be rated at all",
  gustKt: "gust-driven scores read low, so squally days look calmer than they are",
  waveFt: "waves fall back to the model, losing the observed blend",
  waterTempF: "the cold-water warning goes silent",
};

export interface StationUsage {
  /** Display id: an NDBC station id, or `glos:<datasetId>` for a Spotter. */
  station: string;
  /** NDBC buoys and GLOS Spotters are fetched differently but graded identically. */
  kind: "ndbc" | "glos";
  /** Set for GLOS sources, so the caller knows which platform and series to fetch. */
  glos?: GlosWaveRef;
  /** Human label for a GLOS platform (e.g. "Bay de Noc Spotter"). */
  label?: string;
  columns: HealthColumn[];
  harbors: string[];
}

/**
 * Which stations the app depends on, and for what.
 *
 * MIRRORS the chains built in lib/conditions.ts assemble(): windChain =
 * [buoyStation, ...windNeighbors(h)] (same-shore stations; none when windFromGrid), and
 * dataChain adds waveBuoy.station for waves and water temperature. If those chains
 * change, change this too — the tests pin the parts that matter.
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
    const neighbors = windNeighbors(h);
    // Wind chain: every station in it can end up supplying speed, direction or gust,
    // since those now resolve independently.
    for (const s of [h.buoyStation, ...neighbors]) touch(s, ["windDir", "windKt", "gustKt"], h.id);
    // A dedicated wave buoy supplies waves and leads for water temperature.
    touch(h.waveBuoy?.station, ["waveFt", "waterTempF"], h.id);
    // Water temp and wave fallbacks walk the wider data chain.
    for (const s of [h.buoyStation, ...neighbors]) touch(s, ["waterTempF"], h.id);
  }

  // GLOS Spotters, as their own source kind. They were invisible to this check until
  // 2026-09-13 even though six harbors take their waves from one and Escanaba and
  // Gladstone take their LIVE WIND from the Bay de Noc Spotter — so a Spotter could go
  // dark and /health would stay green while two harbors dropped to a gridpoint model
  // that reads 0.72x a same-site anemometer. Keyed by datasetId, because one platform
  // legitimately serves several harbors (695 covers both Escanaba and Gladstone).
  const glosAcc = new Map<number, { ref: GlosWaveRef; columns: Set<HealthColumn>; harbors: Set<string> }>();
  for (const h of HARBORS) {
    const ref = h.waveBuoy?.glos;
    if (!ref) continue;
    const g =
      glosAcc.get(ref.datasetId) ?? { ref, columns: new Set<HealthColumn>(), harbors: new Set<string>() };
    // Only the series this platform actually declares — a ref without tempId is not
    // expected to report temperature, so it must not be graded on it.
    if (ref.waveId != null) g.columns.add("waveFt");
    if (ref.tempId != null) g.columns.add("waterTempF");
    // Spotters report SPEED only, never a bearing, so windDir is deliberately absent.
    if (ref.windId != null) g.columns.add("windKt");
    g.harbors.add(h.id);
    glosAcc.set(ref.datasetId, g);
  }

  const ndbc: StationUsage[] = Array.from(acc, ([station, g]) => ({
    station,
    kind: "ndbc" as const,
    columns: HEALTH_COLUMNS.filter((c) => g.columns.has(c)),
    harbors: Array.from(g.harbors).sort(),
  }));

  const glos: StationUsage[] = Array.from(glosAcc, ([datasetId, g]) => ({
    station: `glos:${datasetId}`,
    kind: "glos" as const,
    glos: g.ref,
    label: g.ref.label ?? `GLOS ${datasetId}`,
    columns: HEALTH_COLUMNS.filter((c) => g.columns.has(c)),
    harbors: Array.from(g.harbors).sort(),
  }));

  return [...ndbc, ...glos].sort((a, b) => a.station.localeCompare(b.station));
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
  opts: { kind?: SourceKind; label?: string } = {},
): StationReport {
  const kind: SourceKind = opts.kind ?? "ndbc";
  const displayName = opts.label ?? station;
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
    const age = ageHours < 48 ? `${ageHours.toFixed(0)} h` : `${(ageHours / 24).toFixed(0)} days`;
    const nHarbors = `${usedBy.length} harbor${usedBy.length === 1 ? "" : "s"}`;
    if (kind === "glos") {
      // Spotters are pulled for the winter, so a dark one is often expected rather than
      // broken — say so, or this report turns permanently red every autumn and stops
      // being read. What matters is WHAT it was feeding, which the next line spells out.
      findings.push(
        `${displayName} has no rows for ${age}. Spotters are seasonal and get pulled for the winter, ` +
          `so this may be normal — but ${nHarbors} rely on it` +
          (usedFor.includes("windKt")
            ? `, and it is their live WIND source: they now fall back to the gridpoint model, which measured 0.72× a same-site anemometer. That under-reads, which is the optimistic direction.`
            : ` for waves/temperature, which fall back to the gridpoint model.`),
      );
    } else {
      // Say what the outage actually does to the harbors whose OWN station this is. Since
      // 2026-10-03 not all of them have a neighbour to borrow from: a dark 45161 puts Grand
      // Haven, Muskegon and Whitehall on their gridpoint model, which is not the same as
      // "a neighbour covers it" and must not be reported as if it were.
      const own = usedBy.filter((id) => HARBORS.find((h) => h.id === id)?.buoyStation === station);
      const onModel = own.filter((id) => {
        const h = HARBORS.find((x) => x.id === id);
        return !h || windNeighbors(h).length === 0;
      });
      const borrowing = own.length - onModel.length;
      const effects = [
        borrowing ? `${borrowing} of its harbors borrow from a same-shore neighbour` : "",
        onModel.length
          ? `${onModel.join(", ")} ${onModel.length === 1 ? "has" : "have"} no neighbour in reach and now rate on the gridpoint model`
          : "",
      ].filter(Boolean);
      findings.push(
        `no rows for ${age} — whole-station outage` +
          (usedBy.length
            ? `; ${effects.length ? effects.join("; ") + ", so" : ""} live conditions stay up while this station's own history freezes`
            : ""),
      );
    }
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

  return { station, kind, label: displayName, ageHours, rowsSampled: recent.length, fill, absentSensors, usedFor, usedBy, status, findings };
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
  /** `under` fails a run; `suspect` and `over` are reported but never fail — see the
   *  Spotter note on assessDrift for why that distinction is load-bearing. */
  status: "ok" | "under" | "suspect" | "over" | "insufficient";
  finding: string | null;
}

/**
 * Is this reference a GLOS Sofar Spotter (ids look like `SPOT-30364R`)?
 *
 * Spotters carry no anemometer — their wind is inferred from the wave spectrum and reads
 * 1.1–1.9× a real one (triangulated 2026-09-02 over 14 days: ~1.9× below 8 kt, ~1.1× above
 * 15 kt). A perfectly healthy anemometer therefore lands at 0.5–0.9 against a Spotter, so
 * treating that as a failure marks three good stations bad every single run — and a check
 * that cries wolf is one nobody reads, which is exactly how the next genuine 0.51× station
 * slips through.
 */
export function isSpotterReference(reference: string): boolean {
  return /^SPOT-/i.test(reference.trim());
}

/** Console marker per drift status, so the symbols are defined once. */
export const DRIFT_MARK: Record<DriftReport["status"], string> = {
  under: "!!",
  suspect: " ?",
  over: " ~",
  insufficient: "  ",
  ok: "  ",
};

/** Reading LOW is the failure worth breaking on: a sheltered or drifting station
 *  makes conditions look safer than they are. Reading high is merely conservative
 *  and is expected when the reference sits further offshore. */
export const RATIO_LOW = 0.7;
export const RATIO_HIGH = 1.6;
export const MIN_DRIFT_SAMPLES = 12;
/** Below this much SHARED time a ratio is weather, not calibration. Measured 2026-09-13
 *  (the WINDOW_DAYS table in the validator): one day swung healthy stations across
 *  RATIO_LOW, while three days already landed within ~0.1 of fourteen. Twelve samples
 *  is only two hours at a 10-minute cadence, so a sample count alone can't ensure this. */
export const MIN_DRIFT_SPAN_H = 72;

/** `spanH`: how many hours the two series actually share, when the caller knows. */
export function assessDrift(
  station: string,
  ours: number[],
  reference: string,
  referenceKm: number,
  refValues: number[],
  spanH?: number,
): DriftReport {
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const enough =
    ours.length >= MIN_DRIFT_SAMPLES &&
    refValues.length >= MIN_DRIFT_SAMPLES &&
    (spanH == null || spanH >= MIN_DRIFT_SPAN_H);
  const meanKt = ours.length ? mean(ours) : 0;
  const referenceMeanKt = refValues.length ? mean(refValues) : 0;
  const ratio = referenceMeanKt > 0 ? meanKt / referenceMeanKt : 0;

  const against =
    `reads ${meanKt.toFixed(1)} kt against ${referenceMeanKt.toFixed(1)} kt at ${reference} ` +
    `(${referenceKm.toFixed(0)} km) — ratio ${ratio.toFixed(2)}`;

  let status: DriftReport["status"] = "ok";
  let finding: string | null = null;
  if (!enough) {
    status = "insufficient";
  } else if (ratio < RATIO_LOW) {
    // Reading low is the failure worth breaking a run over — it makes conditions look
    // safer than they are — UNLESS the reference is a Spotter, whose own upward bias
    // produces exactly this ratio from a healthy station.
    if (isSpotterReference(reference)) {
      status = "suspect";
      finding =
        `${against}, but ${reference} is a Sofar Spotter, which reads 1.1–1.9× a real ` +
        `anemometer. Confirm against a second anemometer before re-pointing anything.`;
    } else {
      status = "under";
      finding = `${against}. Under-reading makes conditions look safer than they are.`;
    }
  } else if (ratio > RATIO_HIGH) {
    status = "over";
    finding = `reads ${ratio.toFixed(2)}× ${reference} — conservative, but worth a look if it drifts further.`;
  }
  return { station, reference, referenceKm, samples: Math.min(ours.length, refValues.length), meanKt, referenceMeanKt, ratio, status, finding };
}

/**
 * Where a harbor's live wind SPEED comes from, in the precedence assemble() applies: its
 * own NDBC station; else its nearest same-shore neighbour (windNeighbors — none when
 * windFromGrid); else a validated Spotter (`glos.windId`); else the gridpoint model.
 *
 * The validator must test THIS — not whatever the config happens to name. Until
 * 2026-10-02 it assumed "no buoyStation ⇒ model", so Escanaba and Gladstone, which rate
 * from the Bay de Noc Spotter, had their unused model tested instead, against that very
 * Spotter, on too few model samples to ever pass or fail: the source those two harbors
 * actually read was never checked at all.
 */
export type WindSource =
  | { kind: "ndbc"; station: string }
  | { kind: "spotter"; ref: GlosWaveRef & { windId: number } }
  | { kind: "model"; grid: string };

export function windSourceOf(h: Harbor): WindSource {
  if (h.buoyStation) return { kind: "ndbc", station: h.buoyStation };
  // A same-shore neighbour is in assemble()'s wind chain, and ANY live reading there
  // wins before a Spotter is even consulted — so the Spotter must not be named here
  // first. No harbor is configured this way today (station-less harbors are windFromGrid).
  const [nearest] = windNeighbors(h);
  if (nearest) return { kind: "ndbc", station: nearest };
  const g = h.waveBuoy?.glos;
  if (g?.windId != null) return { kind: "spotter", ref: { ...g, windId: g.windId } };
  return { kind: "model", grid: h.waveGrid };
}

/** A platform offered to the validator as an independent wind reference. */
export interface ReferencePlatform {
  /** NDBC station id, or a GLOS org_platform_id (`SPOT-…`, or the NDBC id it mirrors). */
  id: string;
  /** GLOS obs_dataset_id, for platforms taken from the GLOS catalog. */
  datasetId?: number;
  /** A Sofar Spotter under an id that doesn't say so. NDBC lists several under plain
   *  numeric ids (45212–45214 "… Spotter", and 42358 already publishes WSPD), so the
   *  `SPOT-` prefix alone cannot be trusted to recognise one. The caller decides this
   *  from the platform's name; isEligibleReference honours either signal. */
  spotter?: boolean;
}

/**
 * May `p` serve as an independent wind reference for harbor `h`?
 *
 * Never the source itself. That is the one rule a drift check rests on, and it has been
 * broken twice in two different ways:
 *   • GLOS MIRRORS NDBC buoys under the same id (45026, 45170, 45186, 45187…), so NDBC
 *     stations were "validated" against themselves and passed at ~1.00 however they read.
 *   • Escanaba and Gladstone read the Bay de Noc Spotter (GLOS dataset 695), which was
 *     also their reference. The guard compared NDBC ids only, and a Spotter has none.
 * So identity is checked on the GLOS dataset id as well as the station id.
 *
 * And never a Spotter for a Spotter. Two Spotters share the same 1.1–1.9× upward bias,
 * so their agreement says nothing about the truth — and assessDrift (rightly) refuses to
 * fail anything measured against a Spotter, so such a row could never fail. Only a real
 * anemometer can give a Spotter a verdict, and there the ordinary rule holds cleanly: a
 * healthy Spotter reads HIGH, so one reading under RATIO_LOW is genuinely broken.
 */
export function isEligibleReference(h: Harbor, p: ReferencePlatform): boolean {
  const src = windSourceOf(h);
  const id = p.id.trim().toUpperCase();
  // The harbor's wave buoy has always been excluded alongside its wind station.
  const selfIds = [src.kind === "ndbc" ? src.station : undefined, h.buoyStation, h.waveBuoy?.station]
    .filter((s): s is string => !!s)
    .map((s) => s.toUpperCase());
  if (selfIds.includes(id)) return false;
  if (src.kind === "spotter") {
    if (p.datasetId === src.ref.datasetId) return false;
    // Also covers the source itself should it ever be listed under a numeric NDBC id.
    if (p.spotter || isSpotterReference(p.id)) return false;
  }
  return true;
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
    //
    // A quiet GLOS Spotter fails the run ONLY when it supplies wind. Spotters are pulled
    // for the winter, so failing on every dark one would paint this report red for months
    // and teach everyone to ignore it — and a lost wave/temp Spotter degrades to the
    // gridpoint, a documented and acceptable path. Losing the Bay de Noc Spotter's WIND
    // is different: Escanaba and Gladstone fall back to a model that reads 0.72× a
    // same-site anemometer, i.e. optimistic, which is the direction that hurts people.
    ok:
      !problems.some(
        (p) =>
          (p.status === "dark" || p.status === "degraded") &&
          (p.kind !== "glos" || p.usedFor.includes("windKt")),
      ) && !driftProblems.some((d) => d.status === "under"),
  };
}
