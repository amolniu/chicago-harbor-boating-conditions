// HRRR convective / thunderstorm signal.
//
// NOMADS only offers HRRR as GRIB2 (impractical to parse in a serverless fn), so
// we read it via Open-Meteo, which re-serves the HRRR model as JSON: CAPE (the
// convective energy that fuels thunderstorms), wind gusts, and precipitation.
// Thunderstorms are mesoscale, so one Chicago-metro point covers every harbor.
//
// Server-only fetch; the classifier below is pure and unit-tested.

const TZ = "America/Chicago";

export type StormLevel = "none" | "watch" | "elevated" | "active";

export interface StormOutlook {
  level: StormLevel;
  headline: string;
  capeNow: number | null;
  gustPeakKt: number | null;
  /** Top-of-hour UTC ISO timestamps (next 24 h) flagged thunderstorm-likely. */
  stormyHours: string[];
}

export interface StormHourly {
  time: number[]; // epoch ms, top of each hour
  cape: number[]; // J/kg
  precip: number[]; // mm
  gustKt: number[]; // kt
}

function fmtHour(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: true }).format(new Date(ms));
}

/** Pure classifier: hourly HRRR fields → storm outlook. */
export function classifyStorm(h: StormHourly, now: number): StormOutlook {
  const n = h.time.length;
  const at = (arr: number[], i: number) => arr[i] ?? 0;
  // A "stormy" hour = convective rain on unstable air.
  const stormy = (i: number) => at(h.cape, i) >= 500 && at(h.precip, i) >= 0.2;

  // Index of the hour covering "now".
  let cur = 0;
  for (let i = 0; i < n; i++) {
    if (h.time[i] <= now) cur = i;
    else break;
  }
  const idx = (count: number) => Array.from({ length: count }, (_, k) => cur + k).filter((i) => i < n);
  const next6 = idx(6);
  const next12 = idx(12);

  const stormyHours: string[] = [];
  for (let i = 0; i < n; i++) {
    if (h.time[i] >= now - 3600_000 && h.time[i] <= now + 24 * 3600_000 && stormy(i)) {
      stormyHours.push(new Date(h.time[i]).toISOString());
    }
  }

  const capeNow = h.cape[cur] ?? null;
  const gustPeakKt = next12.length ? Math.max(...next12.map((i) => at(h.gustKt, i))) : null;

  const activeNow = stormy(cur) || stormy(Math.min(cur + 1, n - 1)) || (at(h.precip, cur) >= 0.3 && at(h.cape, cur) >= 300);
  const elevated = next6.some(stormy) || next6.some((i) => at(h.cape, i) >= 1500 && at(h.precip, i) >= 0.1);
  const gusty = (gustPeakKt ?? 0) >= 25;
  const watch = next12.some((i) => at(h.cape, i) >= 800) || gusty;

  let level: StormLevel = "none";
  let headline = "No thunderstorms in the HRRR outlook.";
  if (activeNow) {
    level = "active";
    headline = "Thunderstorms in the area now — stay in until they clear.";
  } else if (elevated) {
    level = "elevated";
    headline = stormyHours.length
      ? `Thunderstorms likely around ${fmtHour(new Date(stormyHours[0]).getTime())} — plan to be back before then.`
      : "Thunderstorms likely later today.";
  } else if (watch) {
    level = "watch";
    headline = gusty
      ? `Gusty squalls possible (gusts to ${Math.round(gustPeakKt!)} kt) — keep an eye on the sky.`
      : "Unstable air — isolated pop-up storms possible; watch the horizon.";
  }

  return { level, headline, capeNow, gustPeakKt, stormyHours };
}

interface OMResponse {
  hourly?: { time: string[]; cape: number[]; precipitation: number[]; wind_gusts_10m: number[] };
}

/** Fetch the HRRR storm outlook for a point (Open-Meteo). Null on failure. */
export async function getStormOutlook(lat: number, lon: number): Promise<StormOutlook | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=wind_gusts_10m,cape,precipitation&models=gfs_hrrr&wind_speed_unit=kn&forecast_days=2&timezone=GMT`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(url, { signal: ctrl.signal, next: { revalidate: 900 } });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as OMResponse;
    const h = data.hourly;
    if (!h?.time?.length) return null;
    // Open-Meteo GMT times ("2026-07-24T13:00") → epoch ms at top of hour.
    return classifyStorm(
      {
        time: h.time.map((t) => new Date(t + "Z").getTime()),
        cape: h.cape ?? [],
        precip: h.precipitation ?? [],
        gustKt: h.wind_gusts_10m ?? [],
      },
      Date.now(),
    );
  } catch {
    return null;
  }
}
