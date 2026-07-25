// National Weather Service (api.weather.gov) + nearshore marine text products.
// Server-side: NWS requires a User-Agent and we cache to stay well under limits.

import { Advisory, ForecastHour } from "./types";
import { estimateWaveFt } from "./window";
import { M_TO_FT } from "./units";

const UA = process.env.NWS_USER_AGENT || "ChicagoHarborSailing/0.1 (set NWS_USER_AGENT)";

const KMH_TO_KT = 0.539957;

// --- NWS gridpoint time series ---------------------------------------------
// Each gridpoint variable is a list of {validTime: "<ISO>/<ISO8601 duration>",
// value} where the value holds for that duration. We expand those into intervals
// and sample by timestamp.

interface Interval {
  start: number;
  end: number;
  value: number | null;
}

/** Hours in an ISO8601 duration like P1DT6H / PT3H / PT30M (the NWS subset). */
export function parseDurationHours(dur: string): number {
  const m = dur.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/);
  if (!m) return 1;
  return +(m[1] || 0) * 24 + +(m[2] || 0) + +(m[3] || 0) / 60;
}

function parseSeries(v: { values?: { validTime: string; value: number | null }[] } | undefined): Interval[] {
  const out: Interval[] = [];
  for (const e of v?.values ?? []) {
    const [iso, dur] = e.validTime.split("/");
    const start = new Date(iso).getTime();
    out.push({ start, end: start + parseDurationHours(dur || "PT1H") * 3600_000, value: e.value });
  }
  return out;
}

/** Value of the interval covering `t`, else the first/last value in range. */
export function sampleAt(series: Interval[], t: number): number | null {
  if (!series.length) return null;
  for (const p of series) if (t >= p.start && t < p.end) return p.value;
  return t < series[0].start ? series[0].value : series[series.length - 1].value;
}

async function fetchJson<T>(url: string, revalidate: number): Promise<T | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/geo+json" },
      signal: ctrl.signal,
      next: { revalidate },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchText(url: string, revalidate: number): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal, next: { revalidate } });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

type SeriesKey = "waveHeight" | "wavePeriod" | "waveDirection" | "windSpeed" | "windGust" | "windDirection";
type Gridpoint = Record<SeriesKey, Interval[]>;
const SERIES_KEYS: SeriesKey[] = ["waveHeight", "wavePeriod", "waveDirection", "windSpeed", "windGust", "windDirection"];

async function fetchGridpoint(grid: string): Promise<Gridpoint | null> {
  const gp = await fetchJson<{ properties: Record<string, { values?: { validTime: string; value: number | null }[] }> }>(
    `https://api.weather.gov/gridpoints/${grid}`,
    1800,
  );
  if (!gp?.properties) return null;
  const out = {} as Gridpoint;
  for (const k of SERIES_KEYS) out[k] = parseSeries(gp.properties[k]);
  return out;
}

export interface GridCurrent {
  waveFt: number | null;
  wavePeriodS: number | null;
  waveDir: number | null;
  windKt: number | null;
  gustKt: number | null;
  windDir: number | null;
}

/** Current per-harbor wave + wind from the NWS gridpoint (model nowcast). The wind
 *  is the live source for harbors with no nearby buoy (harbor.windFromGrid). */
export async function getGridCurrent(grid: string): Promise<GridCurrent | null> {
  const gp = await fetchGridpoint(grid);
  if (!gp) return null;
  const now = Date.now();
  const m = sampleAt(gp.waveHeight, now);
  const ws = sampleAt(gp.windSpeed, now);
  const gustKmh = sampleAt(gp.windGust, now) ?? ws;
  return {
    waveFt: m == null ? null : m * M_TO_FT,
    wavePeriodS: sampleAt(gp.wavePeriod, now),
    waveDir: sampleAt(gp.waveDirection, now),
    windKt: ws == null ? null : ws * KMH_TO_KT,
    gustKt: gustKmh == null ? null : gustKmh * KMH_TO_KT,
    windDir: sampleAt(gp.windDirection, now),
  };
}

/** Per-harbor hourly wind + wave forecast from the gridpoint (next 48 h). */
export async function getGridpointHourly(grid: string): Promise<ForecastHour[]> {
  const gp = await fetchGridpoint(grid);
  if (!gp) return [];
  const start = Math.floor(Date.now() / 3600_000) * 3600_000;
  const out: ForecastHour[] = [];
  for (let i = 0; i < 48; i++) {
    const t = start + i * 3600_000;
    const ws = sampleAt(gp.windSpeed, t);
    const wd = sampleAt(gp.windDirection, t);
    if (ws == null || wd == null) continue;
    const windKt = ws * KMH_TO_KT;
    const gustKmh = sampleAt(gp.windGust, t);
    const wh = sampleAt(gp.waveHeight, t);
    out.push({
      time: new Date(t).toISOString(),
      windDir: wd,
      windKt,
      gustKt: (gustKmh ?? ws) * KMH_TO_KT,
      waveFt: wh == null ? estimateWaveFt(windKt, wd) : wh * M_TO_FT,
    });
  }
  return out;
}

export interface MarineForecast {
  advisory: Advisory;
  waveText: string | null;
  headline: string | null;
  raw: string | null;
}

/** Nearshore marine text product → advisory level + a wave-forecast line. */
export async function getMarineForecast(zone: string): Promise<MarineForecast> {
  const text = await fetchText(
    `https://tgftp.nws.noaa.gov/data/forecasts/marine/near_shore/lm/${zone.toLowerCase()}.txt`,
    1800,
  );
  if (!text) return { advisory: "none", waveText: null, headline: null, raw: null };

  const upper = text.toUpperCase();
  let advisory: Advisory = "none";
  if (upper.includes("STORM WARNING")) advisory = "storm";
  else if (upper.includes("GALE")) advisory = "gale";
  else if (upper.includes("SMALL CRAFT ADVISORY")) advisory = "small_craft";

  const waveMatch = text.match(/WAVES?\s+[^.\n]*?FT[^.\n]*/i);
  const headMatch = text.match(/\.\.\.([^.\n]+(?:ADVISORY|WARNING)[^.\n]*)\.\.\./i);

  return {
    advisory,
    waveText: waveMatch ? waveMatch[0].replace(/\s+/g, " ").trim() : null,
    headline: headMatch ? headMatch[1].trim() : null,
    raw: text,
  };
}

export interface Discussion {
  text: string;
  issued: string | null;
}

/** Latest Area Forecast Discussion for an office (default LOT = Chicago). */
export async function getDiscussion(office = "LOT"): Promise<Discussion | null> {
  const list = await fetchJson<{ "@graph": { id: string; issuanceTime: string }[] }>(
    `https://api.weather.gov/products/types/AFD/locations/${office}`,
    1800,
  );
  const latest = list?.["@graph"]?.[0];
  if (!latest?.id) return null;
  // The list gives a bare product UUID; the product itself lives at /products/{id}.
  const product = await fetchJson<{ productText: string; issuanceTime: string }>(
    `https://api.weather.gov/products/${latest.id}`,
    1800,
  );
  if (!product?.productText) return null;
  return { text: product.productText, issued: product.issuanceTime ?? latest.issuanceTime ?? null };
}
