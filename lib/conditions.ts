// Orchestration: assemble canonical Conditions for every harbor from the raw
// sources (nearest buoy for localized wind/temp, an optional dedicated wave buoy
// blended with the per-harbor NWS gridpoint for waves, marine zone for advisories),
// and optionally persist a snapshot.
//
// Server-only.

import { Conditions, type StormRisk } from "./types";
import { Harbor, HARBORS } from "./harbors";
import { BuoyCurrent, getBuoyCurrent } from "./ndbc";
import { getMarineForecast, getGridWaveCurrent, type GridWave } from "./nws";
import { getStormOutlook } from "./storm";
import { rate } from "./rating";
import { getBoat, DEFAULT_BOAT_ID, DEFAULT_SKILL } from "./boats";
import { getDb } from "@/db";
import { harborSnapshots, observations, type ObservationRow } from "@/db/schema";

const PRIMARY_WAVE_STATION = "45198"; // Chicago Buoy — full wave spectra

// How much an observed local wave buoy leads the NWS gridpoint model when both exist,
// as a function of the buoy's distance from the harbor: one at the mouth is nearly
// ground truth, one 30 km out is a weaker proxy. Real observations still lead
// throughout, but the model keeps enough weight that a noisy reading or a buoy dropout
// can't swing the score alone. Linear between the two anchors (all tunable).
const WAVE_OBS_WEIGHT_NEAR = 0.85; // at the harbor (0 km)
const WAVE_OBS_WEIGHT_FAR = 0.45; // at/beyond WAVE_OBS_FAR_KM
const WAVE_OBS_FAR_KM = 30;
export function waveObsWeight(km: number): number {
  const t = Math.max(0, Math.min(1, km / WAVE_OBS_FAR_KM));
  return WAVE_OBS_WEIGHT_NEAR - t * (WAVE_OBS_WEIGHT_NEAR - WAVE_OBS_WEIGHT_FAR);
}
const CHICAGO = { lat: 41.8899, lon: -87.61 }; // metro point for the (regional) storm outlook

// Ordered wind fallbacks used when a harbor's own station has no wind (e.g. buoy
// 45198's anemometer drops out while its wave sensor keeps reporting). All the
// Chicago stations are within ~10 km, so a neighbor is a fair wind proxy — far
// better than going dark. CNII2 (Northerly Island) sits next to the downtown
// harbors, so it leads.
const WIND_FALLBACK = ["CNII2", "CHII2", "45198", "CMTI2"];

const uniq = (arr: string[]) => Array.from(new Set(arr));

export interface HarborConditions {
  id: string;
  name: string;
  conditions: Conditions;
}

/** First station in `stations` that has a non-null value for `key`. */
function pickField(
  buoys: Map<string, BuoyCurrent | null>,
  stations: string[],
  key: keyof BuoyCurrent,
): { value: number | null; station: string | null } {
  for (const s of stations) {
    const v = buoys.get(s)?.[key];
    if (v != null) return { value: v as number, station: s };
  }
  return { value: null, station: null };
}

function assemble(
  harbor: Harbor,
  buoys: Map<string, BuoyCurrent | null>,
  gridWave: GridWave | null,
  advisory: Conditions["advisory"],
  storm: StormRisk | undefined,
): Conditions {
  const windChain = uniq([harbor.buoyStation, ...WIND_FALLBACK]);
  // A dedicated local wave buoy (if set) leads the data chain: it sits right off
  // the harbor, so its observed waves/water-temp beat the model and distant buoys.
  const dataChain = uniq(
    [harbor.waveBuoy?.station, harbor.buoyStation, PRIMARY_WAVE_STATION, ...WIND_FALLBACK].filter(
      (s): s is string => !!s,
    ),
  );

  // Wind dir/speed/gust come from the first station that reports wind.
  const wind = pickField(buoys, windChain, "windKt");
  const wb = wind.station ? buoys.get(wind.station) : null;

  // Waves: blend an observed local wave buoy with the per-harbor NWS gridpoint model,
  // weighting the observation by how close its buoy is (waveObsWeight). Real
  // observations lead, the model still contributes. Fall back to whichever exists,
  // then to any buoy in the chain. Period/direction come from the observed buoy first.
  const localWave = harbor.waveBuoy ? buoys.get(harbor.waveBuoy.station) : null;
  const obsWave = localWave?.waveFt ?? null;
  const modelWave = gridWave?.waveFt ?? null;
  const obsWeight = harbor.waveBuoy ? waveObsWeight(harbor.waveBuoy.km) : 0;
  let waveFt: number | null;
  let wavePeriodS: number | null;
  let waveDir: number | null;
  if (obsWave != null && modelWave != null) {
    waveFt = obsWeight * obsWave + (1 - obsWeight) * modelWave;
    wavePeriodS = localWave?.wavePeriodS ?? gridWave?.wavePeriodS ?? null;
    waveDir = localWave?.waveDir ?? gridWave?.waveDir ?? null;
  } else if (obsWave != null) {
    waveFt = obsWave;
    wavePeriodS = localWave?.wavePeriodS ?? null;
    waveDir = localWave?.waveDir ?? null;
  } else if (modelWave != null) {
    waveFt = modelWave;
    wavePeriodS = gridWave?.wavePeriodS ?? null;
    waveDir = gridWave?.waveDir ?? null;
  } else {
    const wave = pickField(buoys, dataChain, "waveFt");
    const wvb = wave.station ? buoys.get(wave.station) : null;
    waveFt = wave.value;
    wavePeriodS = wvb?.wavePeriodS ?? null;
    waveDir = wvb?.waveDir ?? null;
  }

  return {
    windDir: wb?.windDir ?? null,
    windKt: wind.value,
    gustKt: wb?.gustKt ?? null,
    waveFt,
    wavePeriodS,
    waveDir,
    waterTempF: pickField(buoys, dataChain, "waterTempF").value,
    airTempF: pickField(buoys, dataChain, "airTempF").value,
    advisory,
    source: wind.station ?? harbor.buoyStation,
    observedAt: wb?.observedAt ?? null,
    storm,
  };
}

