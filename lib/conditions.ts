// Orchestration: assemble canonical Conditions for every harbor from the raw
// sources (nearest buoy for localized wind/temp, buoy 45198 as the primary wave
// source, marine zone for advisories), and optionally persist a snapshot.
//
// Server-only.

import { Conditions } from "./types";
import { Harbor, HARBORS } from "./harbors";
import { BuoyCurrent, getBuoyCurrent } from "./ndbc";
import { getMarineForecast } from "./nws";
import { rate } from "./rating";
import { getBoat, DEFAULT_BOAT_ID, DEFAULT_SKILL } from "./boats";
import { getDb } from "@/db";
import { harborSnapshots, observations, type ObservationRow } from "@/db/schema";

const PRIMARY_WAVE_STATION = "45198"; // Chicago Buoy — full wave spectra

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

function assemble(harbor: Harbor, buoys: Map<string, BuoyCurrent | null>, advisory: Conditions["advisory"]): Conditions {
  const windChain = uniq([harbor.buoyStation, ...WIND_FALLBACK]);
  // Waves + temps prefer the harbor's own station, then the primary wave buoy.
  const dataChain = uniq([harbor.buoyStation, PRIMARY_WAVE_STATION, ...WIND_FALLBACK]);

  // Wind dir/speed/gust must come from one station for consistency.
  const wind = pickField(buoys, windChain, "windKt");
  const wb = wind.station ? buoys.get(wind.station) : null;

  const wave = pickField(buoys, dataChain, "waveFt");
  const wvb = wave.station ? buoys.get(wave.station) : null;

  return {
    windDir: wb?.windDir ?? null,
    windKt: wind.value,
    gustKt: wb?.gustKt ?? null,
    waveFt: wave.value,
    wavePeriodS: wvb?.wavePeriodS ?? null,
    waveDir: wvb?.waveDir ?? null,
    waterTempF: pickField(buoys, dataChain, "waterTempF").value,
    airTempF: pickField(buoys, dataChain, "airTempF").value,
    advisory,
    source: wind.station ?? wave.station ?? harbor.buoyStation,
    observedAt: wb?.observedAt ?? wvb?.observedAt ?? null,
  };
}

/** Live conditions for every harbor. Fetches each unique station/zone once. */
export async function getAllConditions(): Promise<HarborConditions[]> {
  const stations = uniq([...HARBORS.map((h) => h.buoyStation), PRIMARY_WAVE_STATION, ...WIND_FALLBACK]);
  const zones = uniq(HARBORS.map((h) => h.marineZone));

  const [buoyEntries, marineEntries] = await Promise.all([
    Promise.all(stations.map(async (s) => [s, await getBuoyCurrent(s)] as const)),
    Promise.all(zones.map(async (z) => [z, (await getMarineForecast(z)).advisory] as const)),
  ]);
  const buoys = new Map(buoyEntries);
  const advisories = new Map(marineEntries);

  return HARBORS.map((h) => ({
    id: h.id,
    name: h.name,
    conditions: assemble(h, buoys, advisories.get(h.marineZone) ?? "none"),
  }));
}

/** Conditions for a single harbor (detail page). */
export async function getHarborConditions(harbor: Harbor): Promise<Conditions> {
  const stations = uniq([harbor.buoyStation, PRIMARY_WAVE_STATION, ...WIND_FALLBACK]);
  const [buoyEntries, marine] = await Promise.all([
    Promise.all(stations.map(async (s) => [s, await getBuoyCurrent(s)] as const)),
    getMarineForecast(harbor.marineZone),
  ]);
  return assemble(harbor, new Map(buoyEntries), marine.advisory);
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
