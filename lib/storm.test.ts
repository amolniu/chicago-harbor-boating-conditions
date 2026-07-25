import { describe, it, expect } from "vitest";
import { classifyStorm, StormHourly } from "./storm";

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
});
