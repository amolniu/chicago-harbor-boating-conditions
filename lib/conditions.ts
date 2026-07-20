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

export interface HarborConditions {
  id: string;
  name: string;
  conditions: Conditions;
}

function assemble(harbor: Harbor, near: BuoyCurrent | null, wave: BuoyCurrent | null, advisory: Conditions["advisory"]): Conditions {
  const pick = (k: keyof BuoyCurrent) => (near?.[k] ?? wave?.[k] ?? null) as number | null;
  const windFromNear = near?.windKt != null;
  return {
    windDir: pick("windDir"),
    windKt: pick("windKt"),
    gustKt: pick("gustKt"),
    waveFt: (near?.waveFt ?? wave?.waveFt) ?? null,
    wavePeriodS: (near?.wavePeriodS ?? wave?.wavePeriodS) ?? null,
    waveDir: (near?.waveDir ?? wave?.waveDir) ?? null,
    waterTempF: pick("waterTempF"),
    airTempF: pick("airTempF"),
    advisory,
    source: windFromNear ? harbor.buoyStation : PRIMARY_WAVE_STATION,
    observedAt: near?.observedAt ?? wave?.observedAt ?? null,
  };
}

/** Live conditions for every harbor. Fetches each unique station/zone once. */
export async function getAllConditions(): Promise<HarborConditions[]> {
  const stations = Array.from(new Set([...HARBORS.map((h) => h.buoyStation), PRIMARY_WAVE_STATION]));
  const zones = Array.from(new Set(HARBORS.map((h) => h.marineZone)));

  const [buoyEntries, marineEntries] = await Promise.all([
    Promise.all(stations.map(async (s) => [s, await getBuoyCurrent(s)] as const)),
    Promise.all(zones.map(async (z) => [z, (await getMarineForecast(z)).advisory] as const)),
  ]);
  const buoys = new Map(buoyEntries);
  const advisories = new Map(marineEntries);
  const wave = buoys.get(PRIMARY_WAVE_STATION) ?? null;

  return HARBORS.map((h) => ({
    id: h.id,
    name: h.name,
    conditions: assemble(h, buoys.get(h.buoyStation) ?? null, wave, advisories.get(h.marineZone) ?? "none"),
  }));
}

/** Conditions for a single harbor (detail page). */
export async function getHarborConditions(harbor: Harbor): Promise<Conditions> {
  const [near, wave, marine] = await Promise.all([
    getBuoyCurrent(harbor.buoyStation),
    harbor.buoyStation === PRIMARY_WAVE_STATION ? Promise.resolve(null) : getBuoyCurrent(PRIMARY_WAVE_STATION),
    getMarineForecast(harbor.marineZone),
  ]);
  const waveSrc = harbor.buoyStation === PRIMARY_WAVE_STATION ? near : wave;
  return assemble(harbor, near, waveSrc, marine.advisory);
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
