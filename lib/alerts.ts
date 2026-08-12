// NWS active watches and warnings (api.weather.gov/alerts/active).
//
// Why this exists: the app previously knew about weather only through the HRRR
// convective model and the marine zone text product. Neither carries a Tornado
// Warning. That meant a tornado could be on the ground beside the harbor while the
// score sat green, because nothing in the pipeline had heard of it.
//
// Alerts are queried per harbor POINT rather than per storm cell: warning polygons are
// small and short-lived, so a cell centroid ~50 km away would both miss real warnings
// and invent ones that don't cover the harbor. Cached briefly for the same reason.
//
// The classifier below is pure and unit-tested; only the fetch is server-only.

/** stop = do not be on the water. watch = conditions favour it. info = show, don't score. */
export type AlertLevel = "stop" | "watch" | "info";

export interface WeatherAlert {
  /** NWS event name, e.g. "Tornado Warning". */
  event: string;
  headline: string | null;
  level: AlertLevel;
  /** ISO timestamp the alert expires, when NWS gives one. */
  ends: string | null;
}

// Life-threatening on open water. A Severe Thunderstorm Warning means 58+ mph gusts,
// which is a capsizing wind for anything on this app's list, so it ranks with tornadoes
// rather than below them. Special Marine Warning is the marine equivalent.
const STOP = [
  /tornado warning/i,
  /severe thunderstorm warning/i,
  /special marine warning/i,
  /waterspout/i,
  /hurricane (warning|force wind warning)/i,
  /tropical storm warning/i,
];

// Conditions favour severe weather but nothing is confirmed yet.
const WATCH = [/tornado watch/i, /severe thunderstorm watch/i];

/** Map an NWS event name to how much it should constrain the decision. */
export function classifyAlert(event: string): AlertLevel {
  if (STOP.some((re) => re.test(event))) return "stop";
  if (WATCH.some((re) => re.test(event))) return "watch";
  return "info";
}

const RANK: Record<AlertLevel, number> = { stop: 0, watch: 1, info: 2 };

/** Most constraining level across a set of alerts ("info" when there are none). */
export function worstAlertLevel(alerts: WeatherAlert[] | undefined): AlertLevel {
  let worst: AlertLevel = "info";
  for (const a of alerts ?? []) if (RANK[a.level] < RANK[worst]) worst = a.level;
  return worst;
}

interface AlertFeature {
  properties?: {
    event?: string;
    headline?: string | null;
    description?: string | null;
    ends?: string | null;
    expires?: string | null;
  };
}

const UA = process.env.NWS_USER_AGENT || "ChicagoHarborSailing/0.1 (set NWS_USER_AGENT)";

/** Active alerts covering a point, most constraining first. Empty on failure — the
 *  caller must not treat "we couldn't ask" as "all clear", so failures are logged. */
export async function getActiveAlerts(lat: number, lon: number): Promise<WeatherAlert[]> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(`https://api.weather.gov/alerts/active?point=${lat},${lon}`, {
      headers: { "User-Agent": UA, Accept: "application/geo+json" },
      signal: ctrl.signal,
      // Warnings are issued and expire on a ~30 min cycle, so this is deliberately
      // much shorter than the other feeds' caching.
      next: { revalidate: 300 },
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: AlertFeature[] };
    const out: WeatherAlert[] = [];
    for (const f of data.features ?? []) {
      const event = f.properties?.event?.trim();
      if (!event) continue;
      out.push({
        event,
        headline: f.properties?.headline?.trim() || null,
        level: classifyAlert(event),
        ends: f.properties?.ends ?? f.properties?.expires ?? null,
      });
    }
    return out.sort((a, b) => RANK[a.level] - RANK[b.level]);
  } catch {
    return [];
  }
}
