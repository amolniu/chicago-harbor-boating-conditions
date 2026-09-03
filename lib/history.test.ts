import { describe, it, expect } from "vitest";
import {
  circularMeanDeg,
  worstAdvisory,
  summarizeAfternoons,
  rateDay,
  greenStreak,
  roughnessPercentile,
  type DaySummary,
} from "./history";
import { getHarbor } from "./harbors";
import { getBoat } from "./boats";

const belmont = getHarbor("belmont")!;
const catalina = getBoat("catalina30"); // wind calm/max 15/25 kt at intermediate

/** Wind-only day: waves/dir null, so the rating reduces to the wind metric alone —
 *  deterministic without re-deriving the whole engine in the test. */
function day(date: string, windKt: number | null, extra: Partial<DaySummary> = {}): DaySummary {
  return {
    date,
    windKt,
    gustKt: null,
    windDir: null,
    waveFt: null,
    wavePeriodS: null,
    waveDir: null,
    waterTempF: null,
    advisory: "none",
    samples: 12,
    ...extra,
  };
}

describe("circularMeanDeg", () => {
  it("averages across north correctly", () => {
    // The naive mean of 350 and 10 is 180 — due south, the exact opposite.
    expect(circularMeanDeg([350, 10])).toBeCloseTo(0, 5);
  });
  it("handles empty and fully-cancelling inputs", () => {
    expect(circularMeanDeg([])).toBeNull();
    expect(circularMeanDeg([0, 180])).toBeNull();
  });
});

describe("worstAdvisory", () => {
  it("keeps the most severe of the afternoon", () => {
    expect(worstAdvisory(["none", "small_craft", "none"])).toBe("small_craft");
    expect(worstAdvisory(["small_craft", "gale"])).toBe("gale");
    expect(worstAdvisory([])).toBe("none");
  });
});

describe("summarizeAfternoons", () => {
  it("groups by LOCAL day, averages, and sorts newest first", () => {
    // 18:30Z and 19:30Z on Jul 10 are 1:30/2:30 PM in Chicago (CDT = UTC-5).
    const rows = [
      { takenAt: new Date("2026-07-10T18:30:00Z"), windKt: 10, windDir: 350, gustKt: 12, waveFt: 1, wavePeriodS: 3, waveDir: 90, waterTempF: 70, advisory: "none" },
      { takenAt: new Date("2026-07-10T19:30:00Z"), windKt: 14, windDir: 10, gustKt: 16, waveFt: 2, wavePeriodS: 3, waveDir: 90, waterTempF: 70, advisory: "small_craft" },
      { takenAt: new Date("2026-07-11T18:30:00Z"), windKt: 6, windDir: 90, gustKt: null, waveFt: null, wavePeriodS: null, waveDir: null, waterTempF: null, advisory: "none" },
    ];
    const days = summarizeAfternoons(rows, "America/Chicago");
    expect(days.map((d) => d.date)).toEqual(["2026-07-11", "2026-07-10"]);
    const jul10 = days[1];
    expect(jul10.windKt).toBe(12);
    expect(jul10.windDir).toBeCloseTo(0, 5); // circular, not (350+10)/2
    expect(jul10.advisory).toBe("small_craft");
    expect(jul10.samples).toBe(2);
    expect(days[0].waveFt).toBeNull(); // missing fields stay null, not 0
  });
});

describe("rateDay", () => {
  it("re-rates a day for the given boat, and refuses windless days", () => {
    expect(rateDay(day("2026-07-10", 5), belmont, catalina, "intermediate").status).toBe("green");
    expect(rateDay(day("2026-07-10", 30), belmont, catalina, "intermediate").status).toBe("red");
    expect(rateDay(day("2026-07-10", null), belmont, catalina, "intermediate").status).toBe("unknown");
  });
  it("is personalized: the same day rates differently by boat", () => {
    const d = day("2026-07-10", 16);
    const kayak = rateDay(d, belmont, getBoat("kayak-sup"), "intermediate");
    const cruiser = rateDay(d, belmont, getBoat("beneteau40"), "intermediate");
    expect(kayak.status).toBe("red");
    expect(cruiser.status).toBe("green");
  });
});

describe("greenStreak", () => {
  it("counts the last N days before today, skipping unratable days", () => {
    const days = [
      day("2026-07-12", 5), // today — excluded
      day("2026-07-11", 5),
      day("2026-07-10", 30),
      day("2026-07-09", null), // unratable — skipped, not counted as failure
      day("2026-07-08", 5),
    ];
    const s = greenStreak(days, belmont, catalina, "intermediate", "2026-07-12", 10);
    expect(s.green).toBe(2);
    expect(s.rated).toBe(3);
    expect(s.window).toBe(10);
  });
});

describe("roughnessPercentile", () => {
  const july = (n: number, windKt: number) => day(`2026-07-${String(n).padStart(2, "0")}`, windKt);

  it("stays silent until there is enough history", () => {
    const days = [july(12, 20), july(11, 5), july(10, 5)];
    expect(roughnessPercentile(days, belmont, catalina, "intermediate", "2026-07-12")).toBeNull();
  });

  it("ranks today against same-month afternoons", () => {
    // 6 calm (score 100) + 3 stormy (score 0) + today at 20 kt (score 50):
    // 6 of 9 comparison days were calmer.
    const days = [
      july(12, 20),
      ...[1, 2, 3, 4, 5, 6].map((n) => july(n, 5)),
      ...[7, 8, 9].map((n) => july(n, 30)),
    ];
    const p = roughnessPercentile(days, belmont, catalina, "intermediate", "2026-07-12")!;
    expect(p.roughness).toBe(67);
    expect(p.bucketLabel).toBe("July afternoons");
    expect(p.comparedDays).toBe(9);
  });

  it("falls back to all recorded afternoons when the month is thin", () => {
    const days = [
      day("2026-07-12", 20), // today, July — but July history is empty
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => day(`2026-06-${String(n).padStart(2, "0")}`, 5)),
    ];
    const p = roughnessPercentile(days, belmont, catalina, "intermediate", "2026-07-12")!;
    expect(p.bucketLabel).toBe("recorded afternoons");
    expect(p.roughness).toBe(100); // every June day was calmer
  });

  it("returns null when today has no summary yet", () => {
    const days = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => july(n, 5));
    expect(roughnessPercentile(days, belmont, catalina, "intermediate", "2026-07-12")).toBeNull();
  });
});
