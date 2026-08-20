// GLOS / Seagull observations — a third source, used only where NDBC has nothing.
//
// Why this exists: a few harbors sit next to a Sofar Spotter buoy that reports waves
// and water temperature, in places where the nearest NDBC buoy reports neither (45161
// serves Grand Haven / Whitehall with WVHT=MM). Wind is deliberately NOT taken from
// here — see docs/ADDING_HARBORS.md, GLOS's closest platforms are often shore towers
// that read roughly half the true wind.
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

import { M_TO_FT } from "./units";

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
}

export interface GlosCurrent {
  waveFt: number | null;
  wavePeriodS: number | null;
  waveDir: number | null;
  waterTempF: number | null;
  observedAt: string | null;
}

/** Same rule as the buoys: a platform that has gone quiet must read as absent, not as
 *  "conditions right now", so the caller can fall back to the model. */
const MAX_OBS_AGE_MS = 3 * 3600_000;

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

/** Current wave + water temperature for a GLOS platform. Null if unreachable or stale. */
export async function getGlosCurrent(ref: GlosWaveRef): Promise<GlosCurrent | null> {
  // /obs requires a startDate and has no "latest" without an API key, so ask for a
  // window that always contains the most recent points and take the newest.
  const start = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
  let data: ObsDataset[];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(`${OBS_URL}?obsDatasetId=${ref.datasetId}&startDate=${start}`, {
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
  if (!wave && !temp) return null; // nothing usable

  const periodS =
    period?.value != null && period.value >= PLAUSIBLE_PERIOD_S[0] && period.value <= PLAUSIBLE_PERIOD_S[1]
      ? period.value
      : null;

  return {
    waveFt: wave?.value == null ? null : wave.value * M_TO_FT,
    wavePeriodS: periodS,
    waveDir: dir?.value ?? null,
    waterTempF: temp?.value == null ? null : kelvinToF(temp.value),
    observedAt: wave?.timestamp ?? temp?.timestamp ?? null,
  };
}
