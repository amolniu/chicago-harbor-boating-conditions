// Orchestration: assemble canonical Conditions for every harbor from the raw
// sources (nearest buoy for localized wind/temp, an optional dedicated wave buoy
// blended with the per-harbor NWS gridpoint for waves, marine zone for advisories),
// and optionally persist a snapshot.
//
// Server-only.

import { Conditions, type StormRisk } from "./types";
import { Harbor, HARBORS, windNeighbors } from "./harbors";
import { BuoyCurrent, getBuoyCurrent } from "./ndbc";
import { getMarineForecast, getGridCurrent, type GridCurrent } from "./nws";
import { getGlosCurrent, type GlosCurrent } from "./glos";
import { getActiveAlerts, type WeatherAlert } from "./alerts";
import { getStormOutlook, stormCellKey } from "./storm";
import { rate } from "./rating";
import { getBoat, DEFAULT_BOAT_ID, DEFAULT_SKILL } from "./boats";
import { getDb } from "@/db";
import { harborSnapshots, observations, type ObservationRow } from "@/db/schema";


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

export function assemble(
  harbor: Harbor,
  buoys: Map<string, BuoyCurrent | null>,
  gridCurrent: GridCurrent | null,
  advisory: Conditions["advisory"],
  storm: StormRisk | undefined,
  glos: GlosCurrent | null = null,
  alerts: WeatherAlert[] = [],
): Conditions {
  // Same-shore stations within reach, nearest first (lib/harbors.ts windNeighbors) —
  // never the far side of the lake, and none at all for windFromGrid harbors. Past
  // them, every harbor ends at its own gridpoint model.
  const neighbors = windNeighbors(harbor);
  // A dedicated local wave buoy (if set) leads the data chain: it sits right off
  // the harbor, so its observed waves/water-temp beat the model and distant buoys.
  const dataChain = uniq(
    [harbor.waveBuoy?.station, harbor.buoyStation, ...neighbors].filter((s): s is string => !!s),
  );

  // Wind: a real observation always wins. Try the harbor's own buoy, then its same-shore
  // neighbours, then a validated Spotter, and only then the gridpoint model. Until
  // 2026-10-03 the neighbours were one global Chicago list, so a dark 45161 put three
  // Michigan harbors on Chicago wind from 170–200 km across the lake.
  const windChain = uniq([harbor.buoyStation, ...neighbors].filter((s): s is string => !!s));
  const wind = pickField(buoys, windChain, "windKt");
  const wb = wind.station ? buoys.get(wind.station) : null;

  // Direction and gust resolve DOWN THE CHAIN INDEPENDENTLY of speed, because a buoy
  // can lose one sensor and keep another: 45198 (Chicago Buoy) currently reports speed
  // on every row and WDIR/GST on none. Taking direction only from the speed station
  // left all ten Chicago harbors with windDir === null, which disabled the exposure model:
  // at the time exitWave and crosswind were simply SKIPPED without a bearing, so the
  // harbor-exit half of the rating — the thing this app exists for — quietly vanished, and
  // scores read optimistically. rate() no longer skips them (it substitutes the harbor's
  // worst-case geometry instead, see 9ae26c4), so a null bearing is now merely pessimistic
  // rather than dangerous — but borrowing a real one keeps the harbors distinguishable,
  // which is the whole point.
  // Borrowing a direction from a neighbour ~10 km away is a far better approximation
  // than having none; the lake's wind field is coherent at that scale.
  const dirPick = pickField(buoys, windChain, "windDir");
  const gustPick = pickField(buoys, windChain, "gustKt");

  let windDir: number | null;
  let windKt: number | null;
  let gustKt: number | null;
  let windObservedAt: string | null;
  let windSource: string;
  // Spectral wind from a validated Spotter (glos.windId): an OBSERVATION, so it beats
  // the model — triangulated 2026-09-02, the gridpoint model read 0.72× a same-site
  // anemometer on Green Bay (optimistic = the dangerous direction) while the Spotter
  // read 1.1–1.25× (conservative). Spotters carry no wind DIRECTION, so direction
  // stays with the model: direction is large-scale flow and models carry it well;
  // magnitude is what under-reads over a narrow bay.
  const spotterWindKt = harbor.waveBuoy?.glos?.windId != null ? glos?.windKt ?? null : null;

  if (wind.value != null) {
    windKt = wind.value;
    // Model direction is the last resort — better a modeled bearing than none.
    windDir = dirPick.value ?? gridCurrent?.windDir ?? null;
    // A gust below the sustained wind is not a gust. That can happen when the gust
    // comes from a different station than the speed, so require it to exceed it. With
    // no USABLE station gust — none in reach, or one rejected just above — the model's is
    // used on the same terms as for a Spotter: only when it says something the
    // observation doesn't. (A rejected gust must not also veto the model's: that left the
    // rating with no gust term at all, which is the optimistic direction.)
    const stationGust = gustPick.value != null && gustPick.value >= wind.value ? gustPick.value : null;
    gustKt =
      stationGust ??
      (gridCurrent?.gustKt != null && gridCurrent.gustKt > wind.value ? gridCurrent.gustKt : null);
    windObservedAt = wb?.observedAt ?? null;
    windSource = wind.station ?? harbor.buoyStation ?? "forecast";
  } else if (spotterWindKt != null) {
    windDir = gridCurrent?.windDir ?? null;
    windKt = spotterWindKt;
    // Keep the model's gust only when it says something the observation doesn't: an
    // under-reading model's "gust" below the observed sustained wind is noise.
    gustKt = gridCurrent?.gustKt != null && gridCurrent.gustKt > spotterWindKt ? gridCurrent.gustKt : null;
    windObservedAt = glos?.windObservedAt ?? null;
    windSource = harbor.waveBuoy?.glos?.label ?? "GLOS buoy";
  } else if (gridCurrent?.windKt != null) {
    // Every harbor's last resort, not just windFromGrid ones: its own modeled wind beats
    // borrowing a reading from the wrong shore — or showing nothing.
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
    // Water temp, nearest source first. The wider dataChain ends in same-shore
    // neighbours up to MAX_NEIGHBOR_KM away, so a GLOS platform a few km offshore must
    // be consulted BEFORE it. (45161 does carry a temp probe; the Spotters simply sit
    // far closer to the harbors.)
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
  const stations = uniq(
    HARBORS.flatMap((h) => [h.buoyStation, h.waveBuoy?.station, ...windNeighbors(h)]).filter(
      (s): s is string => !!s,
    ),
  );
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
    [harbor.buoyStation, harbor.waveBuoy?.station, ...windNeighbors(harbor)].filter(
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
    // An observations row is filed only for the harbor's OWN station. A borrowing harbor's
    // conditions carry its own blended waves and possibly the model's gust, so filing them
    // under a neighbour's id (or "NWS model" as if it were a station) would corrupt that
    // station's record. The owner writes its own row; borrowed readings live in snapshots.
    if (c.source && !h.windFromGrid && c.source === h.buoyStation && !seenStations.has(c.source)) {
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
