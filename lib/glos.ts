// GLOS / Seagull observations — a third source, used only where NDBC has nothing.
//
// Why this exists: a few harbors sit next to a Sofar Spotter buoy that reports waves
// and water temperature, in places where the nearest NDBC buoy reports neither (45161
// serves Grand Haven / Whitehall with WVHT=MM).
//
// Wind: GLOS shore TOWERS are never a wind source — they read roughly half the true
// wind. Spotter SPECTRAL wind (inferred from the wave field, not an anemometer) is
// allowed per-platform via `windId`, and only after validation against a real
// anemometer: triangulated 2026-09-02 over 14 days, Spotters read 1.1–1.25× high
// (conservative — safe direction) where the gridpoint model read 0.72× at the same
// site as the MNMM4 anemometer (optimistic — the dangerous direction on a go/no-go
// call). Spotters report wind SPEED only; direction must come from the model.
//
// Practical notes about the API (verified against the live service):
//   • /obs, /obs-datasets.geojson and /parameters are open; /obs-latest needs a key.
//   • /obs identifies each series only by an opaque `parameter_id` with no name and no
//     units, and the id→name map (/parameters) is ~3.4 MB. So the ids are resolved ONCE
//     when a harbor is added and stored in its config, not looked up at runtime.
//   • `units` is null for every parameter. CF standard names imply SI and the observed
//     values confirm it: metres for wave height, KELVIN for water temperature.
//   • Spotter buoys are seasonal — they go dark over winter, so callers must degrade to
//     the gridpoint model. getGlosCurrent returns null rather than stale data.
//
// Server-only.

import { M_TO_FT, msToKt } from "./units";
import type { BuoyRow } from "./ndbc";

const OBS_URL = "https://seagull-api.glos.org/api/v1/obs";

/** Which platform to read, and which of its series carry what. Resolved once per
 *  harbor at config time (see the playbook), because the id→name map is huge. */
export interface GlosWaveRef {
  /** `obs_dataset_id` from /obs-datasets.geojson. */
  datasetId: number;
  /** parameter_id for sea_surface_wave_significant_height (metres). */
  waveId: number;
  /** parameter_id for the dominant wave period (seconds). */
  periodId?: number;
  /** parameter_id for sea_surface_wave_from_direction (degrees). */
  dirId?: number;
  /** parameter_id for sea_water_temperature (KELVIN). Pick the shallowest depth. */
  tempId?: number;
  /** parameter_id for wind_speed (m/s) — Spotter SPECTRAL wind, speed only. Set this
   *  ONLY after validating the platform against a real anemometer (see header note);
   *  the harbor's wind direction and gusts stay with the gridpoint model. */
  windId?: number;
  /** Short human name for the platform, shown as the wind source (e.g. "Bay de Noc
   *  Spotter"). Falls back to "GLOS buoy". */
  label?: string;
}

export interface GlosCurrent {
  waveFt: number | null;
  wavePeriodS: number | null;
  waveDir: number | null;
  waterTempF: number | null;
  /** Spectral wind speed (kt), only when the ref sets windId. No direction. */
  windKt: number | null;
  windObservedAt: string | null;
  observedAt: string | null;
}

/** Same rule as the buoys: a platform that has gone quiet must read as absent, not as
 *  "conditions right now", so the caller can fall back to the model. Exported so the
 *  station validator applies the same cut-off when deciding a Spotter is off duty. */
export const MAX_OBS_AGE_MS = 3 * 3600_000;

/** Plausible dominant wave period on the Great Lakes. Spotter peak-period readings spike
 *  to 25-34 s when the sea is nearly flat and the spectral peak lands on noise (observed
 *  on all three buoys in use: medians 2.5-4.5 s, maxima 25-34 s). Left unfiltered those
 *  spikes read as "longer period — rolling and easier-motioned" in the sea-state intel
 *  when it is actually small chop, so drop them and let the gridpoint supply the period. */
const PLAUSIBLE_PERIOD_S: [number, number] = [1, 15];

interface ObsPoint {
  timestamp: string;
  value: number | null;
}
interface ObsParam {
  parameter_id: number;
  observations?: ObsPoint[];
}
interface ObsDataset {
  parameters?: ObsParam[];
}

const kelvinToF = (k: number) => ((k - 273.15) * 9) / 5 + 32;

/**
 * The /obs URL for exactly the series a ref declares.
 *
 * Without `parameterId` the API returns EVERY series the platform carries — 14–15 on a
 * Spotter, of which the app reads at most five — and 14 days of that is 1.6–3.7 MB. Next
 * refuses to cache a fetch over 2 MB, so those responses were never cached: every /health
 * render re-downloaded ~9–11 MB, and on 2026-09-21 the weekly health job was OOM-killed
 * mid-download and reported the crash as a 503. Asking for the declared ids cuts the same
 * 14 days to ~0.5 MB (dataset 671: 2.74 MB → 0.52 MB). The API takes them comma-separated.
 */
export function obsUrl(ref: GlosWaveRef, startDate: string): string {
  const ids = [ref.waveId, ref.periodId, ref.dirId, ref.tempId, ref.windId].filter(
    (id): id is number => id != null,
  );
  return `${OBS_URL}?obsDatasetId=${ref.datasetId}&startDate=${startDate}&parameterId=${ids.join(",")}`;
}

/** Newest point of a series, or null if it's missing or stale. */
function newest(params: Map<number, ObsPoint[]>, id: number | undefined, now: number): ObsPoint | null {
  if (id == null) return null;
  const pts = params.get(id);
  if (!pts?.length) return null;
  let best: ObsPoint | null = null;
  for (const p of pts) {
    if (p.value == null) continue;
    if (!best || p.timestamp > best.timestamp) best = p;
  }
  if (!best) return null;
  return now - new Date(best.timestamp).getTime() > MAX_OBS_AGE_MS ? null : best;
}

