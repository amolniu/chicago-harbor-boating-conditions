// Orchestration: assemble canonical Conditions for every harbor from the raw
// sources (nearest buoy for localized wind/temp, an optional dedicated wave buoy
// blended with the per-harbor NWS gridpoint for waves, marine zone for advisories),
// and optionally persist a snapshot.
//
// Server-only.

import { Conditions, type StormRisk } from "./types";
import { Harbor, HARBORS } from "./harbors";
import { BuoyCurrent, getBuoyCurrent } from "./ndbc";
import { getMarineForecast, getGridCurrent, type GridCurrent } from "./nws";
import { getGlosCurrent, type GlosCurrent } from "./glos";
import { getActiveAlerts, type WeatherAlert } from "./alerts";
import { getStormOutlook, stormCellKey } from "./storm";
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
// Storm outlook is resolved per geographic CELL, not from one metro point: nearby
// harbors legitimately share a thunderstorm outlook, but harbors hundreds of km apart
// must not (a Chicago squall shouldn't red out Green Bay, and a storm over Escanaba
// must not go unseen). Harbors are grouped by stormCellKey and each cell is queried
// once, at the CENTROID of its harbors — a real point among them rather than an
// arbitrary grid node. Cells are derived from HARBORS, so new harbors need no config.
const STORM_CELLS = (() => {
  const acc = new Map<string, { lat: number; lon: number; n: number; tz?: string }>();
  for (const h of HARBORS) {
    const key = stormCellKey(h.lat, h.lon);
    const g = acc.get(key);
    if (g) {
      g.lat += h.lat;
      g.lon += h.lon;
      g.n += 1;
    } else {
      // Harbors in one cell are within ~50 km, so the first one's timezone applies to
      // the whole cell. Using the cell's tz (not each harbor's) keeps the headline
      // identical on the board and the detail page.
      acc.set(key, { lat: h.lat, lon: h.lon, n: 1, tz: h.timezone });
    }
  }
  return new Map(
    Array.from(acc, ([key, g]) => [key, { lat: g.lat / g.n, lon: g.lon / g.n, tz: g.tz }] as const),
  );
})();

