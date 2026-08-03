// NDBC buoy data. The realtime2 feed is a fixed-width text table, newest row
// first, with "MM" for missing values. Some stations (cribs) skip wave columns,
// so we take the most recent non-missing value per field within the last ~2 h.
//
// Server-only: NDBC serves no CORS header, so this must run behind our API.

import { msToKt, mToFt, cToF } from "./units";

const UA = process.env.NWS_USER_AGENT || "ChicagoHarborSailing/0.1 (set NWS_USER_AGENT)";

export interface BuoyRow {
  time: number; // epoch ms (UTC)
  windDir: number | null;
  windKt: number | null;
  gustKt: number | null;
  waveFt: number | null;
  wavePeriodS: number | null;
  waveDir: number | null;
  waterTempF: number | null;
  airTempF: number | null;
}

export interface BuoyCurrent {
  windDir: number | null;
  windKt: number | null;
  gustKt: number | null;
  waveFt: number | null;
  wavePeriodS: number | null;
  waveDir: number | null;
  waterTempF: number | null;
  airTempF: number | null;
  observedAt: string | null;
  station: string;
}

export interface WindPoint {
  time: string;
  windKt: number | null;
  gustKt: number | null;
  windDir: number | null;
}

function num(v: string): number | null {
  return v === "MM" || v === undefined ? null : Number.parseFloat(v);
}

export function parseRealtime2(text: string): BuoyRow[] {
  const rows: BuoyRow[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const f = line.trim().split(/\s+/);
    if (f.length < 15) continue;
    const [yy, mm, dd, hh, mn] = f.map(Number);
    const time = Date.UTC(yy, mm - 1, dd, hh, mn);
    const wspd = num(f[6]);
    const gst = num(f[7]);
    const wvht = num(f[8]);
    const wtmp = num(f[14]);
    const atmp = num(f[13]);
    rows.push({
      time,
      windDir: num(f[5]),
      windKt: wspd == null ? null : msToKt(wspd),
      gustKt: gst == null ? null : msToKt(gst),
      waveFt: wvht == null ? null : mToFt(wvht),
      wavePeriodS: num(f[9]),
      waveDir: num(f[11]),
      waterTempF: wtmp == null ? null : cToF(wtmp),
      airTempF: atmp == null ? null : cToF(atmp),
    });
  }
  return rows;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: ctrl.signal,
      // Cache buoy data ~5 min at the framework layer.
      next: { revalidate: 300 },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** A station whose newest row is older than this is treated as dark, not current.
 *  Stations do go quiet for days while still serving a stale file — reporting that as
 *  "conditions right now" is worse than having no reading, because callers can fall
 *  back (a neighbouring buoy, or the gridpoint model via harbor.windFromGrid). */
const MAX_OBS_AGE_MS = 3 * 3600_000;

/** Latest available reading for a station, filling each field from recent rows.
 *  Null when the station is unreachable, empty, or stale. */
export async function getBuoyCurrent(station: string): Promise<BuoyCurrent | null> {
  const text = await fetchText(`https://www.ndbc.noaa.gov/data/realtime2/${station.toUpperCase()}.txt`);
  if (!text) return null;
  const rows = parseRealtime2(text);
  if (!rows.length) return null;
  if (Date.now() - rows[0].time > MAX_OBS_AGE_MS) return null;

  const cutoff = rows[0].time - 2 * 3600_000; // within 2 h of newest
  const recent = rows.filter((r) => r.time >= cutoff);
  const pick = <K extends keyof BuoyRow>(k: K): number | null => {
    for (const r of recent) if (r[k] != null) return r[k] as number;
    return null;
  };

  return {
    station,
    windDir: pick("windDir"),
    windKt: pick("windKt"),
    gustKt: pick("gustKt"),
    waveFt: pick("waveFt"),
    wavePeriodS: pick("wavePeriodS"),
    waveDir: pick("waveDir"),
    waterTempF: pick("waterTempF"),
    airTempF: pick("airTempF"),
    observedAt: new Date(rows[0].time).toISOString(),
  };
}

/** Last `hours` of wind observations, oldest → newest, for the live wind graph. */
export async function getBuoyWindHistory(station: string, hours = 24): Promise<WindPoint[]> {
  const text = await fetchText(`https://www.ndbc.noaa.gov/data/realtime2/${station.toUpperCase()}.txt`);
  if (!text) return [];
  const rows = parseRealtime2(text);
  if (!rows.length) return [];
  // Same guard as getBuoyCurrent: a dark station would otherwise plot days-old data
  // as if it were the last 24 h.
  if (Date.now() - rows[0].time > MAX_OBS_AGE_MS) return [];
  const cutoff = rows[0].time - hours * 3600_000;
  return rows
    .filter((r) => r.time >= cutoff && r.windKt != null)
    .map((r) => ({ time: new Date(r.time).toISOString(), windKt: r.windKt, gustKt: r.gustKt, windDir: r.windDir }))
    .reverse();
}
