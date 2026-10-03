// Station validator — run with `npm run validate:stations` (network, opt-in).
//
// Proximity is not accuracy. A sheltered station reads LOW, which makes conditions look
// safer than they are — the dangerous direction for a go/no-go call. Kewaunee's KWNW3
// sits 0.9 km from the marina and reported HALF the true wind for a day before this was
// caught by hand; this script does that check for every harbor, automatically.
//
// For each harbor it compares the multi-day mean wind of the source the app ACTUALLY rates
// from — windSourceOf(): its NDBC station, a validated Spotter, or the NWS gridpoint model —
// against the nearest independent reference: a live GLOS *moored buoy* (deliberately never
// a "tower", since GLOS's shore towers sit a few km from the Chicago harbors and read ~12 kt
// low), or, when the source is itself a Spotter, the nearest NDBC anemometer. Which
// platforms count as independent is decided, and unit-tested, by isEligibleReference().
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
import {
  assessDrift,
  DRIFT_MARK,
  RATIO_LOW,
  MIN_DRIFT_SAMPLES,
  MIN_DRIFT_SPAN_H,
  windSourceOf,
  isEligibleReference,
  type ReferencePlatform,
} from "@/lib/stationHealth";
import { MAX_OBS_AGE_MS } from "@/lib/glos";

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

/** One wind-speed reading. Timestamps are kept so two series can be compared over the
 *  span they share — see overlap(). Observations are instants; a gridpoint MODEL value
 *  covers an interval (validTime "…/PT3H"), which ends at `until`. */
interface Sample { t: number; kt: number; until?: number }

const ndbcCache = new Map<string, Promise<Sample[]>>();

/** Recent wind speed from an NDBC station, over WINDOW_DAYS. Cached per run, since one
 *  file serves many rows (45198 alone backs eight harbors, FPTM4 three) — but a FAILED
 *  fetch is never cached: one network blip must not blank every row sharing the station. */
function ndbcWind(station: string): Promise<Sample[]> {
  const key = station.toUpperCase();
  let p = ndbcCache.get(key);
  if (!p) {
    p = fetchNdbcWind(key).then((v) => {
      if (v === null) ndbcCache.delete(key);
      return v ?? [];
    });
    ndbcCache.set(key, p);
  }
  return p;
}

/** null = the fetch failed (retry-worthy); [] = the station genuinely has no wind. */
async function fetchNdbcWind(station: string): Promise<Sample[] | null> {
  let text: string;
  try {
    const res = await fetch(`https://www.ndbc.noaa.gov/data/realtime2/${station.toUpperCase()}.txt`, {
      headers: { "User-Agent": UA },
    });
    // A 404 is a station with no realtime file — a real answer, not a blip.
    if (res.status === 404) return [];
    if (!res.ok) return null;
    text = await res.text();
  } catch {
    return null;
  }
  const cutoff = Date.now() - WINDOW_MS;
  const out: Sample[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const f = line.trim().split(/\s+/);
    if (f.length < 15 || f[6] === "MM") continue;
    const t = Date.UTC(+f[0], +f[1] - 1, +f[2], +f[3], +f[4]);
    if (t >= cutoff) out.push({ t, kt: parseFloat(f[6]) * MS_TO_KT });
  }
  return out;
}

/** Gridpoint model wind for a harbor's cell. NOTE: the gridpoint endpoint keeps little
 *  past data, so MODEL harbors get far fewer samples than buoy ones however wide the
 *  window — expect [few samples] on those rows. */
async function modelWind(grid: string): Promise<Sample[]> {
  const gp = await getJson<{ properties: Record<string, { values?: { validTime: string; value: number | null }[] }> }>(
    `https://api.weather.gov/gridpoints/${grid}`, true);
  const vals = gp?.properties?.windSpeed?.values ?? [];
  const now = Date.now();
  const out: Sample[] = [];
  for (const v of vals) {
    const [start, duration = ""] = v.validTime.split("/");
    const t = new Date(start).getTime();
    // ISO-8601 duration, as NWS writes it: PT1H, PT3H, P1DT6H…
    const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(duration);
    const until = m ? t + ((+(m[1] ?? 0) * 24 + +(m[2] ?? 0)) * 60 + +(m[3] ?? 0)) * 60_000 : t;
    if (t <= now && t >= now - WINDOW_MS && v.value != null) out.push({ t, kt: v.value * KMH_TO_KT, until });
  }
  return out;
}