function stormCellFor(harbor: Harbor): { lat: number; lon: number; tz?: string } {
  return STORM_CELLS.get(stormCellKey(harbor.lat, harbor.lon)) ?? { lat: harbor.lat, lon: harbor.lon, tz: harbor.timezone };
}

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
  gridCurrent: GridCurrent | null,
  advisory: Conditions["advisory"],
  storm: StormRisk | undefined,
  glos: GlosCurrent | null = null,
  alerts: WeatherAlert[] = [],
): Conditions {
  // The Chicago-neighborhood buoy fallback only fits harbors that lean on those
  // buoys. A harbor with no nearby buoy takes live wind from its own gridpoint model
  // (windFromGrid) and does NOT borrow far-off Chicago obs for wind or water temp.
  const usesGrid = !!harbor.windFromGrid;
  const fallback = usesGrid ? [] : WIND_FALLBACK;
  // A dedicated local wave buoy (if set) leads the data chain: it sits right off
  // the harbor, so its observed waves/water-temp beat the model and distant buoys.
  const dataChain = uniq(
    [
      harbor.waveBuoy?.station,
      harbor.buoyStation,
      ...(usesGrid ? [] : [PRIMARY_WAVE_STATION]),
      ...fallback,
    ].filter((s): s is string => !!s),
  );

  // Wind: a real observation always wins. Try the harbor's own buoy (plus the Chicago
  // neighbours where those apply), and only fall back to the gridpoint model when the
  // harbor opted in via windFromGrid. That makes windFromGrid a FALLBACK rather than
  // an override, so a harbor can name an intermittent station (several Green Bay
  // stations go quiet for days) and still read correctly while it's dark.
  const windChain = uniq([harbor.buoyStation, ...fallback].filter((s): s is string => !!s));
  const wind = pickField(buoys, windChain, "windKt");
  const wb = wind.station ? buoys.get(wind.station) : null;

  let windDir: number | null;
  let windKt: number | null;
  let gustKt: number | null;
  let windObservedAt: string | null;
  let windSource: string;
  if (wind.value != null) {
    windDir = wb?.windDir ?? null;
    windKt = wind.value;
    gustKt = wb?.gustKt ?? null;
    windObservedAt = wb?.observedAt ?? null;
    windSource = wind.station ?? harbor.buoyStation ?? "forecast";
  } else if (usesGrid) {
    windDir = gridCurrent?.windDir ?? null;
    windKt = gridCurrent?.windKt ?? null;
    gustKt = gridCurrent?.gustKt ?? null;
    windObservedAt = null; // a model nowcast, not an observation
    windSource = "NWS model";
  } else {
    windDir = null;
    windKt = null;
    gustKt = null;
    windObservedAt = null;
    windSource = harbor.buoyStation ?? "forecast";
  }

  // Waves: blend an observed local wave buoy with the per-harbor NWS gridpoint model,
  // weighting the observation by how close its buoy is (waveObsWeight). Real
  // observations lead, the model still contributes. Fall back to whichever exists,
  // then to any buoy in the chain. Period/direction come from the observed buoy first.
  // The observed wave can come from an NDBC buoy or a GLOS platform (used where the
  // nearest NDBC buoy reports no waves at all); both reduce to the same shape here.
  const waveSrc = harbor.waveBuoy;
  const localWave = waveSrc?.station ? buoys.get(waveSrc.station) : waveSrc?.glos ? glos ?? null : null;
  const obsWave = localWave?.waveFt ?? null;
  const modelWave = gridCurrent?.waveFt ?? null;
  const obsWeight = waveSrc ? waveObsWeight(waveSrc.km) : 0;
  let waveFt: number | null;
  let wavePeriodS: number | null;
  let waveDir: number | null;
  if (obsWave != null && modelWave != null) {
    waveFt = obsWeight * obsWave + (1 - obsWeight) * modelWave;
    wavePeriodS = localWave?.wavePeriodS ?? gridCurrent?.wavePeriodS ?? null;
    waveDir = localWave?.waveDir ?? gridCurrent?.waveDir ?? null;
  } else if (obsWave != null) {
    waveFt = obsWave;
    wavePeriodS = localWave?.wavePeriodS ?? null;
    waveDir = localWave?.waveDir ?? null;
  } else if (modelWave != null) {
    waveFt = modelWave;
    wavePeriodS = gridCurrent?.wavePeriodS ?? null;
    waveDir = gridCurrent?.waveDir ?? null;
  } else {
    const wave = pickField(buoys, dataChain, "waveFt");
    const wvb = wave.station ? buoys.get(wave.station) : null;
    waveFt = wave.value;
    wavePeriodS = wvb?.wavePeriodS ?? null;
    waveDir = wvb?.waveDir ?? null;
  }

  return {
    windDir,
    windKt,
    gustKt,
    waveFt,
    wavePeriodS,
    waveDir,
    // Water temp, nearest source first. The wider dataChain ends in the Chicago
    // neighbours, so a GLOS platform a few km offshore must be consulted BEFORE it —
    // otherwise a Michigan harbor whose own buoy has no temp sensor (45161) would
    // report Lake Michigan's far side, 150 km away.
    // waveBuoy (NDBC or GLOS) is by definition the closest local source, so it leads;
    // then the harbor's own station; then the wider chain.
    waterTempF:
      (waveSrc?.station ? buoys.get(waveSrc.station)?.waterTempF : null) ??
      glos?.waterTempF ??
      (harbor.buoyStation ? buoys.get(harbor.buoyStation)?.waterTempF : null) ??
      pickField(buoys, dataChain, "waterTempF").value,
    airTempF: pickField(buoys, dataChain, "airTempF").value,
    advisory,
    source: windSource,
    observedAt: windObservedAt,
    storm,
    alerts,
  };
}

function toStormRisk(o: Awaited<ReturnType<typeof getStormOutlook>>): StormRisk | undefined {
  return o ? { level: o.level, headline: o.headline, capeNow: o.capeNow } : undefined;
}

/** Top-of-hour ISO timestamps flagged thunderstorm-likely (for the sail window),
 *  for this harbor's storm cell. */
