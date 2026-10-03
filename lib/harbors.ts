// Harbor intelligence — the core IP of the dashboard.
//
// A lake-wide marine forecast says "waves 2–4 ft." But whether that matters to
// YOU depends on your harbor's geometry: which way its entrance opens, how much
// open-lake fetch reaches its breakwall, and whether the wind blows across its
// mouth. This file encodes that per-harbor knowledge so the rules engine can
// translate one lake forecast into ten different answers.
//
// The exposure numbers below are SEED values derived from harbor geometry and
// general local knowledge. They are a living dataset: the whole point of the
// project is to refine them with real sailor input over time.

import { Compass16, COMPASS_16, angleDiff, degToCompass } from "./units";
// Type-only: erased at compile time, so this file stays isomorphic.
import type { GlosWaveRef } from "./glos";

export interface Harbor {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Heading (deg true) a boat steers when leaving the harbor into the lake. */
  entranceBearing: number;
  /** Overall openness to the lake, 0 (tucked away) – 1 (wide open). */
  exposureScale: number;
  /** Directions the breakwater notably blocks (wave energy cut to ~40%). */
  shelteredDirs?: Compass16[];
  /** Directions that funnel unusually badly onto the entrance (×1.4). */
  exposedDirs?: Compass16[];
  /** Nearest NDBC station for localized wind/temp. Optional: buoy-less harbors
   *  (windFromGrid) omit it and take live wind from their gridpoint model instead. */
  buoyStation?: string;
  /** Borrow from NO neighbouring station: when this harbor's own sources (buoyStation,
   *  Spotter) are quiet, go straight to its own NWS gridpoint model — for regions with
   *  no usable wind buoy (e.g. much of Green Bay), or where the only nearby station
   *  reports intermittently. A fresh `buoyStation` reading always wins. Every harbor
   *  ends at its model anyway; this flag only skips the same-shore neighbours
   *  (windNeighbors) in between. */
  windFromGrid?: boolean;
  /** Optional dedicated wave source sitting right off the harbor. Its OBSERVED wave
   *  height is blended with the gridpoint model for current conditions, weighted by
   *  `km` (distance from the harbor — closer ⇒ more weight, see waveObsWeight). The NWS
   *  gridpoint still drives the wave FORECAST series.
   *
   *  Set exactly one of `station` (an NDBC buoy — often a wave-only one such as
   *  45186/45187, and it may be the same station as buoyStation) or `glos` (a GLOS
   *  Seagull platform, for harbors whose nearest NDBC buoy reports no waves at all).
   *  A GLOS platform can also supply water temperature. */
  waveBuoy?: { km: number; station?: string; glos?: GlosWaveRef };
  /** NWS nearshore marine zone for forecasts + advisories. */
  marineZone: string;
  /** NWS gridpoint (e.g. "LOT/76,76") for the harbor's offshore point — carries
   *  per-harbor wave height/period/direction + marine wind. */
  waveGrid: string;
  /** Compass bearing (deg true) toward open water / longest fetch. When set, the
   *  base fetch shape is ROTATED to point here — needed for harbors that aren't on
   *  Chicago's west shore (e.g. Michigan's east shore, where a WEST wind is the big
   *  onshore wave-maker). Unset ⇒ use the shape as-is (west shore / Chicago). */
  openWaterBearing?: number;
  /** NWS office for the Area Forecast Discussion. Default "LOT" (Chicago). */
  discussionOffice?: string;
  /** NWS RIDGE radar station, e.g. "KLOT". Default "KLOT" (Chicago). */
  radarStation?: string;
  /** IANA timezone for local-time copy (e.g. storm headlines). Default
   *  "America/Chicago". Michigan's east shore — and Delta County in the UP — are
   *  Eastern ("America/Detroit"), while the far-western UP stays Central. */
  timezone?: string;
  /** Lakefront webcam image URL. Default the GLERL Chicago cam; empty string hides the panel. */
  webcamUrl?: string;
  notes: {
    entrance: string;
    docking: string;
    hazards: string;
  };
}

/** Which side of Lake Michigan a station or harbor sits on. */
export type Shore = "west" | "east";

/**
 * Stations a harbor may BORROW from when its own station is dark or has lost a sensor —
 * with where each sits and which shore it is on. See windNeighbors() for the rule.
 *
 * Until 2026-10-03 every harbor without windFromGrid borrowed from one global Chicago
 * list, so a dark 45161 meant Grand Haven, Muskegon and Whitehall rated on Chicago wind
 * from 170–200 km ACROSS the lake, and Southport on stations 80 km south — a different
 * weather regime, presented as an observation. Now a harbor borrows only from its own
 * shore, within MAX_NEIGHBOR_KM, and otherwise falls to its own gridpoint model.
 *
 * Proximity is not accuracy, so membership is MEASURED, not assumed. Hourly-matched mean
 * wind over the ~44 days in each realtime2 file (2026-10-03), neighbour ÷ the primary it
 * would stand in for:
 *
 *   CHII2 → 45198   3 km  1.24×  r 0.92    45186 ↔ 45187  14 km  1.00×  r 0.91
 *   45198 → 45187  69 km  1.08×  r 0.76    CHII2 → 45187  66 km  1.35×  r 0.75
 *   45170 → 45026  38 km  1.10×  r 0.77    45168 → 45026  52 km  1.10×  r 0.72
 *   45168 → 45161  88 km  0.82×  r 0.53    45026 → 45161 136 km  0.77×  r 0.47
 *
 * Two stations are deliberately ABSENT because they read low, and borrowing from an
 * under-reader errs in the dangerous direction — the model is the better last resort:
 * CMTI2, 0.65× inside sheltered Calumet Harbor (see 59th / jackson-inner), and CNII2 on
 * Northerly Island, 0.73× the Chicago Buoy 6 km away (r 0.83). CNII2 led the old Chicago
 * list for years without ever having been checked. Re-measure before adding a station.
 * Positions: NDBC activestations.xml. Lives here rather than in conditions.ts so the
 * isomorphic health checker can read the same chains the assembler uses.
 */
