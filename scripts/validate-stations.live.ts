// Station validator — run with `npm run validate:stations` (network, opt-in).
//
// Proximity is not accuracy. A sheltered station reads LOW, which makes conditions look
// safer than they are — the dangerous direction for a go/no-go call. Kewaunee's KWNW3
// sits 0.9 km from the marina and reported HALF the true wind for a day before this was
// caught by hand; this script does that check for every harbor, automatically.
//
// For each harbor it compares the multi-day mean wind of the configured source (its NDBC
// station, or the NWS gridpoint model where windFromGrid applies) against the nearest
// live GLOS *moored buoy* — deliberately never a "tower", since GLOS's shore towers sit
// a few km from the Chicago harbors and read ~12 kt low.
//
// It reports a table and fails only on a clear, well-sampled discrepancy, so it can be
// run periodically without becoming noise.
//
// ⚠️ READ THE REFERENCE BEFORE BELIEVING A FAILURE. Sofar Spotters carry no anemometer —
// their wind is inferred from the wave spectrum and reads 1.1–1.9× a real anemometer
// (triangulated 2026-09-02 over 14 d: 1.9× below 8 kt, ~1.1× above 15 kt). So an
// anemometer compared against a Spotter reference lands around 0.5–0.9 while being
// perfectly healthy. Treat a sub-0.7 ratio against a SPOT-* reference as "look closer",
// not as proof; confirm against a second NDBC anemometer before re-pointing a harbor.
// Comparisons against a mirrored NDBC buoy are the trustworthy ones.

import { describe, it } from "vitest";
import { HARBORS, type Harbor } from "@/lib/harbors";
import { assessDrift, DRIFT_MARK, RATIO_LOW } from "@/lib/stationHealth";

const UA = process.env.NWS_USER_AGENT || "ChicagoHarborSailing/0.1 (station validator)";
const MS_TO_KT = 1.94384;
const KMH_TO_KT = 0.539957;

/**
 * Comparison window. Ten days, NOT 24 hours.
 *
 * A single day is far too short: on a day with a lake breeze or a frontal passage the
 * spatial wind gradient alone swings the ratio across the fail threshold for perfectly
 * healthy stations. Measured 2026-09-13, same pairs at widening windows:
 *
 *   45187 vs 45186   1 d 0.80  |  3 d 0.99  |  7 d 0.94  |  14 d 0.96
 *   45187 vs 45199     —       |  3 d 0.70  |  7 d 0.78  |  14 d 0.81
 *
 * The one-day column is the outlier in both; everything settles by ~7 days. On the 24 h
 * window this script FAILED Southport at 0.57 while passing North Point at 0.79 — the
 * same station, 45187, judged differently only by which reference happened to be nearest.
 * Costs nothing extra: realtime2 already carries ~45 days in the file we fetch anyway.
 */
const WINDOW_DAYS = 10;
const WINDOW_MS = WINDOW_DAYS * 24 * 3600_000;

// The drift RULE — thresholds, the LOW/HIGH asymmetry, and the Spotter caveat — lives in
// lib/stationHealth.ts assessDrift(), where it is unit-tested. This script supplies the
// live data and prints the table. It deliberately does NOT re-derive the decision: this
// file used to carry its own copies of RATIO_LOW/RATIO_HIGH/MIN_SAMPLES with the same
// values, which meant whichever copy someone tuned, the other silently disagreed.
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

/** Recent wind speed (kt) from an NDBC station, over WINDOW_DAYS. */
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
  const cutoff = Date.now() - WINDOW_MS;
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

/** Gridpoint model wind (kt) for a harbor's cell. NOTE: the gridpoint endpoint keeps
 *  little past data, so MODEL harbors get far fewer samples than buoy ones however wide
 *  the window — expect [few samples] on those rows. */