export async function getStormHours(harbor: Harbor): Promise<string[]> {
  const cell = stormCellFor(harbor);
  const o = await getStormOutlook(cell.lat, cell.lon, cell.tz);
  return o?.stormyHours ?? [];
}

/** Live conditions for every harbor. Fetches each unique station/zone once. */
export async function getAllConditions(): Promise<HarborConditions[]> {
  const stations = uniq([
    ...HARBORS.map((h) => h.buoyStation).filter((s): s is string => !!s),
    ...HARBORS.map((h) => h.waveBuoy?.station).filter((s): s is string => !!s),
    PRIMARY_WAVE_STATION,
    ...WIND_FALLBACK,
  ]);
  const zones = uniq(HARBORS.map((h) => h.marineZone));
  const grids = uniq(HARBORS.map((h) => h.waveGrid));

  // Only the handful of harbors with a GLOS wave source, keyed by platform id.
  const glosRefs = new Map(HARBORS.filter((h) => h.waveBuoy?.glos).map((h) => [h.waveBuoy!.glos!.datasetId, h.waveBuoy!.glos!]));

  const [buoyEntries, gridEntries, marineEntries, stormEntries, glosEntries, alertEntries] = await Promise.all([
    Promise.all(stations.map(async (s) => [s, await getBuoyCurrent(s)] as const)),
    Promise.all(grids.map(async (g) => [g, await getGridCurrent(g)] as const)),
    Promise.all(zones.map(async (z) => [z, (await getMarineForecast(z)).advisory] as const)),
    Promise.all(
      Array.from(STORM_CELLS, async ([key, p]) => [key, await getStormOutlook(p.lat, p.lon, p.tz)] as const),
    ),
    Promise.all(Array.from(glosRefs, async ([id, ref]) => [id, await getGlosCurrent(ref)] as const)),
    // Per harbor, not per storm cell: warning polygons are small, so a cell centroid
    // would both miss real warnings and invent ones that don't cover the harbor.
    Promise.all(HARBORS.map(async (h) => [h.id, await getActiveAlerts(h.lat, h.lon)] as const)),
  ]);
  const buoys = new Map(buoyEntries);
  const gridCur = new Map(gridEntries);
  const advisories = new Map(marineEntries);
  const storms = new Map(stormEntries);
  const glosCur = new Map(glosEntries);
  const alerts = new Map(alertEntries);

  return HARBORS.map((h) => ({
    id: h.id,
    name: h.name,
    conditions: assemble(
      h,
      buoys,
      gridCur.get(h.waveGrid) ?? null,
      advisories.get(h.marineZone) ?? "none",
      toStormRisk(storms.get(stormCellKey(h.lat, h.lon)) ?? null),
      h.waveBuoy?.glos ? glosCur.get(h.waveBuoy.glos.datasetId) ?? null : null,
      alerts.get(h.id) ?? [],
    ),
  }));
}

/** Conditions for a single harbor (detail page). */
export async function getHarborConditions(harbor: Harbor): Promise<Conditions> {
  const stations = uniq(
    [harbor.buoyStation, harbor.waveBuoy?.station, PRIMARY_WAVE_STATION, ...WIND_FALLBACK].filter(
      (s): s is string => !!s,
    ),
  );
  const cell = stormCellFor(harbor);
  const glosRef = harbor.waveBuoy?.glos;
  const [buoyEntries, gridCurrent, marine, stormOutlook, glos, alerts] = await Promise.all([
    Promise.all(stations.map(async (s) => [s, await getBuoyCurrent(s)] as const)),
    getGridCurrent(harbor.waveGrid),
    getMarineForecast(harbor.marineZone),
    getStormOutlook(cell.lat, cell.lon, cell.tz),
    glosRef ? getGlosCurrent(glosRef) : Promise.resolve(null),
    getActiveAlerts(harbor.lat, harbor.lon),
  ]);
  return assemble(harbor, new Map(buoyEntries), gridCurrent, marine.advisory, toStormRisk(stormOutlook), glos, alerts);
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
    if (c.source && !h.windFromGrid && !seenStations.has(c.source)) {
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
