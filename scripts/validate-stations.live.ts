// Station validator — run with `npm run validate:stations` (network, opt-in).
//
// Proximity is not accuracy. A sheltered station reads LOW, which makes conditions look
// safer than they are — the dangerous direction for a go/no-go call. Kewaunee's KWNW3
// sits 0.9 km from the marina and reported HALF the true wind for a day before this was
// caught by hand; this script does that check for every harbor, automatically.
//
// For each harbor it compares the 24 h mean wind of the configured source (its NDBC
// station, or the NWS gridpoint model where windFromGrid applies) against the nearest
// live GLOS *moored buoy* — deliberately never a "tower", since GLOS's shore towers sit
// a few km from the Chicago harbors and read ~12 kt low.
//
// It reports a table and fails only on a clear, well-sampled discrepancy, so it can be
// run periodically without becoming noise.

import { describe, it } from "vitest";
import { HARBORS, type Harbor } from "@/lib/harbors";

const UA = process.env.NWS_USER_AGENT || "ChicagoHarborSailing/0.1 (station validator)";
const MS_TO_KT = 1.94384;
const KMH_TO_KT = 0.539957;
const DAY_MS = 24 * 3600_000;

// Asymmetric on purpose. A source that reads LOW makes conditions look safer than they
// are — that's the failure mode worth breaking the build over. Reading HIGH is merely
// conservative, and is expected whenever the reference buoy sits further offshore with
// more fetch, so it's reported but not treated as a fault.
const RATIO_LOW = 0.7;
const RATIO_HIGH = 1.6;
/** Below this many samples on either side, report but never fail. */
const MIN_SAMPLES = 12;

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const km = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const R = 6371, p = Math.PI / 180;
  return 2 * R * Math.asin(Math.sqrt(
    Math.sin(((bLat - aLat) * p) / 2) ** 2 +
    Math.cos(aLat * p) * Math.cos(bLat * p) * Math.sin(((bLon - aLon) * p) / 2) ** 2));
};

async function getJson<T>(url: string, geo = false): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: geo ? { "User-Agent": UA, Accept: "application/geo+json" } : { "User-Agent": UA },
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** 24 h of wind speed (kt) from an NDBC station. */
async function ndbcWind(station: string): Promise<number[]> {
  let text: string;
  try {
    const res = await fetch(`https://www.ndbc.noaa.gov/data/realtime2/${station.toUpperCase()}.txt`, {
      headers: { "User-Agent": UA },
    });
    if (!res.ok) return [];
    text = await res.text();
  } catch {
    return [];
  }
  const cutoff = Date.now() - DAY_MS;
  const out: number[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const f = line.trim().split(/\s+/);
    if (f.length < 15 || f[6] === "MM") continue;
    const t = Date.UTC(+f[0], +f[1] - 1, +f[2], +f[3], +f[4]);
    if (t >= cutoff) out.push(parseFloat(f[6]) * MS_TO_KT);
  }
  return out;
}

/** 24 h of gridpoint model wind (kt) for a harbor's cell. */
async function modelWind(grid: string): Promise<number[]> {
  const gp = await getJson<{ properties: Record<string, { values?: { validTime: string; value: number | null }[] }> }>(
    `https://api.weather.gov/gridpoints/${grid}`, true);
  const vals = gp?.properties?.windSpeed?.values ?? [];
  const now = Date.now();
  return vals
    .filter((v) => {
      const t = new Date(v.validTime.split("/")[0]).getTime();
      return t <= now && t >= now - DAY_MS && v.value != null;
    })
    .map((v) => (v.value as number) * KMH_TO_KT);
}

interface GlosPlatform { id: number; pid: string; name: string; lat: number; lon: number }

/** GLOS moored buoys that report wind. Towers/piers are excluded on purpose. */
async function glosBuoys(): Promise<GlosPlatform[]> {
  const cat = await getJson<{ features: { geometry: { coordinates: number[] }; properties: Record<string, unknown> }[] }>(
    "https://seagull-api.glos.org/api/v1/obs-datasets.geojson");
  const out: GlosPlatform[] = [];
  for (const f of cat?.features ?? []) {
    const p = f.properties as { platform_type?: string; obs_dataset_id?: number; org_platform_id?: string; platform_name?: string; parameters?: { standard_name?: string }[] };
    if (p.platform_type !== "moored_buoy") continue;
    if (!(p.parameters ?? []).some((x) => x.standard_name === "wind_speed")) continue;
    const [lon, lat] = f.geometry.coordinates;
    out.push({ id: p.obs_dataset_id!, pid: p.org_platform_id ?? "", name: p.platform_name ?? "", lat, lon });
  }
  return out;
}

