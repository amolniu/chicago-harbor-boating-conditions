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

/** Clock time in the HARBOR's zone — Michigan's east shore keeps Eastern time. No
 *  default: a forgotten zone would silently read an hour off there. */
export function fmtLocalTime(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(d);
}
