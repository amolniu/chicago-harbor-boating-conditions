// NWS active watches, warnings and marine advisories (api.weather.gov/alerts/active).
//
// Why this exists: the app previously knew about weather only through the HRRR
// convective model and the marine zone text product. Neither carries a Tornado
// Warning. That meant a tornado could be on the ground beside the harbor while the
// score sat green, because nothing in the pipeline had heard of it.
//
// Two queries, because NWS issues two kinds of product (rework of 2026-10-18):
//   • MARINE alerts are issued per marine ZONE (Small Craft Advisory, Gale/Storm
//     Warning, Special Marine Warning). Fetched once for all of Lake Michigan and matched
//     to each harbor's zones. They used to be queried per harbor POINT — and 14 of the 27
//     harbor points sit on land, in no marine zone, so zone-issued warnings never reached
//     them (on 2026-10-17 that silently dropped Small Craft Advisories at seven harbors).
//   • LAND warnings (Tornado, Severe Thunderstorm) carry small polygons, so they are still
//     queried per harbor point. Merged with the marine set by alert id.
//
// Marine advisories now come from here too, with machine-readable start and end times
// (`onset`, `ends`), instead of from the nearshore text — which says "IN EFFECT FROM 7 PM
// SATURDAY" with no parseable time, so a scheduled advisory capped from the moment it was
// issued and an expired one lingered until the text was reissued. The text product stays
// as the fallback when this feed fails, and as the source of the wave forecast line.
//
// A failed fetch returns NULL, never []: "we couldn't ask" must not read as "all clear".
// The caller turns that into a visible, capped "couldn't check NWS warnings" state.
//
// Everything above getMarineAlerts() is pure and unit-tested; only the fetches are
// server-only.

import { harborZones, type Harbor } from "./harbors";
import type { Advisory } from "./types";

/** stop = do not be on the water. watch = conditions favour it. info = show, don't score. */
export type AlertLevel = "stop" | "watch" | "info";

export interface WeatherAlert {
  /** NWS alert id — the dedupe key when the point and zone queries return the same one. */
  id?: string;
  /** NWS event name, e.g. "Tornado Warning". */
  event: string;
  headline: string | null;
  level: AlertLevel;
  /** When the hazard STARTS (VTEC start). Null or past = already in effect. A scheduled
   *  advisory is listed by NWS as soon as it is issued, hours before this. */
  onset?: string | null;
  /** When the hazard ENDS (falls back to `expires` only when NWS gives no end). */
  ends: string | null;
  /** Zones (UGC codes) the alert covers, for matching to harbors. */
  zones?: string[];
  /** Set when this alert IS a marine advisory tier (SCA / gale / storm). Those are carried
   *  as `Conditions.advisory`, so they are not shown again as a separate alert pill. */
  advisory?: Exclude<Advisory, "none">;
}