/**
 * Both series cut to the time span they share, as plain kt arrays for assessDrift.
 *
 * A source that went dark partway through the window — above all a Spotter recovered for
 * the winter, which happens every October/November — would otherwise have its first few
 * days' mean compared against the reference's full ten, and those describe different
 * weather. That produced exactly the false "!! broken" this script must not cry.
 */
function overlap(a: Sample[], b: Sample[]): { ours: number[]; ref: number[]; spanH: number } {
  const end = (x: Sample) => x.until ?? x.t;
  const span = (s: Sample[]) => s.reduce(([lo, hi], x) => [Math.min(lo, x.t), Math.max(hi, end(x))], [Infinity, -Infinity]);
  const [aLo, aHi] = span(a);
  const [bLo, bHi] = span(b);
  const lo = Math.max(aLo, bLo), hi = Math.min(aHi, bHi);
  // Keep a reading whose own instant — or interval, for a model value — touches the span.
  const cut = (s: Sample[]) => s.filter((x) => end(x) >= lo && x.t <= hi).map((x) => x.kt);
  // The span is reported so assessDrift can refuse to judge one too short to mean anything.
  return { ours: cut(a), ref: cut(b), spanH: hi > lo ? (hi - lo) / 3600_000 : 0 };
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

/** Every NDBC station reporting meteorology, with its position — the anemometer pool a
 *  Spotter source is checked against. GLOS mirrors only some NDBC buoys and none of the
 *  shore C-MAN stations, so FPTM4 (the anemometer the Bay de Noc Spotter's wind was
 *  validated against) is reachable only from here. */
async function ndbcMetStations(): Promise<{ id: string; name: string; lat: number; lon: number }[]> {
  let xml: string;
  try {
    const res = await fetch("https://www.ndbc.noaa.gov/activestations.xml", { headers: { "User-Agent": UA } });
    if (!res.ok) return [];
    xml = await res.text();
  } catch {
    return [];
  }
  const out: { id: string; name: string; lat: number; lon: number }[] = [];
  for (const m of xml.matchAll(/<station\s([^>]*?)\/?>/g)) {
    const a: Record<string, string> = {};
    for (const x of m[1].matchAll(/(\w+)="([^"]*)"/g)) a[x[1]] = x[2];
    const lat = parseFloat(a.lat), lon = parseFloat(a.lon);
    if (a.met !== "y" || !a.id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ id: a.id.toUpperCase(), name: a.name ?? "", lat, lon });
  }
  return out;
}

const glosWindCache = new Map<string, Sample[]>();

/** Wind speed from a GLOS platform over WINDOW_DAYS, cached per platform and series. By
 *  default the series is found by matching ids against /parameters; pass `onlyParam` to
 *  read exactly the series the app reads (a Spotter source's configured windId).
 *  null = the fetch FAILED (not cached, and not the same thing as "no wind", which is []):
 *  a Seagull blip must not be reported as a Spotter pulled for the winter. */
async function glosWind(id: number, paramIndex: Map<number, string>, onlyParam?: number): Promise<Sample[] | null> {
  const key = `${id}:${onlyParam ?? "wind_speed"}`;
  if (glosWindCache.has(key)) return glosWindCache.get(key)!;
  const wanted = (pid: number) => (onlyParam != null ? pid === onlyParam : paramIndex.get(pid) === "wind_speed");
  const start = new Date(Date.now() - WINDOW_MS).toISOString().slice(0, 10);
  const data = await getJson<{ parameters?: { parameter_id: number; observations?: { timestamp: string; value: number | null }[] }[] }[]>(
    `https://seagull-api.glos.org/api/v1/obs?obsDatasetId=${id}&startDate=${start}`);
  if (!Array.isArray(data)) return null;
  const cutoff = Date.now() - WINDOW_MS;
  const out: Sample[] = [];
  for (const ds of data) {
    for (const p of ds.parameters ?? []) {
      if (!wanted(p.parameter_id)) continue;
      for (const o of p.observations ?? []) {
        const t = new Date(o.timestamp).getTime();
        if (o.value != null && t >= cutoff) out.push({ t, kt: o.value * MS_TO_KT });
      }
    }
  }
  glosWindCache.set(key, out);
  return out;
}

