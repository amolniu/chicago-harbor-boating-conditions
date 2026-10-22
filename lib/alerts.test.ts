import { describe, it, expect, vi, afterEach } from "vitest";
import {
  classifyAlert,
  worstAlertLevel,
  parseVtec,
  parseAlertFeature,
  activeAt,
  overlaps,
  resolveHazards,
  advisoryForVtec,
  getMarineAlerts,
  clearAlertsCache,
  type WeatherAlert,
} from "./alerts";
import { getHarbor } from "./harbors";

const mk = (event: string): WeatherAlert => ({ event, headline: null, level: classifyAlert(event), ends: null });

describe("classifyAlert", () => {
  it("treats life-threatening warnings as a hard stop", () => {
    for (const e of [
      "Tornado Warning",
      "Severe Thunderstorm Warning",
      "Special Marine Warning",
      "Hurricane Force Wind Warning",
    ]) {
      expect(classifyAlert(e), e).toBe("stop");
    }
  });

  it("treats watches as caution, not a stop", () => {
    expect(classifyAlert("Tornado Watch")).toBe("watch");
    expect(classifyAlert("Severe Thunderstorm Watch")).toBe("watch");
  });

  it("does not let a watch masquerade as its warning", () => {
    // Substring matching would classify "Tornado Watch" as a stop — the whole point of
    // the distinction is that a watch is not a warning.
    expect(classifyAlert("Tornado Watch")).not.toBe("stop");
  });

  it("keeps unrelated alerts informational so they never distort the score", () => {
    for (const e of ["Heat Advisory", "Lakeshore Flood Warning", "Air Quality Alert", "Special Weather Statement"]) {
      expect(classifyAlert(e), e).toBe("info");
    }
  });
});

describe("worstAlertLevel", () => {
  it("reports the most constraining level present", () => {
    expect(worstAlertLevel([mk("Heat Advisory"), mk("Tornado Warning")])).toBe("stop");
    expect(worstAlertLevel([mk("Heat Advisory"), mk("Tornado Watch")])).toBe("watch");
    expect(worstAlertLevel([mk("Heat Advisory")])).toBe("info");
  });

  it("is informational when there is nothing active", () => {
    expect(worstAlertLevel([])).toBe("info");
    expect(worstAlertLevel(undefined)).toBe("info");
  });
});

// ── Marine alerts by zone, with real start/end times (rework of 2026-10-18) ─────────────

const H = 3600_000;
const NOW = Date.UTC(2026, 9, 18, 18, 0); // 1 PM CDT
const iso = (t: number) => new Date(t).toISOString();

/** An NWS alert feature, shaped like /alerts/active (fields trimmed to what we read). */
function feature(p: {
  id?: string; event: string; vtec?: string; ugc: string[]; onset?: number | null; ends?: number | null;
  expires?: number; messageType?: string;
}) {
  return {
    properties: {
      id: p.id ?? `urn:${p.event}:${p.ugc.join(",")}:${p.onset ?? "now"}`,
      event: p.event,
      headline: `${p.event} issued`,
      messageType: p.messageType ?? "Alert",
      onset: p.onset == null ? null : iso(p.onset),
      ends: p.ends == null ? null : iso(p.ends),
      expires: p.expires == null ? null : iso(p.expires),
      geocode: { UGC: p.ugc },
      parameters: p.vtec ? { VTEC: [p.vtec] } : {},
    },
  };
}
const SCA = (ugc: string[], onset: number | null, ends: number, extra: object = {}) =>
  parseAlertFeature(feature({ event: "Small Craft Advisory", vtec: "/O.CON.KLOT.SC.Y.0089.000000T0000Z-261019T0300Z/", ugc, onset, ends, ...extra }))!;