const windParamCache = new Map<number, number[]>();

/** 24 h of wind speed (kt) from a GLOS platform. Identifies the wind series by matching
 *  the id against /parameters, cached per platform. */
async function glosWind(id: number, paramIndex: Map<number, string>): Promise<number[]> {
  if (windParamCache.has(id)) return windParamCache.get(id)!;
  const start = new Date(Date.now() - DAY_MS).toISOString().slice(0, 10);
  const data = await getJson<{ parameters?: { parameter_id: number; observations?: { timestamp: string; value: number | null }[] }[] }[]>(
    `https://seagull-api.glos.org/api/v1/obs?obsDatasetId=${id}&startDate=${start}`);
  const cutoff = Date.now() - DAY_MS;
  const out: number[] = [];
  for (const ds of data ?? []) {
    for (const p of ds.parameters ?? []) {
      if (paramIndex.get(p.parameter_id) !== "wind_speed") continue;
      for (const o of p.observations ?? []) {
        if (o.value != null && new Date(o.timestamp).getTime() >= cutoff) out.push(o.value * MS_TO_KT);
      }
    }
  }
  windParamCache.set(id, out);
  return out;
}

describe("station validation (live)", () => {
  it("every harbor's wind source agrees with a nearby moored buoy", async () => {
    const [buoys, params] = await Promise.all([
      glosBuoys(),
      getJson<{ parameter_id: number; standard_name: string }[]>("https://seagull-api.glos.org/api/v1/parameters"),
    ]);
    const paramIndex = new Map((params ?? []).map((p) => [p.parameter_id, p.standard_name]));

    const rows: string[] = [];
    const problems: string[] = [];

    for (const h of HARBORS as Harbor[]) {
      const label = h.buoyStation ?? "MODEL";
      const ours = h.buoyStation ? await ndbcWind(h.buoyStation) : await modelWind(h.waveGrid);

      // nearest live GLOS buoy, trying outward until one has data
      let ref: { p: GlosPlatform; v: number[]; d: number } | null = null;
      for (const p of buoys.map((p) => ({ p, d: km(h.lat, h.lon, p.lat, p.lon) })).sort((a, b) => a.d - b.d).slice(0, 6)) {
        if (p.d > 60) break;
        const v = await glosWind(p.p.id, paramIndex);
        if (v.length) { ref = { p: p.p, v, d: p.d }; break; }
      }

      if (!ours.length || !ref) {
        rows.push(`  ${h.id.padEnd(20)} ${label.padEnd(12)} — no comparison available`);
        continue;
      }
      const a = mean(ours), b = mean(ref.v), ratio = a / b;
      const enough = ours.length >= MIN_SAMPLES && ref.v.length >= MIN_SAMPLES;
      const under = enough && ratio < RATIO_LOW; // unsafe — fails
      const over = enough && ratio > RATIO_HIGH; // conservative — noted only
      const mark = under ? "!!" : over ? " ~" : "  ";
      rows.push(
        `  ${mark + h.id.padEnd(18)} ${label.padEnd(12)} ${a.toFixed(1).padStart(5)} kt   vs ${b.toFixed(1).padStart(5)} kt  ` +
        `${ref.p.pid || ref.p.name} (${ref.d.toFixed(0)} km)  ratio ${ratio.toFixed(2)}` +
        `${enough ? "" : "  [few samples]"}${over ? "  (reads high — conservative)" : ""}`);
      if (under) problems.push(`${h.id}: ${label} reads ${a.toFixed(1)} kt vs ${b.toFixed(1)} kt at ${ref.p.pid} (${ref.d.toFixed(0)} km) — ratio ${ratio.toFixed(2)}`);
    }

    console.log(`\n24 h mean wind: configured source vs nearest live GLOS moored buoy\n${rows.join("\n")}\n`);
    if (problems.length) {
      throw new Error(
        `${problems.length} station(s) reading below ${RATIO_LOW}× a nearby buoy:\n  ` +
        problems.join("\n  ") +
        `\n\nA sheltered station under-reads, which makes conditions look safer than they are. ` +
        `Prefer an offshore buoy, or drop buoyStation and use windFromGrid. See docs/ADDING_HARBORS.md.`);
    }
  });
});