async function modelWind(grid: string): Promise<number[]> {
  const gp = await getJson<{ properties: Record<string, { values?: { validTime: string; value: number | null }[] }> }>(
    `https://api.weather.gov/gridpoints/${grid}`, true);
  const vals = gp?.properties?.windSpeed?.values ?? [];
  const now = Date.now();
  return vals
    .filter((v) => {
      const t = new Date(v.validTime.split("/")[0]).getTime();
      return t <= now && t >= now - WINDOW_MS && v.value != null;
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

/** Wind speed (kt) from a GLOS platform over WINDOW_DAYS. Identifies the wind series by matching
 *  the id against /parameters, cached per platform. */
async function glosWind(id: number, paramIndex: Map<number, string>): Promise<number[]> {
  if (windParamCache.has(id)) return windParamCache.get(id)!;
  const start = new Date(Date.now() - WINDOW_MS).toISOString().slice(0, 10);
  const data = await getJson<{ parameters?: { parameter_id: number; observations?: { timestamp: string; value: number | null }[] }[] }[]>(
    `https://seagull-api.glos.org/api/v1/obs?obsDatasetId=${id}&startDate=${start}`);
  const cutoff = Date.now() - WINDOW_MS;
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
    const suspects: string[] = [];

    for (const h of HARBORS as Harbor[]) {
      const label = h.buoyStation ?? "MODEL";
      const ours = h.buoyStation ? await ndbcWind(h.buoyStation) : await modelWind(h.waveGrid);

      // Nearest live GLOS buoy, trying outward until one has data — but never the
      // station being validated. GLOS MIRRORS NDBC buoys under the same
      // org_platform_id (45026, 45170, 45186, 45187 all appear in its catalog), so
      // without this guard the "independent reference" is the same physical buoy and
      // every mirrored station passes at ~1.00 no matter how badly it reads. That is
      // a silent false PASS in the one tool meant to catch a mis-sited station.
      let ref: { p: GlosPlatform; v: number[]; d: number } | null = null;
      const self = new Set([h.buoyStation?.toUpperCase(), h.waveBuoy?.station?.toUpperCase()].filter(Boolean));
      const candidates = buoys
        .filter((p) => !self.has((p.pid || "").toUpperCase()))
        .map((p) => ({ p, d: km(h.lat, h.lon, p.lat, p.lon) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 6);
      for (const p of candidates) {
        if (p.d > 60) break;
        const v = await glosWind(p.p.id, paramIndex);
        if (v.length) { ref = { p: p.p, v, d: p.d }; break; }
      }

      if (!ours.length || !ref) {
        rows.push(`  ${h.id.padEnd(20)} ${label.padEnd(12)} — no comparison available`);
        continue;
      }
      // The DECISION lives in lib/stationHealth.ts assessDrift() — thresholds, the
      // asymmetry, and the Spotter caveat — so it is unit-tested. This script supplies
      // live data and prints the table; it must not re-derive the rule, because a second
      // copy is one that silently disagrees the moment somebody tunes the other.
      const d = assessDrift(h.id, ours, ref.p.pid || ref.p.name, ref.d, ref.v);
      const note =
        d.status === "insufficient" ? "  [few samples]"
        : d.status === "over" ? "  (reads high — conservative)"
        : d.status === "suspect" ? "  (vs a SPOTTER, which reads 1.1-1.9x high — confirm against an anemometer before acting)"
        : "";
      rows.push(
        `  ${DRIFT_MARK[d.status] + h.id.padEnd(18)} ${label.padEnd(12)} ${d.meanKt.toFixed(1).padStart(5)} kt   vs ` +
        `${d.referenceMeanKt.toFixed(1).padStart(5)} kt  ${d.reference} (${d.referenceKm.toFixed(0)} km)  ` +
        `ratio ${d.ratio.toFixed(2)}${note}`);
      if (d.status === "under") problems.push(`${h.id}: ${label} ${d.finding}`);
      if (d.status === "suspect") suspects.push(`${h.id}: ${label} ${d.finding}`);
    }

    console.log(`\n24 h mean wind: configured source vs nearest live GLOS moored buoy\n${rows.join("\n")}\n`);

    // A suspect must not pass in silence. KWNW3 — the 0.51x mis-siting this script exists
    // to catch — was itself measured against a Spotter, and was confirmed only once the
    // MODEL wind at the same spot read 1.10x that same Spotter. So these print loudly on
    // an otherwise-passing run rather than failing forever: a permanent failure with no
    // action that clears it is one people learn to scroll past.
    if (suspects.length) {
      console.log(
        `?? ${suspects.length} station(s) read low against a SPOTTER reference — not a failure, ` +
        `but not a clean bill of health either:\n  ${suspects.join("\n  ")}\n\n` +
        `   A Spotter reads 1.1-1.9x a real anemometer, so a healthy station lands at 0.5-0.9 ` +
        `against one; that range cannot separate a healthy station from a bad one. Confirm ` +
        `against a second source before acting — and before dismissing.\n`);
    }

    if (problems.length) {
      throw new Error(
        `${problems.length} station(s) reading below ${RATIO_LOW}× a nearby buoy:\n  ` +
        problems.join("\n  ") +
        `\n\nA sheltered station under-reads, which makes conditions look safer than they are. ` +
        `Prefer an offshore buoy, or drop buoyStation and use windFromGrid. See docs/ADDING_HARBORS.md.`);
    }
  });
});