function toStormRisk(o: Awaited<ReturnType<typeof getStormOutlook>>): StormRisk | undefined {
  return o ? { level: o.level, headline: o.headline, capeNow: o.capeNow } : undefined;
}

/** Top-of-hour ISO timestamps flagged thunderstorm-likely (for the sail window). */
export async function getStormHours(): Promise<string[]> {
  const o = await getStormOutlook(CHICAGO.lat, CHICAGO.lon);
  return o?.stormyHours ?? [];
}

/** Live conditions for every harbor. Fetches each unique station/zone once. */
export async function getAllConditions(): Promise<HarborConditions[]> {
  const stations = uniq([
    ...HARBORS.map((h) => h.buoyStation),
    ...HARBORS.map((h) => h.waveBuoy?.station).filter((s): s is string => !!s),
    PRIMARY_WAVE_STATION,
    ...WIND_FALLBACK,
  ]);
  const zones = uniq(HARBORS.map((h) => h.marineZone));
  const grids = uniq(HARBORS.map((h) => h.waveGrid));

  const [buoyEntries, gridEntries, marineEntries, stormOutlook] = await Promise.all([
    Promise.all(stations.map(async (s) => [s, await getBuoyCurrent(s)] as const)),
    Promise.all(grids.map(async (g) => [g, await getGridWaveCurrent(g)] as const)),
    Promise.all(zones.map(async (z) => [z, (await getMarineForecast(z)).advisory] as const)),
    getStormOutlook(CHICAGO.lat, CHICAGO.lon),
  ]);
  const buoys = new Map(buoyEntries);
  const gridWaves = new Map(gridEntries);
  const advisories = new Map(marineEntries);
  const storm = toStormRisk(stormOutlook);

  return HARBORS.map((h) => ({
    id: h.id,
    name: h.name,
    conditions: assemble(h, buoys, gridWaves.get(h.waveGrid) ?? null, advisories.get(h.marineZone) ?? "none", storm),
  }));
}

/** Conditions for a single harbor (detail page). */
export async function getHarborConditions(harbor: Harbor): Promise<Conditions> {
  const stations = uniq(
    [harbor.buoyStation, harbor.waveBuoy?.station, PRIMARY_WAVE_STATION, ...WIND_FALLBACK].filter(
      (s): s is string => !!s,
    ),
  );
  const [buoyEntries, gridWave, marine, stormOutlook] = await Promise.all([
    Promise.all(stations.map(async (s) => [s, await getBuoyCurrent(s)] as const)),
    getGridWaveCurrent(harbor.waveGrid),
    getMarineForecast(harbor.marineZone),
    getStormOutlook(CHICAGO.lat, CHICAGO.lon),
  ]);
  return assemble(harbor, new Map(buoyEntries), gridWave, marine.advisory, toStormRisk(stormOutlook));
}

/** Persist a snapshot per harbor (baseline status = default sailor). No-op without a DB. */
export async function persistSnapshots(list: HarborConditions[]): Promise<{ persisted: number }> {
  const db = getDb();
  if (!db) return { persisted: 0 };

  const boat = getBoat(DEFAULT_BOAT_ID);
  const takenAt = new Date();
  const seenStations = new Set<string>();
  const obsRows: ObservationRow[] = [];
  const snapRows = HARBORS.map((h) => {
    const c = list.find((x) => x.id === h.id)!.conditions;
    const baseline = rate(h, c, boat, DEFAULT_SKILL).status;
    if (c.source && !seenStations.has(c.source)) {
      seenStations.add(c.source);
      obsRows.push({
        station: c.source,
        observedAt: c.observedAt ? new Date(c.observedAt) : takenAt,
        windDir: c.windDir, windKt: c.windKt, gustKt: c.gustKt,
        waveFt: c.waveFt, wavePeriodS: c.wavePeriodS, waveDir: c.waveDir,
        waterTempF: c.waterTempF, airTempF: c.airTempF,
      });
    }
    return {
      harborId: h.id, takenAt,
      windDir: c.windDir, windKt: c.windKt, gustKt: c.gustKt,
      waveFt: c.waveFt, wavePeriodS: c.wavePeriodS, waveDir: c.waveDir,
      waterTempF: c.waterTempF, airTempF: c.airTempF,
      advisory: c.advisory, source: c.source, baselineStatus: baseline,
    };
  });

  await db.insert(harborSnapshots).values(snapRows).onConflictDoNothing();
  if (obsRows.length) await db.insert(observations).values(obsRows).onConflictDoNothing();
  return { persisted: snapRows.length };
}
