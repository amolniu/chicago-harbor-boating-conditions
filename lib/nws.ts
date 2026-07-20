// National Weather Service (api.weather.gov) + nearshore marine text products.
// Server-side: NWS requires a User-Agent and we cache to stay well under limits.

import { Advisory, ForecastHour } from "./types";
import { estimateWaveFt } from "./window";

const UA = process.env.NWS_USER_AGENT || "ChicagoHarborSailing/0.1 (set NWS_USER_AGENT)";

const CARDINAL: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

const MPH_TO_KT = 0.868976;

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

function parseSpeedKt(s: string | undefined): number {
  if (!s) return 0;
  const nums = (s.match(/\d+/g) || []).map(Number);
  if (!nums.length) return 0;
  return Math.max(...nums) * MPH_TO_KT; // higher end of any range, mph → kt
}

/** Hourly wind forecast → ForecastHour[] with an estimated wind-sea. */
export async function getHourlyForecast(lat: number, lon: number): Promise<ForecastHour[]> {
  const point = await fetchJson<{ properties: { forecastHourly: string } }>(
    `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
    24 * 3600,
  );
  const url = point?.properties?.forecastHourly;
  if (!url) return [];
  const fc = await fetchJson<{ properties: { periods: RawPeriod[] } }>(url, 1800);
  const periods = fc?.properties?.periods;
  if (!periods) return [];

  return periods.slice(0, 48).map((p) => {
    const windKt = parseSpeedKt(p.windSpeed);
    const windDir = CARDINAL[(p.windDirection || "N").toUpperCase()] ?? 0;
    const gustKt = p.windGust ? parseSpeedKt(p.windGust) : windKt * 1.35;
    return { time: p.startTime, windDir, windKt, gustKt, waveFt: estimateWaveFt(windKt, windDir) };
  });
}

interface RawPeriod {
  startTime: string;
  windSpeed?: string;
  windGust?: string;
  windDirection?: string;
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