describe("reading NWS alert features", () => {
  it("parses the VTEC action and phenomenon", () => {
    expect(parseVtec("/O.CON.KGRB.SC.Y.0091.000000T0000Z-261019T0300Z/")).toEqual({ action: "CON", phenSig: "SC.Y" });
    expect(parseVtec("/O.UPG.KMHX.GL.W.0028.000000T0000Z-261017T1900Z/")).toEqual({ action: "UPG", phenSig: "GL.W" });
    expect(parseVtec(undefined)).toBeNull();
  });

  it("maps marine tiers by VTEC, and lets WATCHES cap nothing", () => {
    expect(advisoryForVtec("SC.Y")).toBe("small_craft");
    expect(advisoryForVtec("GL.W")).toBe("gale");
    expect(advisoryForVtec("SR.W")).toBe("storm");
    expect(advisoryForVtec("HF.W")).toBe("storm");
    expect(advisoryForVtec("GL.A"), "a gale watch is not a gale").toBeUndefined();
    expect(advisoryForVtec("MA.W"), "SMW is a stop-level warning, not an advisory tier").toBeUndefined();
  });

  it("drops cancellations and upgrades, even when NWS labels them 'Alert'", () => {
    // Seen live: a /O.UPG.KMHX.GL.W.../ segment still listed 16 h later as messageType Alert.
    expect(parseAlertFeature(feature({ event: "Gale Warning", vtec: "/O.UPG.KMHX.GL.W.0028.000000T0000Z-261017T1900Z/", ugc: ["LMZ741"], ends: NOW + H }))).toBeNull();
    expect(parseAlertFeature(feature({ event: "Gale Warning", vtec: "/O.CAN.KLOT.GL.W.0028.000000T0000Z-261017T1900Z/", ugc: ["LMZ741"], ends: NOW + H }))).toBeNull();
    expect(parseAlertFeature(feature({ event: "Gale Warning", ugc: ["LMZ741"], ends: NOW + H, messageType: "Cancel" }))).toBeNull();
  });

  it("uses `ends` for the hazard end, and `expires` only when there is no end", () => {
    const a = parseAlertFeature(feature({ event: "Small Craft Advisory", ugc: ["LMZ741"], ends: NOW + 9 * H, expires: NOW + H }))!;
    expect(a.ends).toBe(iso(NOW + 9 * H));
    const b = parseAlertFeature(feature({ event: "Special Weather Statement", ugc: ["ILZ014"], ends: null, expires: NOW + H }))!;
    expect(b.ends).toBe(iso(NOW + H));
  });

  it("knows when a hazard is in effect, and which hours it covers", () => {
    const scheduled = { onset: iso(NOW + 7 * H), ends: iso(NOW + 30 * H) };
    expect(activeAt(scheduled, NOW), "issued, not yet started").toBe(false);
    expect(activeAt(scheduled, NOW + 7 * H)).toBe(true);
    expect(activeAt(scheduled, NOW + 30 * H), "ends is exclusive").toBe(false);
    expect(overlaps(scheduled, NOW + 6 * H, NOW + 7 * H)).toBe(false);
    expect(overlaps(scheduled, NOW + 7 * H, NOW + 8 * H)).toBe(true);
  });
});

describe("resolving what applies to a harbor", () => {
  const belmont = getHarbor("belmont")!; // LMZ741
  const burnham = getHarbor("burnham")!; // LMZ742 + boundary LMZ741
  const kewaunee = getHarbor("kewaunee")!; // LMZ542, point on land

  it("matches zone alerts to the harbor's zones — the point query never could (2026-10-17)", () => {
    // Kewaunee's point is on land, in no marine zone: the point query returned nothing
    // while LMZ542 had a Small Craft Advisory in effect.
    const r = resolveHazards(kewaunee, [SCA(["LMZ542", "LMZ543"], null, NOW + 9 * H)], [], "none", NOW);
    expect(r.advisory).toBe("small_craft");
    expect(r.warningsUnavailable).toBe(false);
    expect(resolveHazards(belmont, [SCA(["LMZ542"], null, NOW + 9 * H)], [], "none", NOW).advisory, "other zone").toBe("none");
  });

  it("a boundary harbor counts its neighbouring zone too", () => {
    expect(resolveHazards(burnham, [SCA(["LMZ741"], null, NOW + 9 * H)], [], "none", NOW).advisory).toBe("small_craft");
  });

  it("a SCHEDULED advisory does not cap yet, but is on the timeline", () => {
    // The text product says "IN EFFECT FROM 8 PM" with no parseable time and used to cap
    // from issuance. The API's onset says exactly when.
    const r = resolveHazards(belmont, [SCA(["LMZ741"], NOW + 7 * H, NOW + 30 * H)], [], "small_craft", NOW);
    expect(r.advisory).toBe("none");
    expect(r.hazards).toHaveLength(1);
    expect(r.hazards[0].onset).toBe(iso(NOW + 7 * H));
  });

  it("an ENDED advisory stops capping at its end, not when the text is reissued", () => {
    const r = resolveHazards(belmont, [SCA(["LMZ741"], NOW - 9 * H, NOW - 1)], [], "small_craft", NOW);
    expect(r.advisory).toBe("none");
  });

  it("a Special Marine Warning anywhere in the zone counts for the whole zone (decided 2026-10-18)", () => {
    const smw = parseAlertFeature(feature({ event: "Special Marine Warning", vtec: "/O.NEW.KLOT.MA.W.0042.261018T1800Z-261018T1900Z/", ugc: ["LMZ741"], ends: NOW + H }))!;
    const r = resolveHazards(belmont, [smw], [], "none", NOW);
    expect(r.alerts[0].event).toBe("Special Marine Warning");
    expect(r.alerts[0].level).toBe("stop");
  });

  it("shows an advisory once — as the advisory, not again as an alert pill", () => {
    // The point query also returns zone advisories for harbors whose point IS in a zone:
    // the same id from both queries, and an advisory tier, must not double up.
    const sca = SCA(["LMZ741"], null, NOW + 9 * H, { id: "urn:same" });
    const r = resolveHazards(belmont, [sca], [sca], "none", NOW);
    expect(r.advisory).toBe("small_craft");
    expect(r.alerts).toHaveLength(0);
    expect(r.hazards).toHaveLength(1);
  });

  it("keeps land warnings from the point query, most constraining first", () => {
    const watch = { event: "Tornado Watch", headline: null, level: "watch" as const, ends: iso(NOW + 3 * H), id: "w" };
    const warn = { event: "Severe Thunderstorm Warning", headline: null, level: "stop" as const, ends: iso(NOW + H), id: "s" };
    const r = resolveHazards(belmont, [], [watch, warn], "none", NOW);
    expect(r.alerts.map((a) => a.level)).toEqual(["stop", "watch"]);
  });

  it("a FAILED fetch is never 'all clear'", () => {
    const marineDown = resolveHazards(belmont, null, [], "small_craft", NOW);
    expect(marineDown.warningsUnavailable).toBe(true);
    expect(marineDown.advisory, "falls back to the nearshore text").toBe("small_craft");
    expect(resolveHazards(belmont, [], null, "none", NOW).warningsUnavailable).toBe(true);
  });
});

