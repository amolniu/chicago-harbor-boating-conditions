import { describe, it, expect } from "vitest";
import { rate, forecastWindGap, lostSourceNote } from "./rating";
import { getHarbor, HARBORS } from "./harbors";
import { getBoat } from "./boats";
import { classifyAlert } from "./alerts";
import { Conditions } from "./types";

function cond(p: Partial<Conditions>): Conditions {
  return {
    windDir: 45, windKt: 10, gustKt: 12, waveFt: 1, wavePeriodS: 4, waveDir: 45,
    waterTempF: 65, airTempF: 70, advisory: "none", source: "test", observedAt: null,
    ...p,
  };
}

const belmont = getHarbor("belmont")!;
const burnham = getHarbor("burnham")!;
const monroe = getHarbor("monroe")!;
const catalina = getBoat("catalina30");

describe("a harbor that has lost its own wind source tops out at Caution", () => {
  // A light, sheltered day that would be green on an observation.
  const calm = { windDir: 250, windKt: 6, gustKt: 8, waveFt: 0.5 };
  const kewaunee = getHarbor("kewaunee")!; // model-only by design
  const escanaba = getHarbor("escanaba")!; // Bay de Noc Spotter
  const daysailer = getBoat("daysailer");

  it("its own buoy out of the water ⇒ the forecast model ⇒ capped at 59, and says why", () => {
    const observed = rate(belmont, cond({ ...calm, windBasis: "station", source: "45198" }), daysailer, "intermediate");
    expect(observed.status).toBe("green");
    const r = rate(belmont, cond({ ...calm, windBasis: "model", source: "NWS model" }), daysailer, "intermediate");
    expect(r.status).toBe("yellow");
    expect(r.score).toBe(59);
    expect(r.limiter).toBe("forecast-model wind");
    expect(r.reason).toMatch(/45198 isn't reporting/);
    expect(r.reason).toMatch(/forecast model/);
    expect(forecastWindGap(belmont, cond({ windBasis: "model" }))).toBe("45198");
  });

  it("a Spotter harbor whose Spotter is pulled is capped the same way, naming the Spotter", () => {
    const r = rate(escanaba, cond({ ...calm, windBasis: "model", source: "NWS model" }), daysailer, "intermediate");
    expect(r.score).toBe(59);
    expect(r.reason).toMatch(/Bay de Noc Spotter isn't reporting/);
  });

  it("a harbor that is model-only BY DESIGN is not capped — nothing was lost", () => {
    const r = rate(kewaunee, cond({ ...calm, windBasis: "model", source: "NWS model" }), daysailer, "intermediate");
    expect(forecastWindGap(kewaunee, cond({ windBasis: "model" }))).toBeNull();
    expect(r.status).toBe("green");
  });

  it("a measured same-shore neighbour is not the model, and is not capped", () => {
    const r = rate(belmont, cond({ ...calm, windBasis: "neighbor", source: "CHII2" }), daysailer, "intermediate");
    expect(r.status).toBe("green");
  });

  it("history (no windBasis) is never capped, so past afternoons keep their real ratings", () => {
    expect(rate(belmont, cond({ ...calm }), daysailer, "intermediate").status).toBe("green");
  });

  it("when something worse limits, the reason names it AND notes the wind is a forecast", () => {
    const r = rate(belmont, cond({ windDir: 45, windKt: 20, gustKt: 26, waveFt: 4, windBasis: "model" }), daysailer, "intermediate");
    expect(r.status).toBe("red");
    expect(r.limiter).not.toBe("forecast-model wind");
    expect(r.reason).toMatch(/forecast model: 45198 isn't reporting/);
  });

  it("never blames the season for a FIXED station going quiet", () => {
    // Menominee's MNMM4 is a fixed CO-OPS station: if it is silent, something broke.
    // "Seasonal buoys come out in the fall" would explain a fault away.
    const menominee = getHarbor("menominee")!;
    expect(lostSourceNote(menominee)).toBeNull();
    const r = rate(menominee, cond({ ...calm, windBasis: "model", source: "NWS model" }), daysailer, "intermediate");
    expect(r.score).toBe(59);
    expect(r.reason).toMatch(/MNMM4 isn't reporting, so/);
    expect(r.reason).not.toMatch(/seasonal|out of the water/);
    // ...whereas a seasonal buoy and a Spotter say what they are.
    expect(lostSourceNote(belmont)).toMatch(/seasonal buoy/);
    expect(lostSourceNote(escanaba)).toMatch(/Spotters come out of the water/);
  });

  it("NWS warnings that couldn't be checked cap at Caution and say so (decided 2026-10-18)", () => {
    const r = rate(belmont, cond({ ...calm, warningsUnavailable: true }), daysailer, "intermediate");
    expect(r.score).toBe(59);
    expect(r.limiter).toBe("NWS warnings unavailable");
    expect(r.reason).toMatch(/couldn't be checked/);
    // ...and when something else is worse, the reason still says the warnings are unknown.
    const rough = rate(belmont, cond({ windDir: 45, windKt: 20, gustKt: 26, waveFt: 4, warningsUnavailable: true }), daysailer, "intermediate");
    expect(rough.status).toBe("red");
    expect(rough.reason).toMatch(/NWS warnings couldn't be checked/);
  });

  it("doesn't tell you to check 'before you go' under a warning that says don't go", () => {
    const event = "Tornado Warning";
    const r = rate(belmont, cond({ ...calm, warningsUnavailable: true, alerts: [{ event, headline: null, level: classifyAlert(event), ends: null }] }), daysailer, "intermediate");
    expect(r.score).toBe(0);
    expect(r.reason).not.toMatch(/before you go/);
    const gale = rate(belmont, cond({ ...calm, warningsUnavailable: true, advisory: "gale" }), daysailer, "intermediate");
    expect(gale.reason).not.toMatch(/before you go/);
  });

  it("a WATCH-level cap names the watch instead of printing wind copy", () => {
    const event = "Tornado Watch";
    const r = rate(belmont, cond({ ...calm, alerts: [{ event, headline: null, level: classifyAlert(event), ends: null }] }), daysailer, "intermediate");
    expect(r.score).toBe(45);
    expect(r.reason).toMatch(/^Tornado Watch in effect/);
    expect(r.reason).not.toMatch(/wind pushing/);
  });

  it("a stop-level warning still pins it to 0 and leads, with no footnote", () => {
    const event = "Special Marine Warning";
    const warn = { event, headline: "Waterspouts possible", level: classifyAlert(event), ends: null };
    const r = rate(belmont, cond({ ...calm, windBasis: "model", alerts: [warn] }), daysailer, "intermediate");
    expect(r.score).toBe(0);
    expect(r.reason).toMatch(/^Special Marine Warning in effect/);
    expect(r.reason).not.toMatch(/forecast model/);
  });
});

describe("harbor-specific exit vs open (the core value prop)", () => {
  const neBlow = cond({ windDir: 45, windKt: 14, gustKt: 17, waveFt: 3.5 });

  it("Belmont: NE wind makes the EXIT the crux even when the open lake is fine", () => {
    const r = rate(belmont, neBlow, catalina, "intermediate");
    expect(r.status).toBe("red");
    expect(r.exitScore).toBeLessThan(r.openScore); // exit is worse than open water
    expect(r.limiter).toMatch(/exit/i);
    expect(r.reason).toMatch(/entrance|breakwall|exit/i);
  });

  it("Burnham: the SAME lake conditions stay sailable behind its shelter", () => {
    const r = rate(burnham, neBlow, catalina, "intermediate");
    expect(r.status).toBe("green");
    expect(r.exitScore).toBeGreaterThan(80); // sheltered entrance
  });

  it("Belmont is materially worse than Burnham in the same NE blow", () => {
    const b = rate(belmont, neBlow, catalina, "intermediate").score;
    const u = rate(burnham, neBlow, catalina, "intermediate").score;
    expect(u).toBeGreaterThan(b);
  });
});

describe("boat personalization", () => {
  const breezy = cond({ windDir: 90, windKt: 16, gustKt: 20, waveFt: 2 });
  it("16 kt is red for a kayak but green for a Beneteau 40", () => {
    expect(rate(monroe, breezy, getBoat("kayak-sup"), "intermediate").status).toBe("red");
    expect(rate(monroe, breezy, getBoat("beneteau40"), "intermediate").status).toBe("green");
  });
});

describe("skill modifier", () => {
  const marginal = cond({ windDir: 90, windKt: 15, gustKt: 18, waveFt: 2.5 });
  it("advanced sailors get a greener read than beginners in the same conditions", () => {
    const beginner = rate(monroe, marginal, catalina, "beginner").score;
    const advanced = rate(monroe, marginal, catalina, "advanced").score;
    expect(advanced).toBeGreaterThan(beginner);
  });
});

describe("advisory caps", () => {
  const calmButAdvised = cond({ windDir: 90, windKt: 8, gustKt: 10, waveFt: 1, advisory: "small_craft" });

  it("regression: an SCA over calm water is NOT a score-100 red — the score reflects the cap", () => {
    const r = rate(monroe, calmButAdvised, catalina, "beginner");
    expect(r.status).toBe("red");
    expect(r.score).toBeLessThan(30); // was reporting 100 while red — the bug
    expect(r.reason).toMatch(/small craft advisory/i);
  });

  it("Small Craft Advisory caps a beginner at red, an intermediate at yellow", () => {
    expect(rate(monroe, calmButAdvised, catalina, "beginner").status).toBe("red");
    const inter = rate(monroe, calmButAdvised, catalina, "intermediate");
    expect(inter.status).toBe("yellow");
    expect(inter.score).toBeGreaterThanOrEqual(30);
    expect(inter.score).toBeLessThan(60);
  });

  it("a gale warning is red for everyone", () => {
    const gale = cond({ windKt: 8, waveFt: 1, advisory: "gale" });
    expect(rate(monroe, gale, getBoat("beneteau40"), "advanced").status).toBe("red");
  });
});

describe("exposure-aware advisory cap (breaks the SCA flat-line)", () => {
  // Calm water but a zone-wide Small Craft Advisory — the case that used to make
  // every harbor read the same score.
  const calmSCA = cond({ windDir: 45, windKt: 9, gustKt: 11, waveFt: 1.2, advisory: "small_craft" });

  it("a sheltered harbor scores higher than an exposed one under the same SCA", () => {
    const sheltered = rate(getHarbor("diversey")!, calmSCA, catalina, "intermediate");
    const exposed = rate(getHarbor("jackson-outer")!, calmSCA, catalina, "intermediate");
    expect(sheltered.score).toBeGreaterThan(exposed.score);
  });

  it("spreads scores across the harbors instead of flat-lining them", () => {
    const scores = HARBORS.map((h) => rate(h, calmSCA, catalina, "intermediate").score);
    expect(new Set(scores).size).toBeGreaterThanOrEqual(5);
  });
});

describe("a thunderstorm always leads the copy", () => {
  // The case that used to bury it: SCA up + storms likely. The storm cap is flat (45)
  // while a beginner's advisory cap drops to ~26 — so the advisory scored lower and
  // took the headline, hiding the storm from the least experienced sailor.
  const stormyAndAdvised = cond({
    windDir: 90, windKt: 9, gustKt: 11, waveFt: 1.2, advisory: "small_craft",
    storm: { level: "elevated", headline: "Thunderstorms likely around 2 PM — plan to be back before then.", capeNow: 900 },
  });

  it("names the storm at every skill level, not just where it scores lowest", () => {
    for (const skill of ["beginner", "intermediate", "advanced"] as const) {
      const r = rate(belmont, stormyAndAdvised, catalina, skill);
      expect(r.reason, skill).toMatch(/thunderstorm/i);
    }
  });

  it("still mentions the advisory alongside it", () => {
    const r = rate(belmont, stormyAndAdvised, catalina, "beginner");
    expect(r.reason).toMatch(/thunderstorm/i);
    expect(r.reason).toMatch(/small craft advisory/i);
  });

  it("an active storm leads even for an advanced sailor on a big boat", () => {
    const active = cond({
      windDir: 90, windKt: 8, gustKt: 10, waveFt: 1,
      storm: { level: "active", headline: "Thunderstorms in the area now — stay in until they clear.", capeNow: 1800 },
    });
    const r = rate(burnham, active, getBoat("beneteau40"), "advanced");
    expect(r.reason).toMatch(/thunderstorm/i);
    expect(r.status).toBe("red");
  });

  it("a mere 'watch' does not hijack the headline (it doesn't cap the score)", () => {
    const watch = cond({
      windDir: 45, windKt: 14, gustKt: 17, waveFt: 3.5,
      storm: { level: "watch", headline: "Unstable air — isolated pop-up storms possible.", capeNow: 800 },
    });
    expect(rate(belmont, watch, catalina, "intermediate").reason).not.toMatch(/unstable air/i);
  });

  it("copy only — the score and status are unchanged", () => {
    const withStorm = rate(belmont, stormyAndAdvised, catalina, "beginner");
    const { storm, ...noStormFields } = stormyAndAdvised;
    void storm;
    // Same conditions minus the storm: the beginner's advisory cap still binds at 26.
    const withoutStorm = rate(belmont, noStormFields as Conditions, catalina, "beginner");
    expect(withStorm.score).toBeLessThanOrEqual(withoutStorm.score);
    expect(withStorm.status).toBe("red");
  });
});

// The gap this closed: the app knew weather only through the HRRR model and the marine
// zone text. Neither carries a Tornado Warning, so one could be active beside the harbor
// while the score sat green.
describe("an NWS warning is an absolute stop", () => {
  const warned = (event: string, extra: Partial<Conditions> = {}) =>
    cond({
      windDir: 90, windKt: 4, gustKt: 5, waveFt: 0.3, // otherwise a perfect day
      alerts: [{ event, headline: "Take shelter now.", level: classifyAlert(event), ends: null }],
      ...extra,
    });

  it("pins the score to zero on flat calm water, for every boat and skill", () => {
    for (const boat of ["kayak-sup", "catalina30", "beneteau40"]) {
      for (const skill of ["beginner", "intermediate", "advanced"] as const) {
        const r = rate(burnham, warned("Tornado Warning"), getBoat(boat), skill);
        expect(r.score, `${boat}/${skill}`).toBe(0);
        expect(r.status, `${boat}/${skill}`).toBe("red");
      }
    }
  });

  it("outranks a calm forecast in the copy", () => {
    const r = rate(burnham, warned("Tornado Warning"), catalina, "intermediate");
    expect(r.reason).toMatch(/tornado warning/i);
    expect(r.reason).toMatch(/do not go out/i);
  });

  it("also stops for a severe thunderstorm or special marine warning", () => {
    for (const e of ["Severe Thunderstorm Warning", "Special Marine Warning"]) {
      expect(rate(burnham, warned(e), getBoat("beneteau40"), "advanced").score, e).toBe(0);
    }
  });

  it("a watch cautions without stopping, and an advisory does neither", () => {
    const watch = rate(burnham, warned("Tornado Watch"), catalina, "intermediate");
    expect(watch.score).toBeGreaterThan(0);
    expect(watch.score).toBeLessThan(60);
    // A heat advisory has nothing to do with being on the water.
    expect(rate(burnham, warned("Heat Advisory"), catalina, "intermediate").score).toBeGreaterThan(60);
  });

  it("beats the storm model, which previously capped at 8 rather than 0", () => {
    const both = warned("Tornado Warning", {
      storm: { level: "active", headline: "Thunderstorms in the area now.", capeNow: 2000 },
    });
    expect(rate(burnham, both, catalina, "intermediate").score).toBe(0);
    expect(rate(burnham, both, catalina, "intermediate").reason).toMatch(/tornado/i);
  });
});

describe("invariant: score and status always agree", () => {
  it("holds across a grid of conditions, boats, and skills", () => {
    const skills = ["beginner", "intermediate", "advanced"] as const;
    for (const advisory of ["none", "small_craft", "gale"] as const) {
      for (const windKt of [4, 12, 20, 30]) {
        for (const waveFt of [0.5, 2, 4]) {
          const c = cond({ windDir: 45, windKt, gustKt: windKt * 1.3, waveFt, advisory });
          for (const boat of ["kayak-sup", "catalina30", "beneteau40"]) {
            for (const skill of skills) {
              const r = rate(belmont, c, getBoat(boat), skill);
              if (r.status === "green") expect(r.score).toBeGreaterThanOrEqual(60);
              else if (r.status === "yellow") {
                expect(r.score).toBeGreaterThanOrEqual(30);
                expect(r.score).toBeLessThan(60);
              } else if (r.status === "red") expect(r.score).toBeLessThan(30);
            }
          }
        }
      }
    }
  });
});

describe("missing data", () => {
  it("returns unknown when wind is unavailable", () => {
    const r = rate(monroe, cond({ windKt: null }), catalina, "intermediate");
    expect(r.status).toBe("unknown");
  });
});
