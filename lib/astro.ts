// Sunrise / sunset via suncalc — computed locally, no network dependency.

import SunCalc from "suncalc";

export interface SunTimes {
  sunrise: Date;
  sunset: Date;
}

export function getSunTimes(lat: number, lon: number, date = new Date()): SunTimes {
  const t = SunCalc.getTimes(date, lat, lon);
  return { sunrise: t.sunrise, sunset: t.sunset };
}

const TZ = "America/Chicago";

export function fmtLocalTime(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(d);
}