export const NEIGHBOR_STATIONS: { id: string; lat: number; lon: number; shore: Shore }[] = [
  { id: "45198", lat: 41.892, lon: -87.563, shore: "west" }, // Chicago Buoy
  { id: "CHII2", lat: 41.916, lon: -87.572, shore: "west" }, // Harrison-Dever Crib (reads high)
  { id: "45186", lat: 42.368, lon: -87.795, shore: "west" }, // Waukegan Buoy
  { id: "45187", lat: 42.491, lon: -87.779, shore: "west" }, // Winthrop Harbor Buoy
  { id: "45170", lat: 41.755, lon: -86.968, shore: "east" }, // Michigan City Buoy
  { id: "45026", lat: 41.982, lon: -86.619, shore: "east" }, // Cook Nuclear Plant Buoy
  { id: "45168", lat: 42.397, lon: -86.331, shore: "east" }, // South Haven Buoy
  { id: "45161", lat: 43.185, lon: -86.354, shore: "east" }, // Muskegon Buoy
];

/** Furthest a borrowed reading may come from, per shore — set from the table above, not
 *  from geometry. On the west shore, pairs 66–69 km apart still track (r ≈ 0.75, and read
 *  slightly HIGH), as well as the 52–56 km pairs do; 85 km lets Southport and North Point
 *  reach the Chicago crib and buoy when both north-shore buoys are out (they are deployed
 *  and pulled on the same days) instead of an MKX model seen reading 0.24× in an onshore
 *  wind. On the east shore, the 88 km pairs barely track (r ≈ 0.5), so it stays at 60 —
 *  the reference cap the station validator uses. Beyond the reach, the model. */
export const MAX_NEIGHBOR_KM: Record<Shore, number> = { west: 85, east: 60 };

export const DEFAULT_DISCUSSION_OFFICE = "LOT";
export const DEFAULT_RADAR_STATION = "KLOT";
export const DEFAULT_WEBCAM_URL = "https://www.glerl.noaa.gov/metdata/chi/chi01.jpg";

// Open-lake wave-generating fetch by the direction the wind blows FROM.
// Chicago sits on the west shore, so westerly winds are offshore (little fetch),
// while the long fetch across and up the lake is from the N through E to SE.
const BASE_FETCH: Record<Compass16, number> = {
  N: 0.7, NNE: 0.85, NE: 1.0, ENE: 1.0, E: 0.95, ESE: 0.85, SE: 0.75, SSE: 0.6,
  S: 0.5, SSW: 0.3, SW: 0.15, WSW: 0.1, W: 0.1, WNW: 0.1, NW: 0.2, NNW: 0.45,
};

/** Linearly interpolate the base fetch for an arbitrary wind bearing. */
function interpFetch(windDir: number): number {
  const d = (((windDir % 360) + 360) % 360) / 22.5;
  const i = Math.floor(d) % 16;
  const j = (i + 1) % 16;
  const frac = d - Math.floor(d);
  return BASE_FETCH[COMPASS_16[i]] * (1 - frac) + BASE_FETCH[COMPASS_16[j]] * frac;
}

/** Harbor-independent open-lake fetch factor (0–1) for a wind direction. */
export function lakeFetchFactor(windDir: number): number {
  return interpFetch(windDir);
}

// Bearing of the base fetch shape's peak (Chicago's open water is ~ENE). A harbor
// with its own openWaterBearing rotates the shape so its peak points that way.
const BASE_OPEN_WATER = 60;

function harborFetch(harbor: Harbor, windDir: number): number {
  const dir = harbor.openWaterBearing != null ? windDir - (harbor.openWaterBearing - BASE_OPEN_WATER) : windDir;
  return interpFetch(dir);
}

/**
 * How much open-lake wave energy reaches this harbor's entrance for a given
 * wind direction. ~0 = sheltered, 1 = fully exposed. Combines lake fetch (oriented
 * to the harbor's open water) with the harbor's breakwater geometry.
 */
export function exposureForWind(harbor: Harbor, windDir: number): number {
  let e = harborFetch(harbor, windDir) * harbor.exposureScale;
  const c = degToCompass(windDir);
  if (harbor.shelteredDirs?.includes(c)) e *= 0.4;
  if (harbor.exposedDirs?.includes(c)) e *= 1.4;
  return Math.max(0, Math.min(1.3, e));
}

/**
 * The worst exposure this harbor can suffer from ANY direction.
 *
 * Used when the wind bearing is unknown, so the rating can assume the worst geometry
 * instead of silently skipping the exposure model. Per-harbor rather than the 1.3
 * clamp ceiling, because a well-sheltered basin cannot reach 1.3 from any bearing and
 * assuming it could would manufacture caution that the geometry rules out.
 *
 * ⚠️ Sampling the sixteen compass points is NOT enough, though it looks like it should
 * be. `interpFetch` interpolates between sector CENTRES, while `degToCompass` switches
 * the ×1.4 / ×0.4 modifier at sector BOUNDARIES (centre ± 11.25°). The product therefore
 * peaks where the modifier flips onto the rising flank of the fetch curve — at an edge
 * the 16-point sweep never samples. Measured when this was a 16-point sweep: Montrose
 * read 0.735 against a true 0.784 at 123.8° (a boundary), Burnham 0.383 vs 0.405, 31st
 * 0.798 vs 0.819 — all three harbors with `exposedDirs` on a rising flank, and all three
 * under-reporting the worst case, which is the optimistic direction.
 *
 * So sweep finely. Memoised because a harbor's geometry is static config: this runs once
 * per harbor for the life of the process, which makes it cheaper than the old per-call
 * 16-point loop as well as correct.
 */
const MAX_EXPOSURE_STEP_DEG = 0.25;
const maxExposureCache = new Map<string, number>();

export function maxExposure(harbor: Harbor): number {
  const hit = maxExposureCache.get(harbor.id);
  if (hit !== undefined) return hit;
  let worst = 0;
  for (let d = 0; d < 360; d += MAX_EXPOSURE_STEP_DEG) {
    const e = exposureForWind(harbor, d);
    if (e > worst) worst = e;
  }
  maxExposureCache.set(harbor.id, worst);
  return worst;
}