/** Spotters hide behind plain names as well as SPOT- ids: NDBC lists several under
 *  numeric ids ("45214 South Michigan Spotter", "42358 FGBNMS Sofar Spotter"). */
const SPOTTER_NAME = /spotter|sofar/i;

/** A candidate reference: identity for isEligibleReference, plus where it is and how to
 *  read it, so GLOS buoys and NDBC anemometers can share one selection loop. */
interface RefPlatform extends ReferencePlatform {
  lat: number;
  lon: number;
  wind: () => Promise<Sample[]>;
}

describe("station validation (live)", () => {
  it("every harbor's wind source agrees with a nearby moored buoy", async () => {
    const [buoys, params, ndbcMet] = await Promise.all([
      glosBuoys(),
      getJson<{ parameter_id: number; standard_name: string }[]>("https://seagull-api.glos.org/api/v1/parameters"),
      ndbcMetStations(),
    ]);
    const paramIndex = new Map((params ?? []).map((p) => [p.parameter_id, p.standard_name]));

    // The two reference pools. GLOS moored buoys serve anemometer sources, as they always
    // have. A Spotter source needs a real anemometer instead — see isEligibleReference.
    const glosPool: RefPlatform[] = buoys.map((p) => ({
      id: p.pid || p.name, datasetId: p.id, lat: p.lat, lon: p.lon,
      spotter: SPOTTER_NAME.test(p.name),
      wind: async () => (await glosWind(p.id, paramIndex)) ?? [],
    }));
    // No siting filter here, unlike the GLOS pool's tower exclusion: the nearest NDBC
    // anemometer to some future Spotter could be a sheltered gauge (KWNW3 reads 0.51x),
    // which would make the Spotter look high — conservative-looking, and able to hide a
    // Spotter that reads low. Read the reference column before trusting a pass there.
    const anemometerPool: RefPlatform[] = ndbcMet.map((s) => ({
      id: s.id, lat: s.lat, lon: s.lon,
      spotter: SPOTTER_NAME.test(s.name),
      wind: () => ndbcWind(s.id),
    }));
    if (!ndbcMet.length) console.warn("!! NDBC activestations.xml unavailable — Spotter sources cannot be checked this run.");

    const rows: string[] = [];
    const problems: string[] = [];
    const suspects: string[] = [];

    for (const h of HARBORS as Harbor[]) {
      // Test what the app RATES from, not what the config happens to name first.
      const src = windSourceOf(h);
      let label: string;
      let ours: Sample[];
      let pool: RefPlatform[];
      // Distance is measured from the instrument under test. For a Spotter that is the
      // buoy itself, 9–19 km out from the harbors it serves, not the marina.
      let origin = { lat: h.lat, lon: h.lon };
      if (src.kind === "spotter") {
        const self = buoys.find((p) => p.id === src.ref.datasetId);
        label = self?.pid || `glos:${src.ref.datasetId}`;
        if (self) origin = { lat: self.lat, lon: self.lon };
        // Exactly the series the app reads (windId), not "whatever is called wind_speed".
        const got = await glosWind(src.ref.datasetId, paramIndex, src.ref.windId);
        if (got === null) {
          console.warn(`!! GLOS fetch failed for dataset ${src.ref.datasetId} — ${h.id} not checked this run.`);
          rows.push(`  ${h.id.padEnd(20)} ${label.padEnd(12)} — Spotter fetch FAILED (GLOS); not checked this run`);
          continue;
        }
        ours = got;
        pool = anemometerPool;
      } else {
        label = src.kind === "ndbc" ? src.station : "MODEL";
        ours = src.kind === "ndbc" ? await ndbcWind(src.station) : await modelWind(src.grid);
        pool = glosPool;
      }

      // A Spotter quiet for longer than the app tolerates is not what the harbor rates from
      // right now — getGlosCurrent() drops it at the same age and the model takes over. That
      // happens every winter (Spotters are pulled), and /health already reports it (a dark
      // WIND Spotter fails that run), so say so here rather than judge a source off duty.
      const newest = ours.reduce((m, s) => Math.max(m, s.t), -Infinity);
      if (src.kind === "spotter" && !(Date.now() - newest <= MAX_OBS_AGE_MS)) {
        const quiet = ours.length ? `silent for ${((Date.now() - newest) / 3600_000).toFixed(0)} h` : `no wind in ${WINDOW_DAYS} d`;
        rows.push(`  ${h.id.padEnd(20)} ${label.padEnd(12)} — Spotter ${quiet} (off-season?); live wind is the gridpoint model`);
        continue;
      }

      // Nearest live reference, trying outward until one has data — but never one that
      // isn't independent of the source. isEligibleReference holds that rule, and why it
      // has to check GLOS dataset ids as well as NDBC ids (GLOS mirrors NDBC buoys under
      // their own ids, and a Spotter has no NDBC id at all). Both ways it broke were a
      // silent false PASS in the one tool meant to catch a mis-sited station.
      type Ref = { p: RefPlatform; v: Sample[]; d: number };
      let ref: Ref | null = null;
      const candidates = pool
        .filter((p) => isEligibleReference(h, p))
        .map((p) => ({ p, d: km(origin.lat, origin.lon, p.lat, p.lon) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 6);
      // Prefer the nearest reference that shares enough readings AND enough time with the
      // source to judge it. A platform that barely reports must not block a real one further
      // out — NICOLET offered ONE wind reading in ten days and still won the slot by being
      // nearest — and neither must a buoy recovered near the end of the window, whose last
      // few hours clear the sample count easily. Failing that, the nearest with any data
      // (assessDrift then declines to judge it, and the row says why).
      let fallback: Ref | null = null;
      for (const c of candidates) {
        if (c.d > 60) break;
        const v = await c.p.wind();
        if (!v.length) continue;
        const o = overlap(ours, v);
        if (o.ours.length >= MIN_DRIFT_SAMPLES && o.ref.length >= MIN_DRIFT_SAMPLES && o.spanH >= MIN_DRIFT_SPAN_H) {
          ref = { p: c.p, v, d: c.d };
          break;
        }
        fallback ??= { p: c.p, v, d: c.d };
      }
      ref ??= fallback;

      if (!ours.length || !ref) {
        rows.push(`  ${h.id.padEnd(20)} ${label.padEnd(12)} — no comparison available`);
        continue;
      }
      // The DECISION lives in lib/stationHealth.ts assessDrift() — thresholds, the
      // asymmetry, and the Spotter caveat — so it is unit-tested. This script supplies
      // live data and prints the table; it must not re-derive the rule, because a second
      // copy is one that silently disagrees the moment somebody tunes the other.
      const o = overlap(ours, ref.v);
      const d = assessDrift(h.id, o.ours, ref.p.id, ref.d, o.ref, o.spanH);
      const note =
        d.status === "insufficient" && o.spanH < MIN_DRIFT_SPAN_H ? `  [only ${o.spanH.toFixed(0)} h shared — not judged]`
        : d.status === "insufficient" ? "  [few samples]"
        : d.status === "over" ? "  (reads high — conservative)"
        : d.status === "suspect" ? "  (vs a SPOTTER, which reads 1.1-1.9x high — confirm against an anemometer before acting)"
        : "";
      rows.push(
        `  ${DRIFT_MARK[d.status] + h.id.padEnd(18)} ${label.padEnd(12)} ${d.meanKt.toFixed(1).padStart(5)} kt   vs ` +
        `${d.referenceMeanKt.toFixed(1).padStart(5)} kt  ${d.reference} (${d.referenceKm.toFixed(0)} km)  ` +
        `ratio ${d.ratio.toFixed(2)}${note}`);
      if (d.status === "under") {
        problems.push(
          `${h.id}: ${label} ${d.finding}` +
          (src.kind === "spotter"
            ? ` Do NOT just remove windId: the harbor would fall back to the gridpoint model, ` +
              `which has read ~0.6-0.72x a real anemometer on Green Bay — lower still. Compare ` +
              `the model against this same anemometer first, and drop windId only if it reads higher.`
            : ""));
      }
      if (d.status === "suspect") suspects.push(`${h.id}: ${label} ${d.finding}`);
    }

    console.log(
      `\n${WINDOW_DAYS}-day mean wind: each harbor's LIVE wind source vs the nearest independent reference ` +
      `(a GLOS moored buoy; an NDBC anemometer when the source is a Spotter)\n${rows.join("\n")}\n`);

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