/**
 * Recent observations for a GLOS platform, shaped as BuoyRow so the station-health
 * analyzer can grade a Spotter with exactly the same code it uses for an NDBC buoy.
 *
 * These platforms are load-bearing and were invisible to the health check until now:
 * six harbors take their waves from Spotters, and Escanaba and Gladstone take their LIVE
 * WIND from the Bay de Noc Spotter. If one goes dark nothing else notices — those two
 * silently fall back to a gridpoint model measured at 0.72x a same-site anemometer, which
 * is the optimistic direction.
 *
 * No staleness guard here, deliberately: the whole point is to SEE stale and partially
 * dead feeds, the same reason getBuoyRows skips it.
 */
export async function getGlosRows(ref: GlosWaveRef, days = 10): Promise<BuoyRow[]> {
  const start = new Date(Date.now() - days * 24 * 3600_000).toISOString().slice(0, 10);
  let data: ObsDataset[];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    const res = await fetch(obsUrl(ref, start), {
      signal: ctrl.signal,
      next: { revalidate: 900 },
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    data = (await res.json()) as ObsDataset[];
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];

  // parameter_id -> which BuoyRow field it fills, with the unit conversion.
  const map = new Map<number, [string, (v: number) => number]>();
  const put = (id: number | undefined, field: string, conv: (v: number) => number) => {
    if (id != null) map.set(id, [field, conv]);
  };
  put(ref.waveId, "waveFt", (v) => v * M_TO_FT);
  put(ref.periodId, "wavePeriodS", (v) => v);
  put(ref.dirId, "waveDir", (v) => v);
  put(ref.tempId, "waterTempF", kelvinToF);
  // Spotters report wind SPEED only — never a direction, so windDir stays null and the
  // health check must not expect one from them.
  put(ref.windId, "windKt", msToKt);

  // Bucket into whole hours rather than keying on the exact timestamp. A Spotter's series
  // do NOT share a clock: Grand Haven reports waves on :00/:10/:20 and water temperature
  // on :26/:31/:36 — 206 wave and 824 temp observations over two days with ZERO timestamps
  // in common. Keying exactly produced a row per reading with a single field set, so every
  // column's fill rate read as its share of the rows (waves 20%, temp 80%) and the health
  // check called two perfectly healthy sensors degraded. Muskegon escaped only because its
  // series happen to share a clock (134 of 137).
  //
  // An hour is comfortably coarser than every cadence in use here (5–30 min), so a healthy
  // series fills every bucket, while one that has genuinely stopped still shows as missing.
  const BUCKET_MS = 3600_000;
  const byHour = new Map<number, BuoyRow>();
  for (const ds of data) {
    for (const p of ds.parameters ?? []) {
      const m = map.get(p.parameter_id);
      if (!m) continue;
      const [field, conv] = m;
      for (const o of p.observations ?? []) {
        if (o.value == null) continue;
        const t = new Date(o.timestamp).getTime();
        if (!Number.isFinite(t)) continue;
        const bucket = Math.floor(t / BUCKET_MS) * BUCKET_MS;
        const row =
          byHour.get(bucket) ??
          ({ time: bucket, windDir: null, windKt: null, gustKt: null, waveFt: null,
             wavePeriodS: null, waveDir: null, waterTempF: null, airTempF: null } as BuoyRow);
        // First reading in the hour wins; we only need presence and a representative value.
        const slot = row as unknown as Record<string, number | null>;
        if (slot[field] == null) slot[field] = conv(o.value);
        byHour.set(bucket, row);
      }
    }
  }
  return Array.from(byHour.values()).sort((a, b) => b.time - a.time);
}

/** Current wave + water temperature for a GLOS platform. Null if unreachable or stale. */
export async function getGlosCurrent(ref: GlosWaveRef): Promise<GlosCurrent | null> {
  // /obs requires a startDate and has no "latest" without an API key, so ask for a
  // window that always contains the most recent points and take the newest.
  const start = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
  let data: ObsDataset[];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(obsUrl(ref, start), {
      signal: ctrl.signal,
      next: { revalidate: 900 },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    data = (await res.json()) as ObsDataset[];
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;

  const params = new Map<number, ObsPoint[]>();
  for (const ds of data) {
    for (const p of ds.parameters ?? []) {
      if (p.observations?.length) params.set(p.parameter_id, p.observations);
    }
  }

  const now = Date.now();
  const wave = newest(params, ref.waveId, now);
  const period = newest(params, ref.periodId, now);
  const dir = newest(params, ref.dirId, now);
  const temp = newest(params, ref.tempId, now);
  const windP = newest(params, ref.windId, now);
  if (!wave && !temp && !windP) return null; // nothing usable

  const periodS =
    period?.value != null && period.value >= PLAUSIBLE_PERIOD_S[0] && period.value <= PLAUSIBLE_PERIOD_S[1]
      ? period.value
      : null;

  return {
    waveFt: wave?.value == null ? null : wave.value * M_TO_FT,
    wavePeriodS: periodS,
    waveDir: dir?.value ?? null,
    waterTempF: temp?.value == null ? null : kelvinToF(temp.value),
    windKt: windP?.value == null ? null : msToKt(windP.value),
    windObservedAt: windP?.timestamp ?? null,
    observedAt: wave?.timestamp ?? temp?.timestamp ?? null,
  };
}