/**
 * Crosswind component (kt) across the entrance channel — the thing that makes
 * threading a breakwater gap or docking hard. Max when wind is perpendicular to
 * the exit heading, zero when it's a straight head/tailwind.
 */
export function crosswindKt(harbor: Harbor, windDir: number, windKt: number): number {
  const theta = (angleDiff(windDir, harbor.entranceBearing) * Math.PI) / 180;
  return Math.abs(Math.sin(theta)) * windKt;
}

// Ten Chicago Park District harbors, north → south.
export const HARBORS: Harbor[] = [
  {
    id: "montrose",
    waveGrid: "LOT/76,77",
    name: "Montrose Harbor",
    lat: 41.9636, lon: -87.6375,
    entranceBearing: 150,
    exposureScale: 0.7,
    exposedDirs: ["SE", "SSE"],
    // 45198, not CHII2: the Harrison-Dever Crib station (GLERL) went whole-station dark
    // 2026-08-18 with no retirement notice - live wind fell back fine, but history froze.
    // The Chicago Buoy is 7-10 km out, already this harbor's wave source, and validated
    // 1.01x. CHII2 stays a same-shore neighbour (NEIGHBOR_STATIONS) as a backup.
    buoyStation: "45198",
    waveBuoy: { station: "45198", km: 10 },
    marineZone: "LMZ742",
    notes: {
      entrance: "Wide SE-facing mouth behind the curving breakwater; open to south/southeast swell.",
      docking: "Roomy fairways, but a south wind sets you onto the outer slips.",
      hazards: "Shoaling reported along the inside of the breakwater — favor mid-channel on entry.",
    },
  },
  {
    id: "belmont",
    waveGrid: "LOT/76,76",
    name: "Belmont Harbor",
    lat: 41.9401, lon: -87.6360,
    entranceBearing: 60,
    exposureScale: 0.9,
    exposedDirs: ["NE", "ENE", "N"],
    // 45198, not CHII2: the Harrison-Dever Crib station (GLERL) went whole-station dark
    // 2026-08-18 with no retirement notice - live wind fell back fine, but history froze.
    // The Chicago Buoy is 7-10 km out, already this harbor's wave source, and validated
    // 1.01x. CHII2 stays a same-shore neighbour (NEIGHBOR_STATIONS) as a backup.
    buoyStation: "45198",
    waveBuoy: { station: "45198", km: 8 },
    marineZone: "LMZ742",
    notes: {
      entrance: "The breakwall gap opens to the northeast. Strong NE winds stack steep waves right at the mouth, making the exit the hardest part of the day.",
      docking: "Once inside it's calm, but the approach to the gap is exposed on a NE blow.",
      hazards: "Waves reflect off the north breakwall and confuse the sea state near the entrance.",
    },
  },
  {
    id: "diversey",
    waveGrid: "LOT/76,76",
    name: "Diversey Harbor",
    lat: 41.9322, lon: -87.6366,
    entranceBearing: 90,
    exposureScale: 0.3,
    shelteredDirs: ["W", "WSW", "SW", "WNW", "NW", "S", "SSW"],
    // 45198, not CHII2: the Harrison-Dever Crib station (GLERL) went whole-station dark
    // 2026-08-18 with no retirement notice - live wind fell back fine, but history froze.
    // The Chicago Buoy is 7-10 km out, already this harbor's wave source, and validated
    // 1.01x. CHII2 stays a same-shore neighbour (NEIGHBOR_STATIONS) as a backup.
    buoyStation: "45198",
    waveBuoy: { station: "45198", km: 8 },
    marineZone: "LMZ742",
    notes: {
      entrance: "Reached through a narrow channel off the lagoon — one of the most protected harbors in the system.",
      docking: "Tight, no-wake channel; easy docking once you're through.",
      hazards: "Low fixed clearance and a blind bend in the channel — proceed dead slow.",
    },
  },
  {
    id: "dusable",
    waveGrid: "LOT/77,74",
    name: "DuSable Harbor",
    lat: 41.8869, lon: -87.6127,
    entranceBearing: 90,
    exposureScale: 0.45,
    shelteredDirs: ["W", "WSW", "SW", "WNW", "NW"],
    buoyStation: "45198",
    waveBuoy: { station: "45198", km: 4 },
    marineZone: "LMZ742",
    notes: {
      entrance: "Tucked behind the main Chicago Harbor breakwater at the foot of Randolph — well sheltered.",
      docking: "Downtown crosswinds funnel between buildings; watch a north wind on the long faces.",
      hazards: "Heavy tour-boat and ferry traffic just outside the entrance.",
    },
  },
  {
    id: "monroe",
    waveGrid: "LOT/77,73",
    name: "Monroe Harbor",
    lat: 41.8802, lon: -87.6103,
    entranceBearing: 60,
    exposureScale: 0.75,
    exposedDirs: ["NE", "ENE", "E"],
    buoyStation: "45198",
    waveBuoy: { station: "45198", km: 4 },
    marineZone: "LMZ742",
    notes: {
      entrance: "A large open mooring field behind the outer breakwater; more exposed than the slip harbors.",
      docking: "Star-dock moorings with a tender; an easterly crosswind at the gap makes picking up the can tricky.",
      hazards: "The mooring field is crowded — little room to recover from a blown approach.",
    },
  },
  {
    id: "burnham",
    waveGrid: "LOT/77,72",
    name: "Burnham Harbor",
    lat: 41.8607, lon: -87.6094,
    entranceBearing: 180,
    exposureScale: 0.45,
    shelteredDirs: ["N", "NNE", "NE", "ENE", "E", "NW", "WNW"],
    buoyStation: "45198",
    waveBuoy: { station: "45198", km: 5 },
    marineZone: "LMZ742",
    notes: {
      entrance: "Sheltered between Northerly Island and the Museum Campus peninsula; stays workable when the lake is up.",
      docking: "Largest harbor in the system with wide fairways — forgiving for bigger boats.",
      hazards: "A strong southerly can push chop up the long north–south axis.",
    },
  },
  {
    id: "31st",
    waveGrid: "LOT/77,71",
    name: "31st Street Harbor",
    lat: 41.8385, lon: -87.6050,
    entranceBearing: 100,
    exposureScale: 0.6,
    exposedDirs: ["E", "ESE"],
    buoyStation: "45198",
    waveBuoy: { station: "45198", km: 7 },
    marineZone: "LMZ742",
    notes: {
      entrance: "Modern harbor behind a substantial breakwater; the E-facing entrance takes direct easterly seas.",
      docking: "Deep, well-marked basin; floating docks are easy in most conditions.",
      hazards: "Breakwater ends are unlit in spots — give them room after dark.",
    },
  },
  {
    id: "59th",
    waveGrid: "LOT/78,69",
    name: "59th Street Harbor",
    lat: 41.7876, lon: -87.5757,
    entranceBearing: 90,
    exposureScale: 0.55,
    // NOT CMTI2: that gauge sits inside sheltered Calumet Harbor and averaged 0.65x the
    // Chicago Buoy over 24 h (`npm run validate:stations`). Under-reading makes conditions
    // look safer than they are, so use the open-lake buoy the neighbouring harbors use.
    buoyStation: "45198",
    // 45198 already supplies this harbor's wind, so its wave sensor is fetched on every
    // poll and was simply being discarded. Wiring it costs no extra request.
    waveBuoy: { station: "45198", km: 12 },
    marineZone: "LMZ742",
    notes: {
      entrance: "Jackson Park inner harbor; moderate shelter behind the outer works.",
      docking: "Compact basin — plan your turn before you commit.",
      hazards: "Shallow shoulders outside the marked channel; stay between the cans.",
    },
  },
  {
    id: "jackson-inner",
    waveGrid: "LOT/79,69",
    name: "Jackson Park Inner Harbor",
    lat: 41.7822, lon: -87.5720,
    entranceBearing: 70,
    exposureScale: 0.5,
    shelteredDirs: ["S", "SSW", "SW", "WSW", "W"],
    // NOT CMTI2: that gauge sits inside sheltered Calumet Harbor and averaged 0.65x the
    // Chicago Buoy over 24 h (`npm run validate:stations`). Under-reading makes conditions
    // look safer than they are, so use the open-lake buoy the neighbouring harbors use.
    buoyStation: "45198",
    // 45198 already supplies this harbor's wind, so its wave sensor is fetched on every
    // poll and was simply being discarded. Wiring it costs no extra request.
    waveBuoy: { station: "45198", km: 12 },
    marineZone: "LMZ742",
    notes: {
      entrance: "Reached through the outer harbor; the inner basin is well protected.",
      docking: "Quiet, low-traffic basin with easy slips.",
      hazards: "The connecting channel from the outer harbor shoals on the edges.",
    },
  },
  {
    id: "jackson-outer",
    waveGrid: "LOT/79,69",
    name: "Jackson Park Outer Harbor",
    lat: 41.7808, lon: -87.5688,
    entranceBearing: 80,
    exposureScale: 0.85,
    exposedDirs: ["NE", "ENE", "E", "SE"],
    // NOT CMTI2: that gauge sits inside sheltered Calumet Harbor and averaged 0.65x the
    // Chicago Buoy over 24 h (`npm run validate:stations`). Under-reading makes conditions
    // look safer than they are, so use the open-lake buoy the neighbouring harbors use.
    buoyStation: "45198",
    // 45198 already supplies this harbor's wind, so its wave sensor is fetched on every
    // poll and was simply being discarded. Wiring it costs no extra request.
    waveBuoy: { station: "45198", km: 12 },
    marineZone: "LMZ742",
    notes: {
      entrance: "The most exposed of the Jackson Park basins — open to the east and northeast.",
      docking: "Mooring and transient space; expect motion on a lake swell.",
      hazards: "Wave surge works right into the outer basin on an onshore blow.",
    },
  },

  // ── Illinois / Wisconsin (north, same west shore as Chicago) ─────────────────
  // Same western shore, so the base Chicago fetch shape applies (a WEST wind is
  // offshore/calm; NE–E is the onshore wave-maker) — openWaterBearing stays unset.
  // The two southern harbors remain LOT/KLOT (defaults); Kenosha and Winthrop Harbor
  // cross into Wisconsin waters → MKX office + KMKX radar, and Kewaunee further north
  // is GRB + KGRB. Wind comes from the offshore buoys 45186 / 45187, which also supply
  // OBSERVED waves via waveBuoy — except Kewaunee, whose only nearby station is too
  // sheltered to trust (see below), so it takes the gridpoint model. No representative
  // lakefront cam up here, so all hide the panel.
  {
    id: "kewaunee",
    waveGrid: "GRB/98,30",
    name: "Kewaunee Marina",
    lat: 44.4575, lon: -87.4986,
    entranceBearing: 100,
    exposureScale: 0.5,
    exposedDirs: ["NE", "E", "ESE"],
    // Deliberately NO buoyStation. KWNW3 sits ~1 km away and is tempting, but it's a
    // pier-mounted tide-gauge MET sensor in the lee of the breakwater: over 24 h it
    // averaged 5.3 kt against 10.3 kt at the buoy 13 km offshore (ratio 0.51, peaks
    // 9.9 vs 19.4). Half the true wind is the dangerous direction for a go/no-go call,
    // so the gridpoint model — which tracks the offshore buoy closely here — wins.
    windFromGrid: true,
    // No NDBC wave buoy within 57 km; this Spotter is 13 km offshore.
    // tempId is INTERMITTENT (checked 2026-09-02: waves 72 obs/day, temp sporadic with
    // multi-day gaps) but its values are real — its 48 F matched the Milwaukee ATW buoy
    // during a west-shore upwelling while mid-lake read 71 F. Keep it: the staleness
    // guard blanks the gaps, and an intermittent true cold-shock warning beats none.
    waveBuoy: { km: 13, glos: { datasetId: 609, waveId: 4842, periodId: 4849, dirId: 4843, tempId: 4838 } },
    marineZone: "LMZ542",
    discussionOffice: "GRB",
    radarStation: "KGRB",
    webcamUrl: "",
    notes: {
      entrance: "Behind the Kewaunee pierheads at the river mouth; the east-facing gap takes an onshore sea straight off the open lake.",
      docking: "Sheltered slips up inside the river once you're through the breakwater gap.",
      hazards: "River current meets the lake at the pierheads, and a NE blow stacks a steep sea right at the entrance.",
    },
  },
  {
    id: "southport",
    waveGrid: "MKX/94,44",
    name: "Southport Marina (Kenosha)",
    lat: 42.5814, lon: -87.8101,
    entranceBearing: 90,
    exposureScale: 0.5,
    exposedDirs: ["NE", "ENE", "E"],
    // 45187 (Winthrop Harbor), not 45199: it is 1.6 km off North Point and 10 km from
    // Southport, against 45199's 19-27 km. 45199 also reports NO gusts at all (0% over
    // 14 d) and runs a ~38 min irregular cadence that keeps crossing the 3 h staleness
    // guard, dropping both harbors to CNII2 in Chicago, 70-82 km away.
    // Validated 2026-09-04 over 14 d hourly-matched: 45187 reads 1.00x Waukegan (45186)
    // while 45199 reads 1.21x it, so 45199 was the outlier reading HIGH — the swap makes
    // these harbors more accurate, not more optimistic. Already their waveBuoy, so the
    // station is fetched every poll regardless.
    buoyStation: "45187",
    waveBuoy: { station: "45187", km: 10 },
    marineZone: "LMZ646",
    discussionOffice: "MKX",
    radarStation: "KMKX",
    webcamUrl: "",
    notes: {
      entrance: "Behind Kenosha's long breakwater; the harbor mouth opens east, so a NE sea stacks up at the gap.",
      docking: "Protected basin in Kenosha's south harbor — calm and roomy once you're inside the breakwall.",
      hazards: "The outer breakwater gap takes the brunt of an easterly; mind traffic and the pierheads on entry.",
    },
  },
  {
    id: "north-point",
    waveGrid: "MKX/95,40",
    name: "North Point Marina (Winthrop Harbor)",
    lat: 42.4872, lon: -87.7977,
    entranceBearing: 110,
    exposureScale: 0.5,
    exposedDirs: ["E", "ESE", "NE"],
    // 45187 (Winthrop Harbor), not 45199: it is 1.6 km off North Point and 10 km from
    // Southport, against 45199's 19-27 km. 45199 also reports NO gusts at all (0% over
    // 14 d) and runs a ~38 min irregular cadence that keeps crossing the 3 h staleness
    // guard, dropping both harbors to CNII2 in Chicago, 70-82 km away.
    // Validated 2026-09-04 over 14 d hourly-matched: 45187 reads 1.00x Waukegan (45186)
    // while 45199 reads 1.21x it, so 45199 was the outlier reading HIGH — the swap makes
    // these harbors more accurate, not more optimistic. Already their waveBuoy, so the
    // station is fetched every poll regardless.
    buoyStation: "45187",
    waveBuoy: { station: "45187", km: 2 },
    marineZone: "LMZ646",
    discussionOffice: "MKX",
    radarStation: "KMKX",
    webcamUrl: "",
    notes: {
      entrance: "One of the largest marinas on the lake, tucked behind twin breakwaters right at the Illinois–Wisconsin line; the SE-facing entrance is open to an onshore swell.",
      docking: "Huge, well-marked modern basin — forgiving in most conditions once you're through the gap.",
      hazards: "The entrance channel shoals on its edges, and an easterly sea builds right at the breakwater mouth.",
    },
  },
  {
    id: "waukegan",
    waveGrid: "LOT/69,95",
    name: "Waukegan Harbor & Marina",
    lat: 42.3557, lon: -87.8210,
    entranceBearing: 120,
    exposureScale: 0.55,
    exposedDirs: ["NE", "E", "ESE"],
    // 45186, not CHII2: the Waukegan Buoy is 2-3 km away (CHII2 was a 48-53 km Chicago
    // proxy, and went dark 2026-08-18 anyway). Validated 1.00x vs 45187 over 802 matched
    // hours before shipping - proximity alone is never enough. Also reports waves + temp.
    buoyStation: "45186",
    waveBuoy: { station: "45186", km: 3 },
    marineZone: "LMZ740",
    webcamUrl: "",
    notes: {
      entrance: "A deepwater harbor behind a substantial outer breakwater; the marina basin sits well inside, but the approach to the SE-facing gap is open to a NE blow.",
      docking: "Sheltered slips in the inner basin — quiet once past the commercial frontage.",
      hazards: "Commercial and charter traffic share the entrance, and a NE sea reflects off the outer wall near the mouth.",
    },
  },
  {
    id: "great-lakes-marina",
    waveGrid: "LOT/69,92",
    name: "Great Lakes Marina (North Chicago)",
    lat: 42.3053, lon: -87.8249,
    entranceBearing: 100,
    exposureScale: 0.6,
    exposedDirs: ["NE", "ENE", "E"],
    // 45186, not CHII2: the Waukegan Buoy is 2-3 km away (CHII2 was a 48-53 km Chicago
    // proxy, and went dark 2026-08-18 anyway). Validated 1.00x vs 45187 over 802 matched
    // hours before shipping - proximity alone is never enough. Also reports waves + temp.
    buoyStation: "45186",
    waveBuoy: { station: "45186", km: 7 },
    marineZone: "LMZ740",
    webcamUrl: "",
    notes: {
      entrance: "A compact basin on the open North Chicago shore; the east-facing entrance takes onshore seas fairly directly.",
      docking: "Small, tucked marina — easy slips inside, but little room to recover from a blown approach in a breeze.",
      hazards: "Exposed shoreline with only modest breakwater cover; an onshore NE wind makes the gap the hard part of the day.",
    },
  },

  // ── Michigan (east/south) shore ──────────────────────────────────────────────
  // Unlike Chicago's west shore, here a WEST wind is the big onshore wave-maker, so
  // each sets openWaterBearing to rotate the fetch shape, plus its own IWX office +
  // KGRR radar (and, where available, a local webcam).
  {
    id: "st-joseph",
    waveGrid: "IWX/19,82",
    name: "St. Joseph West Basin Marina",
    lat: 42.1146, lon: -86.4834,
    timezone: "America/Detroit",
    entranceBearing: 270,
    exposureScale: 0.5,
    openWaterBearing: 290,
    exposedDirs: ["W", "WNW"],
    buoyStation: "45026",
    // Same station as the wind source; its wave sensor was going unused.
    waveBuoy: { station: "45026", km: 19 },
    marineZone: "LMZ043",
    discussionOffice: "IWX",
    radarStation: "KGRR",
    webcamUrl: "",
    notes: {
      entrance: "Inside the St. Joseph River mouth behind the piers; the west-facing approach takes the brunt of a lake wind.",
      docking: "Sheltered once you're in, but the pierhead gap is exposed to a building westerly.",
      hazards: "Strong current where the river meets the lake, and shoaling off the pier ends.",
    },
  },
  {
    id: "new-buffalo",
    waveGrid: "IWX/11,68",
    name: "New Buffalo Municipal Marina",
    lat: 41.7982, lon: -86.7475,
    timezone: "America/Detroit",
    entranceBearing: 300,
    exposureScale: 0.55,
    openWaterBearing: 330,
    exposedDirs: ["NW", "NNW", "N"],
    // 45170 (Michigan City Buoy), not MCYI3: MCYI3 went dark 2026-08-18 14:30 UTC, twenty
    // minutes before CHII2, in the same GLERL outage — and unlike the five harbors fixed
    // in 0f78c3a this one was missed, so New Buffalo has been taking wind from CNII2 in
    // Chicago, 72 km across the southern basin, steering an exposure model whose exposed
    // dirs are NW/NNW/N. 45170 is 22 km out, already this harbor's waveBuoy, live at 100%
    // on dir/speed/gust, and validated 0.99x against 45026 over 14 d hourly-matched.
    buoyStation: "45170",
    // MCYI3 reports no waves; 45170 (Michigan City Buoy) does, 19 km offshore.
    waveBuoy: { station: "45170", km: 19 },
    marineZone: "LMZ046",
    discussionOffice: "IWX",
    radarStation: "KGRR",
    webcamUrl: "https://www.glerl.noaa.gov/metdata/mcy/mcy01.jpg",
    notes: {
      entrance: "Breakwater-protected basin at the Galien River mouth; the NW-facing entrance is open to the long up-lake fetch.",
      docking: "Roomy modern basin with floating docks; easy once inside.",
      hazards: "Sand builds in the entrance channel — favor the marked deep water, especially after a blow.",
    },
  },
  {
    id: "south-haven",
    waveGrid: "GRR/21,20",
    name: "South Haven Municipal Marina",
    lat: 42.4039, lon: -86.2782,
    timezone: "America/Detroit",
    entranceBearing: 270,
    exposureScale: 0.5,
    openWaterBearing: 290,
    exposedDirs: ["W", "WNW"],
    buoyStation: "45168",
    waveBuoy: { station: "45168", km: 4 },
    marineZone: "LMZ844",
    discussionOffice: "GRR",
    radarStation: "KGRR",
    webcamUrl: "",
    notes: {
      entrance: "Up the Black River behind the piers; the west-facing channel funnels a lake swell straight in.",
      docking: "Protected riverfront slips once you're through the pierhead gap.",
      hazards: "Pierhead current and channel shoaling after a westerly blow — hold to the marked deep water.",
    },
  },
  {
    id: "grand-haven",
    waveGrid: "GRR/19,50",
    name: "Grand Haven Municipal Marina",
    lat: 43.0669, lon: -86.2339,
    timezone: "America/Detroit",
    entranceBearing: 270,
    exposureScale: 0.45,
    openWaterBearing: 285,
    exposedDirs: ["W", "WNW"],
    buoyStation: "45161",
    // 45161 reports no WAVES (WVHT blank on every row), so the Grand Haven Spotter
    // supplies them. It DOES carry a water-temp probe (~98% fill, verified 2026-09-05) —
    // earlier comments here claiming otherwise were wrong. The Spotter still leads for
    // temp because it sits 8 km off this harbor while 45161 is a shared regional buoy.
    // Spotters are seasonal — when it's pulled for winter this falls back to the model.
    waveBuoy: { km: 8, glos: { datasetId: 671, waveId: 9494, periodId: 9501, dirId: 9495, tempId: 9491 } },
    marineZone: "LMZ847",
    discussionOffice: "GRR",
    radarStation: "KGRR",
    webcamUrl: "",
    notes: {
      entrance: "Up the Grand River channel behind the south pier and light; the long west-running channel funnels a lake swell in from the pierheads.",
      docking: "Sheltered municipal slips along the riverfront once you're inside the channel.",
      hazards: "River current meets the lake at the pierheads and the channel shoals on its edges after a westerly — hold mid-channel.",
    },
  },
  {
    id: "muskegon",
    waveGrid: "GRR/16,58",
    name: "Muskegon Hartshorn Municipal Marina",
    lat: 43.2306, lon: -86.2660,
    timezone: "America/Detroit",
    entranceBearing: 270,
    exposureScale: 0.3,
    openWaterBearing: 285,
    exposedDirs: ["W", "WNW"],
    buoyStation: "45161",
    // 45161 reports no waves (it does carry water temp, ~98%); the Muskegon Spotter
    // sits 9 km out, effectively
    // co-located with it, and cross-validates at 0.92x the Grand Haven Spotter.
    waveBuoy: { km: 9, glos: { datasetId: 274, waveId: 5122, periodId: 5128, dirId: 5123, tempId: 5239 } },
    marineZone: "LMZ847",
    discussionOffice: "GRR",
    radarStation: "KGRR",
    webcamUrl: "https://www.glerl.noaa.gov/metdata/mkg/mkg01.jpg",
    notes: {
      entrance: "On inland Muskegon Lake — you cross the lake and run the west channel out to the pierheads, so open-lake swell barely reaches the slips.",
      docking: "Large, well-protected municipal basin on the lake's south shore; easy in most conditions.",
      hazards: "A hard westerly builds a short chop across Muskegon Lake, and the pierhead channel to the big lake runs current — mind it on the way out.",
    },
  },
  {
    id: "whitehall",
    waveGrid: "GRR/12,66",
    name: "Whitehall White Lake Municipal Marina",
    lat: 43.4101, lon: -86.3524,
    timezone: "America/Detroit",
    entranceBearing: 255,
    exposureScale: 0.2,
    openWaterBearing: 285,
    exposedDirs: ["W", "WNW"],
    buoyStation: "45161",
    // As at Grand Haven: 45161 carries no waves (temp yes, ~98%), so the Whitehall
    // Spotter leads for both.
    waveBuoy: { km: 12, glos: { datasetId: 672, waveId: 9520, periodId: 9527, dirId: 9521, tempId: 9517 } },
    marineZone: "LMZ848",
    discussionOffice: "GRR",
    radarStation: "KGRR",
    webcamUrl: "",
    notes: {
      entrance: "Tucked at the east end of White Lake; there's a long inland run and the Montague–Whitehall channel before Lake Michigan, so the marina stays calm when the lake is up.",
      docking: "Quiet municipal slips deep inside White Lake — among the most protected water on this shore.",
      hazards: "Shoaling and current in the narrow White Lake channel to the lake; a hard westerly still raises a chop across the inland lake.",
    },
  },

  // ── Green Bay / Bays de Noc (Michigan UP, west side) ─────────────────────────
  // These sit on Green Bay, not open Lake Michigan. Green Bay has no usable wind
  // buoy, so each takes live wind from its NWS gridpoint model (windFromGrid) and
  // its waves from the gridpoint too; water temp is left blank (no local buoy).
  // Menominee/Cedar River are true west-shore (open water eastward, like the IL/WI
  // harbors — openWaterBearing unset). The Bays de Noc harbors are more enclosed and
  // face other ways, so they set openWaterBearing explicitly (all seed values).
  {
    id: "menominee",
    waveGrid: "GRB/93,61",
    name: "Menominee Marina",
    lat: 45.1072, lon: -87.6029,
    entranceBearing: 90,
    exposureScale: 0.45,
    exposedDirs: ["NE", "ENE", "E"],
    buoyStation: "MNMM4", // Menominee, right at the marina (~1.6 km)
    windFromGrid: true,
    marineZone: "LMZ521",
    discussionOffice: "GRB",
    radarStation: "KGRB",
    webcamUrl: "",
    notes: {
      entrance: "At the Menominee River mouth on the west shore of Green Bay; the breakwater-protected marina opens east into the bay.",
      docking: "Sheltered municipal slips inside the river mouth; easy once past the pierheads.",
      hazards: "A northeast wind builds a chop down the long axis of the bay onto the entrance; watch the river current at the mouth.",
    },
  },
  {
    id: "cedar-river",
    waveGrid: "MQT/160,17",
    name: "Cedar River State Harbor",
    lat: 45.4123, lon: -87.3487,
    entranceBearing: 90,
    exposureScale: 0.45,
    exposedDirs: ["NE", "E", "ESE"],
    windFromGrid: true,
    marineZone: "LMZ221",
    discussionOffice: "MQT",
    radarStation: "KGRB",
    webcamUrl: "",
    notes: {
      entrance: "A small state harbor on the west shore of Green Bay; the east-facing entrance is open to wind across the bay.",
      docking: "Compact protected basin behind the breakwall — quiet once inside.",
      hazards: "Little room in the basin, and an easterly sea sets right onto the entrance; give the breakwater ends room.",
    },
  },
  {
    id: "escanaba",
    waveGrid: "MQT/168,32",
    name: "Escanaba Municipal Marina",
    lat: 45.7428, lon: -87.0448,
    timezone: "America/Detroit", // Delta County keeps Eastern time
    entranceBearing: 120,
    exposureScale: 0.3,
    openWaterBearing: 160,
    exposedDirs: ["S", "SSE", "SE"],
    windFromGrid: true,
    // First observed waves + water temp anywhere in Green Bay: the Little Bay de Noc
    // Spotter is 8.8 km out, almost exactly on this harbor's fetch axis (bearing 161).
    // windId: spectral wind speed, validated 2026-09-02 vs the FPTM4 anemometer (1.24x,
    // conservative) where the model read ~0.6x here. Speed only - direction and gusts
    // stay with the model. KEEP the two ds-695 refs (escanaba/gladstone) IDENTICAL:
    // GLOS fetches dedupe by datasetId, so one ref serves both harbors.
    waveBuoy: { km: 9, glos: { datasetId: 695, waveId: 10320, periodId: 10321, dirId: 10324, tempId: 10325, windId: 10329, label: "Bay de Noc Spotter" } },
    marineZone: "LMZ221",
    discussionOffice: "MQT",
    radarStation: "KMQT",
    webcamUrl: "",
    notes: {
      entrance: "Near the head of Little Bay de Noc; the marina is well up the sheltered bay, so mainly a south fetch down the bay reaches it.",
      docking: "Roomy, well-protected municipal basin — calm in most conditions.",
      hazards: "A strong south wind funnels a chop up Little Bay de Noc onto the entrance; otherwise the bay stays workable.",
    },
  },
  {
    id: "fayette",
    waveGrid: "MQT/178,33",
    name: "Fayette State Harbor",
    lat: 45.7192, lon: -86.6696,
    timezone: "America/Detroit", // Delta County keeps Eastern time
    entranceBearing: 270,
    exposureScale: 0.15,
    openWaterBearing: 250,
    exposedDirs: ["W", "WSW", "SW"],
    // Fairport (~11 km). Currently healthy — ~98% wind fill at a flat 10-min cadence
    // (2026-09-05) — but its file history shows gaps of up to ~20 days, which is why
    // windFromGrid stays set: the model fills the blackouts rather than the harbor going
    // dark. Do not read the windFromGrid flag as "this station is unreliable right now".
    buoyStation: "FPTM4",
    windFromGrid: true,
    marineZone: "LMZ221",
    discussionOffice: "MQT",
    radarStation: "KMQT",
    webcamUrl: "",
    notes: {
      entrance: "Snail Shell Harbor — a small, nearly landlocked limestone cove on the Garden Peninsula, opening west into Big Bay de Noc. Among the most protected water on the lake.",
      docking: "Tiny, calm state-park basin below the historic townsite; tuck in and you're out of almost any weather.",
      hazards: "Only a hard west/southwest wind reaches through the narrow mouth; watch depth and the rocky shoreline on the approach.",
    },
  },
  {
    id: "gladstone",
    waveGrid: "MQT/167,35",
    name: "Gladstone Marina",
    lat: 45.8396, lon: -87.0196,
    timezone: "America/Detroit", // Delta County keeps Eastern time
    entranceBearing: 160,
    exposureScale: 0.25,
    openWaterBearing: 180,
    exposedDirs: ["S", "SSW", "SSE"],
    windFromGrid: true,
    // Shares Escanaba's Little Bay de Noc Spotter, 19 km down the bay on bearing 178.
    // windId: spectral wind speed, validated 2026-09-02 vs the FPTM4 anemometer (1.24x,
    // conservative) where the model read ~0.6x here. Speed only - direction and gusts
    // stay with the model. KEEP the two ds-695 refs (escanaba/gladstone) IDENTICAL:
    // GLOS fetches dedupe by datasetId, so one ref serves both harbors.
    waveBuoy: { km: 19, glos: { datasetId: 695, waveId: 10320, periodId: 10321, dirId: 10324, tempId: 10325, windId: 10329, label: "Bay de Noc Spotter" } },
    marineZone: "LMZ221",
    discussionOffice: "MQT",
    radarStation: "KMQT",
    webcamUrl: "",
    notes: {
      entrance: "At the very head of Little Bay de Noc; a long protected run up the bay shelters the marina from open water.",
      docking: "Quiet municipal basin tucked at the north end of the bay — among the calmest slips in the region.",
      hazards: "Only a sustained south wind blowing up the length of the bay raises much chop here; mind shoaling near the head.",
    },
  },
  {
    id: "sister-bay",
    waveGrid: "GRB/106,65",
    name: "Sister Bay Marina",
    lat: 45.1906, lon: -87.1276,
    entranceBearing: 270,
    exposureScale: 0.35,
    // 315, not the 260 first estimated from the chart: ray-casting marine-vs-land zones
    // outward on 16 bearings puts the longest contiguous fetch to the NW, up Green Bay.
    openWaterBearing: 315,
    exposedDirs: ["W", "WSW", "NW"],
    windFromGrid: true,
    marineZone: "LMZ521",
    discussionOffice: "GRB",
    radarStation: "KGRB",
    webcamUrl: "",
    notes: {
      entrance: "On the Door Peninsula's bay side, at the head of a west-facing bay — a westerly blows straight up it, while the peninsula shelters everything from the east.",
      docking: "Compact village marina tucked at the head of the bay; calm in most conditions once you're inside.",
      hazards: "A hard west or southwest wind puts chop right onto the exposed municipal dock; watch depth toward the shallow head of the bay.",
    },
  },
];

