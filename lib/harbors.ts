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
  /** Nearest NDBC station for localized wind/temp. Optional: buoy-less harbors
   *  (windFromGrid) omit it and take live wind from their gridpoint model instead. */
  buoyStation?: string;
  /** Take live wind (dir/speed/gust) from this harbor's own NWS gridpoint model
   *  rather than a buoy — for regions with no usable wind buoy (e.g. Green Bay).
   *  Waves still come from the gridpoint; water temp is left blank (no local obs). */
  windFromGrid?: boolean;
  /** Optional dedicated wave buoy sitting right off the harbor. When set, its
   *  OBSERVED wave height is blended with the gridpoint model for current conditions,
   *  weighted by `km` (the buoy's distance from the harbor — closer ⇒ more weight, see
   *  waveObsWeight). Use when a buoy is nearer than buoyStation for waves; it's often a
   *  wave-only buoy (e.g. 45186/45187) but may be the same station as buoyStation. The
   *  NWS gridpoint still drives the wave forecast series. */
  waveBuoy?: { station: string; km: number };
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
    buoyStation: "CHII2",
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
    buoyStation: "CHII2",
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
    buoyStation: "CHII2",
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
    waveGrid: "LOT/79,69",
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
    waveGrid: "LOT/79,69",
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

  // ── Illinois / Wisconsin (north, same west shore as Chicago) ─────────────────
  // Same western shore, so the base Chicago fetch shape applies (a WEST wind is
  // offshore/calm; NE–E is the onshore wave-maker) — openWaterBearing stays unset.
  // The two southern harbors remain LOT/KLOT (defaults); Kenosha and Winthrop Harbor
  // cross into Wisconsin waters → MKX office + KMKX radar, and Kewaunee further north
  // is GRB + KGRB. Wind comes from CHII2 (south) or the nearest wind buoy 45199
  // (north) — except Kewaunee, which has no usable wind buoy and takes the gridpoint
  // model. The wave-only buoys that sit right offshore (45186/45187) supply OBSERVED
  // waves via waveBuoy. No representative lakefront cam up here, so all hide the panel.
  {
    id: "kewaunee",
    waveGrid: "GRB/98,30",
    name: "Kewaunee Marina",
    lat: 44.4575, lon: -87.4986,
    entranceBearing: 100,
    exposureScale: 0.5,
    exposedDirs: ["NE", "E", "ESE"],
    windFromGrid: true,
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
    buoyStation: "45199",
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
    buoyStation: "45199",
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
    buoyStation: "CHII2",
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
    buoyStation: "CHII2",
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
    buoyStation: "MCYI3",
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
    openWaterBearing: 260,
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
