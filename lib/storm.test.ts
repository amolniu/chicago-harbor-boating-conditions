import { describe, it, expect } from "vitest";
import { classifyStorm, stormCellKey, StormHourly } from "./storm";
import { HARBORS, getHarbor } from "./harbors";

const H = 3600_000;

/** Build an hourly block starting "now", with per-hour cape/precip/gust. */
function hourly(now: number, cape: number[], precip: number[], gust: number[]): StormHourly {
  return { time: cape.map((_, i) => now + i * H), cape, precip, gustKt: gust };
}

const now = Date.UTC(2026, 6, 24, 18, 0, 0);

describe("classifyStorm", () => {
  it("calm, dry air → none", () => {
    const o = classifyStorm(hourly(now, Array(12).fill(40), Array(12).fill(0), Array(12).fill(8)), now);
    expect(o.level).toBe("none");
    expect(o.stormyHours).toHaveLength(0);
    expect(o.capeNow).toBe(40);
  });

  it("convective rain now → active", () => {
    const cape = [1200, 1000, 200, ...Array(9).fill(50)];
    const precip = [1.0, 0.6, 0, ...Array(9).fill(0)];
    const o = classifyStorm(hourly(now, cape, precip, Array(12).fill(10)), now);
    expect(o.level).toBe("active");
    expect(o.stormyHours.length).toBeGreaterThan(0);
  });

  it("storms building in a few hours → elevated", () => {
    const cape = [100, 200, 400, 1600, 1700, 900, ...Array(6).fill(100)];
    const precip = [0, 0, 0.1, 0.5, 0.4, 0.1, ...Array(6).fill(0)];
    const o = classifyStorm(hourly(now, cape, precip, Array(12).fill(12)), now);
    expect(o.level).toBe("elevated");
  });

  it("unstable air but no rain → watch", () => {
    const o = classifyStorm(hourly(now, Array(12).fill(900), Array(12).fill(0), Array(12).fill(10)), now);
    expect(o.level).toBe("watch");
  });

  it("gust-driven squall risk → watch", () => {
    const gust = [12, 30, 14, ...Array(9).fill(10)];
    const o = classifyStorm(hourly(now, Array(12).fill(100), Array(12).fill(0), gust), now);
    expect(o.level).toBe("watch");
    expect(o.gustPeakKt).toBe(30);
  });

  // Regression: real HRRR output for Chicago on 2026-08-13. CAPE peaks mid-afternoon
  // and has collapsed to ZERO by the time the line arrives in the evening — which is
  // normal, convection consumes it. The original rule required CAPE >= 500 AND rain, so
  // it reported no stormy hours at all through 13 mm/h rain with 19 kt gusts.
  it("catches a squall line whose CAPE has already collapsed", () => {
    const cape = [210, 140, 490, 980, 570, 330, 360, 250, 0, 0, 0, 0];
    const precip = [0, 0, 0, 0, 0, 0.4, 0, 0.4, 7.6, 13.3, 2.2, 4.3];
    const gust = [4, 8, 7, 6, 9, 17, 8, 10, 10, 19, 14, 17];
    const o = classifyStorm(hourly(now, cape, precip, gust), now);
    expect(o.stormyHours.length, "the evening rain hours must be flagged").toBeGreaterThan(0);
    expect(o.level).not.toBe("none");
  });

  it("does not treat drizzle on stable air as a storm", () => {
    // Guard the other direction: light rain with no instability is just rain.
    const o = classifyStorm(
      hourly(now, Array(12).fill(0), Array(12).fill(0.3), Array(12).fill(8)),
      now,
    );
    expect(o.stormyHours).toHaveLength(0);
  });

  it("localizes the headline hour to the harbor's timezone", () => {
    const cape = [100, 200, 400, 1600, 1700, 900, ...Array(6).fill(100)];
    const precip = [0, 0, 0.1, 0.5, 0.4, 0.1, ...Array(6).fill(0)];
    const h = hourly(now, cape, precip, Array(12).fill(12));
    // Same storm, one hour apart in local time: Chicago is Central, Michigan Eastern.
    expect(classifyStorm(h, now, "America/Chicago").headline).toContain("4 PM");
    expect(classifyStorm(h, now, "America/Detroit").headline).toContain("5 PM");
  });
});

// Thunderstorms are mesoscale: harbors close together may share one HRRR query, but
// distant ones must each get their own, or a storm is either invented or missed.
describe("stormCellKey", () => {
  it("groups harbors that are close together", () => {
    const belmont = getHarbor("belmont")!;
    const dusable = getHarbor("dusable")!;
    expect(stormCellKey(belmont.lat, belmont.lon)).toBe(stormCellKey(dusable.lat, dusable.lon));
  });

  it("separates harbors in different parts of the lake", () => {
    const belmont = getHarbor("belmont")!;
    const escanaba = getHarbor("escanaba")!; // ~430 km north, was sharing Chicago's outlook
    const whitehall = getHarbor("whitehall")!; // other shore
    expect(stormCellKey(belmont.lat, belmont.lon)).not.toBe(stormCellKey(escanaba.lat, escanaba.lon));
    expect(stormCellKey(belmont.lat, belmont.lon)).not.toBe(stormCellKey(whitehall.lat, whitehall.lon));
  });

  it("collapses the fleet to far fewer query points than harbors", () => {
    const cells = new Set(HARBORS.map((h) => stormCellKey(h.lat, h.lon)));
    expect(cells.size).toBeGreaterThan(1);
    expect(cells.size).toBeLessThan(HARBORS.length);
  });
});