export function getHarbor(id: string): Harbor | undefined {
  return HARBORS.find((h) => h.id === id);
}

// ── Regions ──────────────────────────────────────────────────────────────────
// A coarse geographic grouping for the board's region filter, north/south →
// west/east. Keep REGION_MEMBERS in sync with HARBORS when adding a harbor;
// lib/harbors.test.ts asserts every harbor maps to exactly one region.
export type RegionId = "chicago" | "north-shore" | "michigan-east" | "green-bay";

export const REGIONS: { id: RegionId; label: string }[] = [
  { id: "chicago", label: "Chicago" },
  { id: "north-shore", label: "North Shore" },
  { id: "michigan-east", label: "Michigan" },
  { id: "green-bay", label: "Green Bay" },
];

const REGION_MEMBERS: Record<RegionId, string[]> = {
  chicago: ["montrose", "belmont", "diversey", "dusable", "monroe", "burnham", "31st", "59th", "jackson-inner", "jackson-outer"],
  "north-shore": ["great-lakes-marina", "waukegan", "north-point", "southport", "kewaunee"],
  "michigan-east": ["new-buffalo", "st-joseph", "south-haven", "grand-haven", "muskegon", "whitehall"],
  "green-bay": ["menominee", "cedar-river", "escanaba", "fayette", "gladstone", "sister-bay"],
};