/** A hazard with a time window, for rating forecast hours (the sail window). */
export interface HazardPeriod {
  event: string;
  level: AlertLevel;
  advisory?: Exclude<Advisory, "none">;
  onset: string | null;
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

/** Most constraining first, so the first alert is the one a cap is named after. */
export function sortAlerts<T extends { level: AlertLevel }>(alerts: T[]): T[] {
  return [...alerts].sort((a, b) => RANK[a.level] - RANK[b.level]);
}

const TIER: Record<Exclude<Advisory, "none">, number> = { small_craft: 1, gale: 2, storm: 3 };

/** The marine advisory tier a VTEC phenomenon.significance stands for. Watches (GL.A,
 *  SR.A, HF.A) are deliberately absent: a watch says the wind is POSSIBLE within ~48 h,
 *  not blowing now, and caps nothing — the same rule the text parser follows. */
export function advisoryForVtec(phenSig: string): Exclude<Advisory, "none"> | undefined {
  switch (phenSig) {
    case "SC.Y":
      return "small_craft";
    case "GL.W":
      return "gale";
    case "SR.W":
    case "HF.W":
      return "storm";
    default:
      return undefined;
  }
}

interface AlertFeature {
  properties?: {
    id?: string;
    event?: string;
    headline?: string | null;
    messageType?: string;
    onset?: string | null;
    ends?: string | null;
    expires?: string | null;
    geocode?: { UGC?: string[] };
    parameters?: { VTEC?: string[] };
  };
}

/** "/O.CON.KGRB.SC.Y.0091.000000T0000Z-261019T0300Z/" → action "CON", "SC.Y". */
export function parseVtec(vtec: string | undefined): { action: string; phenSig: string } | null {
  const m = vtec?.match(/^\/[OTEX]\.([A-Z]{3})\.[A-Z]{4}\.([A-Z]{2}\.[A-Z])\./);
  return m ? { action: m[1], phenSig: m[2] } : null;
}

/**
 * One NWS feature → WeatherAlert, or null when it must be ignored.
 *
 * Cancelled and upgraded segments are dropped by their VTEC action, WHATEVER the
 * messageType says: NWS sometimes sends a cancellation (CAN) or an upgrade (UPG) as
 * messageType "Alert", and those linger in /alerts/active until the ORIGINAL end time —
 * a cancelled watch for a day, or an upgraded Gale Warning listed beside its replacement.
 */
export function parseAlertFeature(f: AlertFeature): WeatherAlert | null {
  const p = f.properties;
  const event = p?.event?.trim();
  if (!p || !event) return null;
  if (p.messageType === "Cancel") return null;
  const vtec = parseVtec(p.parameters?.VTEC?.[0]);
  if (vtec && (vtec.action === "CAN" || vtec.action === "UPG")) return null;
  return {
    id: p.id,
    event,
    headline: p.headline?.trim() || null,
    level: classifyAlert(event),
    onset: p.onset ?? null,
    // `expires` is when the MESSAGE is due an update, not when the hazard ends — it can
    // fall before the start or after the end — so it is used only when NWS gives no end.
    ends: p.ends ?? p.expires ?? null,
    zones: p.geocode?.UGC ?? [],
    advisory: vtec ? advisoryForVtec(vtec.phenSig) : undefined,
  };
}

/** Is the hazard in effect at `t` (ms)? Started (or no start given) and not yet ended. */
export function activeAt(a: { onset?: string | null; ends: string | null }, t: number): boolean {
  const start = a.onset ? Date.parse(a.onset) : -Infinity;
  const end = a.ends ? Date.parse(a.ends) : Infinity;
  return start <= t && t < end;
}

/** Does the hazard overlap [from, to) — e.g. one forecast hour? */
export function overlaps(a: { onset?: string | null; ends: string | null }, from: number, to: number): boolean {
  const start = a.onset ? Date.parse(a.onset) : -Infinity;
  const end = a.ends ? Date.parse(a.ends) : Infinity;
  return start < to && from < end;
}

/** The highest advisory tier among `alerts` (ignoring any that aren't advisories). */
export function worstAdvisory(alerts: { advisory?: Exclude<Advisory, "none"> }[]): Advisory {
  let worst: Advisory = "none";
  for (const a of alerts) if (a.advisory && (worst === "none" || TIER[a.advisory] > TIER[worst])) worst = a.advisory;
  return worst;
}

export interface ResolvedHazards {
  /** The marine advisory in effect NOW for this harbor's zones. */
  advisory: Advisory;
  /** Watches and warnings in effect NOW (advisory tiers excluded — they are `advisory`),
   *  most constraining first. */
  alerts: WeatherAlert[];
  /** Every hazard affecting the harbor, current or scheduled, with its window. */
  hazards: HazardPeriod[];
  /** True when the warnings could not be checked: the ratings must not say "go". */
  warningsUnavailable: boolean;
}

/**
 * Decide what applies to one harbor, from the Lake Michigan marine alerts and the alerts
 * at the harbor's point. Either input is NULL when its fetch failed.
 *
 * Whole-zone rule (decided 2026-10-18): a Special Marine Warning for any of the harbor's
 * zones counts, even if its polygon covers only part of the zone — over-warning a harbor
 * is the safe direction; missing one is not.
 */
export function resolveHazards(
  harbor: Harbor,
  marine: WeatherAlert[] | null,
  point: WeatherAlert[] | null,
  textAdvisory: Advisory,
  now: number,
): ResolvedHazards {
  const zones = new Set(harborZones(harbor));
  const byId = new Map<string, WeatherAlert>();
  const add = (a: WeatherAlert) => byId.set(a.id ?? `${a.event}|${a.onset}|${a.ends}`, a);
  for (const a of marine ?? []) if (a.zones?.some((z) => zones.has(z))) add(a);
  // A harbor point that does sit inside a marine zone also gets that zone's advisories
  // from the point query; the id dedupes them against the marine set.
  for (const a of point ?? []) add(a);
  const all = [...byId.values()];
  const now_ = all.filter((a) => activeAt(a, now));

  // The timeline: everything that caps an hour, plus anything SCHEDULED (so a Gale Watch
  // issued 36 h ahead still shows as "coming up" — it caps nothing, the window skips info).
  const timeline: HazardPeriod[] = all
    .filter((a) => a.advisory || a.level !== "info" || (!!a.onset && Date.parse(a.onset) > now))
    .map((a) => ({ event: a.event, level: a.level, advisory: a.advisory, onset: a.onset ?? null, ends: a.ends }));
  // Marine feed down: the header falls back to the nearshore text's advisory, so the sail
  // window must too — open-ended, since the text carries no machine-readable end.
  if (marine === null && textAdvisory !== "none") {
    timeline.push({ event: ADVISORY_EVENT[textAdvisory], level: "info", advisory: textAdvisory, onset: null, ends: null });
  }

  return {
    // With the marine feed down, fall back to the nearshore text's advisory: imprecise on
    // timing, but it is what the app relied on before and errs early, not late.
    advisory: marine === null ? textAdvisory : worstAdvisory(now_),
    // Advisory tiers are shown as `advisory`, not again as pills — EXCEPT a stop-level one
    // (a Hurricane Force Wind Warning is both the storm tier and a hard stop): it must
    // stay a stop alert, or it would cap at 5 instead of pinning to 0.
    alerts: sortAlerts(now_.filter((a) => !a.advisory || a.level === "stop")),
    // One hazard can arrive as several features: NWS splits a product into zone segments,
    // each with its own id, and a boundary harbor can match two of them.
    hazards: dedupeHazards(timeline),
    warningsUnavailable: marine === null || point === null,
  };
}

const ADVISORY_EVENT: Record<Exclude<Advisory, "none">, string> = {
  small_craft: "Small Craft Advisory",
  gale: "Gale Warning",
  storm: "Storm Warning",
};

function dedupeHazards(list: HazardPeriod[]): HazardPeriod[] {
  const seen = new Set<string>();
  return list.filter((z) => {
    const key = `${z.event}|${z.advisory ?? ""}|${z.onset ?? ""}|${z.ends ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const UA = process.env.NWS_USER_AGENT || "ChicagoHarborSailing/0.1 (set NWS_USER_AGENT)";

/** How long a SUCCESSFUL alerts response is reused. NWS's own CDN caches for 5 s. */
export const ALERTS_TTL_MS = 60_000;

/**
 * Our own small cache, instead of Next's fetch cache — deliberately.
 *
 * Next's data cache is stale-while-revalidate and never stores a failure: once NWS starts
 * failing, every request is answered with the LAST GOOD body while the refresh fails
 * quietly in the background. That hid exactly the state this module exists to expose — the
 * "couldn't check warnings" path would almost never run, and an outage would keep serving
 * old alerts (new warnings unseen) for as long as it lasted. So: fetch `no-store`, reuse a
 * success for ALERTS_TTL_MS, share in-flight requests, and report a failure as a failure.
 */
const memo = new Map<string, { data: WeatherAlert[]; at: number }>();
const inflight = new Map<string, Promise<WeatherAlert[] | null>>();

/** For tests. */
export function clearAlertsCache(): void {
  memo.clear();
  inflight.clear();
}

function fetchAlerts(url: string, what: string): Promise<WeatherAlert[] | null> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < ALERTS_TTL_MS) return Promise.resolve(hit.data);
  let p = inflight.get(url);
  if (!p) {
    p = fetchAlertsUncached(url, what).then((data) => {
      inflight.delete(url);
      if (data !== null) memo.set(url, { data, at: Date.now() });
      return data;
    });
    inflight.set(url, p);
  }
  return p;
}

/** Fetch alert features, retrying once. NULL on any failure — non-200, a non-JSON body
 *  (NWS's CDN answers some errors with HTML), or a timeout — and it is logged. */
async function fetchAlertsUncached(url: string, what: string): Promise<WeatherAlert[] | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/geo+json" },
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { features?: AlertFeature[] };
      clearTimeout(timer);
      if (!Array.isArray(data.features)) throw new Error("no features array");
      return data.features.map(parseAlertFeature).filter((a): a is WeatherAlert => a !== null);
    } catch (e) {
      if (attempt === 2) {
        console.warn(`NWS alerts fetch failed (${what}): ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return null;
}

/** Every marine alert on Lake Michigan (incl. Green Bay) — one request for all harbors. */
export function getMarineAlerts(): Promise<WeatherAlert[] | null> {
  return fetchAlerts("https://api.weather.gov/alerts/active?area=LM&status=actual", "Lake Michigan marine");
}

/** Alerts covering a point — for LAND warnings (tornado, severe thunderstorm), which carry
 *  small polygons. NULL on failure. */
export async function getActiveAlerts(lat: number, lon: number): Promise<WeatherAlert[] | null> {
  const a = await fetchAlerts(`https://api.weather.gov/alerts/active?point=${lat},${lon}&status=actual`, `point ${lat},${lon}`);
  return a === null ? null : sortAlerts(a);
}