describe("review fixes (2026-10-18)", () => {
  const belmont = getHarbor("belmont")!;
  const grandHaven = getHarbor("grand-haven")!; // LMZ846 + boundary LMZ847

  it("a Hurricane Force Wind Warning stays a STOP alert, not just the storm tier", () => {
    const hf = parseAlertFeature(feature({ event: "Hurricane Force Wind Warning", vtec: "/O.NEW.KLOT.HF.W.0001.000000T0000Z-261019T0300Z/", ugc: ["LMZ741"], ends: NOW + 6 * H }))!;
    const r = resolveHazards(belmont, [hf], [], "none", NOW);
    expect(r.advisory).toBe("storm");
    expect(r.alerts.map((a) => a.level)).toContain("stop");
  });

  it("one advisory split into two zone segments is ONE hazard", () => {
    // GRR issues one SCA as segments LMZ844-846 and LMZ847-849 with different ids;
    // Grand Haven straddles them.
    const a = SCA(["LMZ844", "LMZ845", "LMZ846"], NOW + 3 * H, NOW + 9 * H, { id: "seg-2" });
    const b = SCA(["LMZ847", "LMZ848", "LMZ849"], NOW + 3 * H, NOW + 9 * H, { id: "seg-1" });
    expect(resolveHazards(grandHaven, [a, b], [], "none", NOW).hazards).toHaveLength(1);
  });

  it("a scheduled WATCH shows on the timeline but caps nothing", () => {
    const watch = parseAlertFeature(feature({ event: "Gale Watch", vtec: "/O.NEW.KLOT.GL.A.0005.261019T1200Z-261020T0000Z/", ugc: ["LMZ741"], onset: NOW + 18 * H, ends: NOW + 30 * H }))!;
    const r = resolveHazards(belmont, [watch], [], "none", NOW);
    expect(r.advisory).toBe("none");
    expect(r.alerts).toHaveLength(0);
    expect(r.hazards.map((z) => z.event)).toEqual(["Gale Watch"]);
  });

  it("with the marine feed down, the text advisory is on the timeline too (the window must match the header)", () => {
    const r = resolveHazards(belmont, null, [], "small_craft", NOW);
    expect(r.hazards).toEqual([{ event: "Small Craft Advisory", level: "info", advisory: "small_craft", onset: null, ends: null }]);
  });
});

describe("the fetch layer: a failure is reported, never cached, never 'all clear'", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearAlertsCache();
  });
  const ok = (features: unknown[]) => ({ ok: true, status: 200, json: async () => ({ features }) });

  it("a failing feed returns NULL after exactly one retry", async () => {
    vi.useFakeTimers();
    const f = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    vi.stubGlobal("fetch", f);
    const p = getMarineAlerts();
    await vi.runAllTimersAsync();
    expect(await p).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("an HTML error page (NWS's CDN does this) is a failure, not an empty list", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } })));
    const p = getMarineAlerts();
    await vi.runAllTimersAsync();
    expect(await p).toBeNull();
  });

  it("asks NWS directly — not Next's cache, which serves the last good body during an outage", async () => {
    const f = vi.fn(async () => ok([]));
    vi.stubGlobal("fetch", f);
    await getMarineAlerts();
    expect((f.mock.calls[0] as unknown[])[1]).toMatchObject({ cache: "no-store" });
  });

  it("reuses a SUCCESS briefly, but never caches a failure", async () => {
    vi.useFakeTimers();
    const f = vi.fn(async () => ok([feature({ event: "Small Craft Advisory", ugc: ["LMZ741"], ends: Date.now() + H })]));
    vi.stubGlobal("fetch", f);
    expect(await getMarineAlerts()).toHaveLength(1);
    expect(await getMarineAlerts()).toHaveLength(1);
    expect(f, "second call within the TTL is served from memory").toHaveBeenCalledTimes(1);

    clearAlertsCache();
    const bad = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    vi.stubGlobal("fetch", bad);
    const p1 = getMarineAlerts();
    await vi.runAllTimersAsync();
    expect(await p1).toBeNull();
    const p2 = getMarineAlerts();
    await vi.runAllTimersAsync();
    expect(await p2).toBeNull();
    expect(bad, "the failure was not cached: both calls went out (2 attempts each)").toHaveBeenCalledTimes(4);
  });
});
