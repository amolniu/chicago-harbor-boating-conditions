// Unit conversions and compass helpers. NDBC reports metric (m/s, m, °C);
// sailors think in knots, feet, and °F, so we convert once at the edge.

export const MS_TO_KT = 1.943844;
export const M_TO_FT = 3.280839895;

export function msToKt(ms: number): number {
  return ms * MS_TO_KT;
}

export function mToFt(m: number): number {
  return m * M_TO_FT;
}

export function cToF(c: number): number {
  return (c * 9) / 5 + 32;
}

export const COMPASS_16 = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
] as const;

export type Compass16 = (typeof COMPASS_16)[number];

/** Nearest 16-point compass label for a bearing in degrees (0 = N, clockwise). */
export function degToCompass(deg: number): Compass16 {
  const idx = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return COMPASS_16[idx];
}

/** Smallest absolute angular difference between two bearings, 0–180°. */
export function angleDiff(a: number, b: number): number {
  let d = Math.abs((((a - b) % 360) + 360) % 360);
  if (d > 180) d = 360 - d;
  return d;
}

/** Round to a given number of decimals. */
export function round(n: number, decimals = 0): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
