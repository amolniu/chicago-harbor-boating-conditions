import { describe, it, expect } from "vitest";
import { rate } from "./rating";
import { getHarbor, HARBORS } from "./harbors";
import { getBoat } from "./boats";
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