const REGION_OF: Record<string, RegionId> = Object.fromEntries(
  (Object.entries(REGION_MEMBERS) as [RegionId, string[]][]).flatMap(([r, ids]) => ids.map((id) => [id, r] as const)),
);

/** The region a harbor belongs to (undefined if it hasn't been assigned one). */
export function regionOf(id: string): RegionId | undefined {
  return REGION_OF[id];
}

/** The shore each region's harbors sit on. Green Bay has none: every harbor there is
 *  windFromGrid, and its two stations serve only their own harbors. */
const SHORE_OF_REGION: Partial<Record<RegionId, Shore>> = {
  chicago: "west",
  "north-shore": "west",
  "michigan-east": "east",
};

const kmBetween = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const R = 6371, p = Math.PI / 180;
  return 2 * R * Math.asin(Math.sqrt(
    Math.sin(((bLat - aLat) * p) / 2) ** 2 +
    Math.cos(aLat * p) * Math.cos(bLat * p) * Math.sin(((bLon - aLon) * p) / 2) ** 2));
};

/**
 * The stations this harbor may borrow wind (and waves / water temp) from, nearest first:
 * same shore, within that shore's MAX_NEIGHBOR_KM, never its own station. After these,
 * the harbor falls back to its gridpoint model — never to the far side of the lake.
 *
 * windFromGrid harbors borrow nothing: the flag means "when my own sources are quiet, use
 * my model", which is exactly where a harbor with no trustworthy neighbour belongs.
 */
export function windNeighbors(h: Harbor): string[] {
  if (h.windFromGrid) return [];
  const shore = SHORE_OF_REGION[regionOf(h.id) as RegionId];
  if (!shore) return [];
  const own = h.buoyStation?.toUpperCase();
  return NEIGHBOR_STATIONS
    .filter((s) => s.shore === shore && s.id !== own)
    .map((s) => ({ id: s.id, km: kmBetween(h.lat, h.lon, s.lat, s.lon) }))
    .filter((s) => s.km <= MAX_NEIGHBOR_KM[shore])
    .sort((a, b) => a.km - b.km)
    .map((s) => s.id);
}
