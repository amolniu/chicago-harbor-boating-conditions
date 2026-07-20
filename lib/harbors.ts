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
  /** Nearest NDBC station for localized data (wind/temp). */
  buoyStation: string;
  /** NWS nearshore marine zone for forecasts + advisories. */
  marineZone: string;
  notes: {
    entrance: string;
    docking: string;
    hazards: string;
  };
}

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

/**
 * How much open-lake wave energy reaches this harbor's entrance for a given
 * wind direction. ~0 = sheltered, 1 = fully exposed. Combines lake fetch with
 * the harbor's breakwater geometry.
 */
export function exposureForWind(harbor: Harbor, windDir: number): number {
  let e = interpFetch(windDir) * harbor.exposureScale;
  const c = degToCompass(windDir);
  if (harbor.shelteredDirs?.includes(c)) e *= 0.4;
  if (harbor.exposedDirs?.includes(c)) e *= 1.4;
  return Math.max(0, Math.min(1.3, e));
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
    name: "Montrose Harbor",
    lat: 41.9636, lon: -87.6375,
    entranceBearing: 150,
    exposureScale: 0.7,
    exposedDirs: ["SE", "SSE"],
    buoyStation: "CHII2",
    marineZone: "LMZ742",
    notes: {
      entrance: "Wide SE-facing mouth behind the curving breakwater; open to south/southeast swell.",
      docking: "Roomy fairways, but a south wind sets you onto the outer slips.",
      hazards: "Shoaling reported along the inside of the breakwater — favor mid-channel on entry.",
    },
  },
  {
    id: "belmont",
    name: "Belmont Harbor",
    lat: 41.9401, lon: -87.6360,
    entranceBearing: 60,
    exposureScale: 0.9,
    exposedDirs: ["NE", "ENE", "N"],
    buoyStation: "CHII2",
    marineZone: "LMZ742",
    notes: {
      entrance: "The breakwall gap opens to the northeast. Strong NE winds stack steep waves right at the mouth, making the exit the hardest part of the day.",
      docking: "Once inside it's calm, but the approach to the gap is exposed on a NE blow.",
      hazards: "Waves reflect off the north breakwall and confuse the sea state near the entrance.",
    },
  },
  {
    id: "diversey",
    name: "Diversey Harbor",
    lat: 41.9322, lon: -87.6366,
    entranceBearing: 90,
    exposureScale: 0.3,
    shelteredDirs: ["W", "WSW", "SW", "WNW", "NW", "S", "SSW"],
    buoyStation: "CHII2",
    marineZone: "LMZ742",
    notes: {
      entrance: "Reached through a narrow channel off the lagoon — one of the most protected harbors in the system.",
      docking: "Tight, no-wake channel; easy docking once you're through.",
      hazards: "Low fixed clearance and a blind bend in the channel — proceed dead slow.",
    },
  },
  {
    id: "dusable",
    name: "DuSable Harbor",
    lat: 41.8869, lon: -87.6127,
    entranceBearing: 90,
    exposureScale: 0.45,
    shelteredDirs: ["W", "WSW", "SW", "WNW", "NW"],
    buoyStation: "45198",
    marineZone: "LMZ742",
    notes: {
      entrance: "Tucked behind the main Chicago Harbor breakwater at the foot of Randolph — well sheltered.",
      docking: "Downtown crosswinds funnel between buildings; watch a north wind on the long faces.",
      hazards: "Heavy tour-boat and ferry traffic just outside the entrance.",
    },
  },
  {
    id: "monroe",
    name: "Monroe Harbor",
    lat: 41.8802, lon: -87.6103,
    entranceBearing: 60,
    exposureScale: 0.75,
    exposedDirs: ["NE", "ENE", "E"],
    buoyStation: "45198",
    marineZone: "LMZ742",
    notes: {
      entrance: "A large open mooring field behind the outer breakwater; more exposed than the slip harbors.",
      docking: "Star-dock moorings with a tender; an easterly crosswind at the gap makes picking up the can tricky.",
      hazards: "The mooring field is crowded — little room to recover from a blown approach.",
    },
  },
  {
    id: "burnham",
    name: "Burnham Harbor",
    lat: 41.8607, lon: -87.6094,
    entranceBearing: 180,
    exposureScale: 0.45,
    shelteredDirs: ["N", "NNE", "NE", "ENE", "E", "NW", "WNW"],
    buoyStation: "45198",
    marineZone: "LMZ742",
    notes: {
      entrance: "Sheltered between Northerly Island and the Museum Campus peninsula; stays workable when the lake is up.",
      docking: "Largest harbor in the system with wide fairways — forgiving for bigger boats.",
      hazards: "A strong southerly can push chop up the long north–south axis.",
    },
  },
  {
    id: "31st",
    name: "31st Street Harbor",
    lat: 41.8385, lon: -87.6050,
    entranceBearing: 100,
    exposureScale: 0.6,
    exposedDirs: ["E", "ESE"],
    buoyStation: "45198",
    marineZone: "LMZ742",
    notes: {
      entrance: "Modern harbor behind a substantial breakwater; the E-facing entrance takes direct easterly seas.",
      docking: "Deep, well-marked basin; floating docks are easy in most conditions.",
      hazards: "Breakwater ends are unlit in spots — give them room after dark.",
    },
  },
  {
    id: "59th",
    name: "59th Street Harbor",
    lat: 41.7876, lon: -87.5757,
    entranceBearing: 90,
    exposureScale: 0.55,
    buoyStation: "CMTI2",
    marineZone: "LMZ742",
    notes: {
      entrance: "Jackson Park inner harbor; moderate shelter behind the outer works.",
      docking: "Compact basin — plan your turn before you commit.",
      hazards: "Shallow shoulders outside the marked channel; stay between the cans.",
    },
  },
  {
    id: "jackson-inner",
    name: "Jackson Park Inner Harbor",
    lat: 41.7822, lon: -87.5720,
    entranceBearing: 70,
    exposureScale: 0.5,
    shelteredDirs: ["S", "SSW", "SW", "WSW", "W"],
    buoyStation: "CMTI2",
    marineZone: "LMZ742",
    notes: {
      entrance: "Reached through the outer harbor; the inner basin is well protected.",
      docking: "Quiet, low-traffic basin with easy slips.",
      hazards: "The connecting channel from the outer harbor shoals on the edges.",
    },
  },
  {
    id: "jackson-outer",
    name: "Jackson Park Outer Harbor",
    lat: 41.7808, lon: -87.5688,
    entranceBearing: 80,
    exposureScale: 0.85,
    exposedDirs: ["NE", "ENE", "E", "SE"],
    buoyStation: "CMTI2",
    marineZone: "LMZ742",
    notes: {
      entrance: "The most exposed of the Jackson Park basins — open to the east and northeast.",
      docking: "Mooring and transient space; expect motion on a lake swell.",
      hazards: "Wave surge works right into the outer basin on an onshore blow.",
    },
  },
];

export function getHarbor(id: string): Harbor | undefined {
  return HARBORS.find((h) => h.id === id);
}
