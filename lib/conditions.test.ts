import { describe, it, expect } from "vitest";
import { waveObsWeight } from "./conditions";

// The distance-weighted blend weight: how much an observed wave buoy leads the
// gridpoint model, as a function of the buoy's distance from the harbor. Encodes
// the design intent — closer buoys earn more trust, with hard floor/ceiling.
describe("waveObsWeight (distance-weighted observed-wave blend)", () => {
  it("full weight at the harbor, floor far out, clamped beyond both ends", () => {
    expect(waveObsWeight(0)).toBeCloseTo(0.85, 5); // at the mouth ⇒ near anchor
    expect(waveObsWeight(30)).toBeCloseTo(0.45, 5); // far anchor
    expect(waveObsWeight(50)).toBeCloseTo(0.45, 5); // never below the floor
    expect(waveObsWeight(-3)).toBeCloseTo(0.85, 5); // never above the ceiling
  });

  it("decreases with distance, linearly between the anchors", () => {
    expect(waveObsWeight(4)).toBeGreaterThan(waveObsWeight(19));
    expect(waveObsWeight(15)).toBeCloseTo(0.65, 5); // midpoint of 0.85 → 0.45
  });

  it("a close buoy earns clearly more weight than a marginal one, which still contributes", () => {
    expect(waveObsWeight(4)).toBeGreaterThan(0.75); // strong tier (≤7 km)
    expect(waveObsWeight(19)).toBeLessThan(0.7); // marginal tier (15–20 km)
    expect(waveObsWeight(19)).toBeGreaterThan(0.55); // but the model no longer dominates alone
  });
});

import { assemble } from "./conditions";
import { getHarbor } from "./harbors";
import type { GridCurrent } from "./nws";
import type { GlosCurrent } from "./glos";
import type { BuoyCurrent } from "./ndbc";
import { rate } from "./rating";
import { getBoat } from "./boats";

const GRID: GridCurrent = { waveFt: 1.2, wavePeriodS: 3, waveDir: 180, windKt: 6.2, gustKt: 9.1, windDir: 200 };
const SPOTTER: GlosCurrent = {
  waveFt: 1.1, wavePeriodS: 2.8, waveDir: 190, waterTempF: 66,
  windKt: 12.4, windObservedAt: "2026-09-02T12:00:00Z", observedAt: "2026-09-02T12:00:00Z",
};

// Escanaba: windFromGrid, no buoyStation, and a glos ref that declares windId.
const esc = getHarbor("escanaba")!;

describe("spotter spectral wind (glos windId)", () => {
  it("beats the model for speed, while direction stays with the model", () => {
    const c = assemble(esc, new Map(), GRID, "none", undefined, SPOTTER);
    expect(c.windKt).toBe(12.4);
    expect(c.windDir).toBe(200); // Spotters report no direction — the model's is kept
    expect(c.source).toBe("Bay de Noc Spotter");
    expect(c.observedAt).toBe("2026-09-02T12:00:00Z"); // an observation, not a nowcast
  });

  it("falls back to the model when the spotter wind is stale or absent", () => {
    const dark: GlosCurrent = { ...SPOTTER, windKt: null, windObservedAt: null };
    const c = assemble(esc, new Map(), GRID, "none", undefined, dark);
    expect(c.windKt).toBe(6.2);
    expect(c.source).toBe("NWS model");
    expect(c.observedAt).toBeNull();
  });

  it("keeps the model gust only when it exceeds the observed sustained wind", () => {
    const gusty = assemble(esc, new Map(), { ...GRID, gustKt: 18 }, "none", undefined, SPOTTER);
    expect(gusty.gustKt).toBe(18);
    // The under-reading model's 9.1 kt "gust" below the observed 12.4 kt is noise.
    const noise = assemble(esc, new Map(), GRID, "none", undefined, SPOTTER);
    expect(noise.gustKt).toBeNull();
  });

  it("is opt-in per platform: a glos ref without windId never supplies wind", () => {
    const kew = getHarbor("kewaunee")!; // ds 609 — waves + temp only
    const c = assemble(kew, new Map(), GRID, "none", undefined, SPOTTER);
    expect(c.windKt).toBe(6.2);
    expect(c.source).toBe("NWS model");
  });

  it("a real anemometer still beats the spotter", () => {
    const withBuoy = { ...esc, buoyStation: "TESTX" };
    const buoy: BuoyCurrent = {
      windDir: 90, windKt: 14, gustKt: 17, waveFt: null, wavePeriodS: null, waveDir: null,
      waterTempF: null, airTempF: null, observedAt: "2026-09-02T12:10:00Z", station: "TESTX",
    };
    const c = assemble(withBuoy, new Map([["TESTX", buoy]]), GRID, "none", undefined, SPOTTER);
    expect(c.windKt).toBe(14);
    expect(c.source).toBe("TESTX");
    expect(c.windDir).toBe(90);
  });
});

describe("wind field fallback (a station can lose one sensor and keep another)", () => {
  const bel = getHarbor("belmont")!; // buoyStation 45198, then WIND_FALLBACK

  const buoy = (station: string, over: Partial<BuoyCurrent>): BuoyCurrent => ({
    windDir: null, windKt: null, gustKt: null, waveFt: null, wavePeriodS: null, waveDir: null,
    waterTempF: null, airTempF: null, observedAt: "2026-09-03T23:00:00Z", station, ...over,
  });

  // The real 2026-09-03 state: 45198 reports speed on every row, WDIR/GST on none.
  const speedOnly = buoy("45198", { windKt: 7.8 });
  const fullNeighbour = buoy("CNII2", { windKt: 8.4, windDir: 45, gustKt: 12 });

  it("borrows direction and gust down the chain when the speed station has neither", () => {
    const c = assemble(bel, new Map([["45198", speedOnly], ["CNII2", fullNeighbour]]), GRID, "none", undefined);
    expect(c.windKt, "speed still comes from the nearest station").toBe(7.8);
    expect(c.windDir, "direction borrowed from the neighbour").toBe(45);
    expect(c.gustKt).toBe(12);
    expect(c.source).toBe("45198");
  });

  it("without a direction the rating turns OPTIMISTIC — the dangerous direction", () => {
    // The point of the fallback. In a real NE blow, Belmont's exposed entrance is the
    // hazard; with no windDir, exitWave and crosswind are skipped entirely and the
    // rating reports only open-lake comfort — hiding exactly what the app exists to warn about.
    const rough = { ...GRID, waveFt: 4, windKt: 18, gustKt: 22, windDir: 45 };
    const neNeighbour = buoy("CNII2", { windKt: 18, windDir: 45, gustKt: 22 });
    const withDir = assemble(bel, new Map([["45198", buoy("45198", { windKt: 18 })], ["CNII2", neNeighbour]]), rough, "none", undefined);
    const blind = assemble(bel, new Map([["45198", buoy("45198", { windKt: 18 })]]), { ...rough, windDir: null }, "none", undefined);

    expect(withDir.windDir).toBe(45);
    expect(blind.windDir).toBeNull(); // no station and no model direction

    const boat = getBoat("catalina30");
    const seeing = rate(bel, withDir, boat, "intermediate");
    const flying = rate(bel, blind, boat, "intermediate");
    expect(seeing.exitScore).toBeLessThan(flying.exitScore);
    expect(seeing.score).toBeLessThan(flying.score);
  });

  it("falls back to the model's direction when no station has one", () => {
    const c = assemble(bel, new Map([["45198", speedOnly]]), GRID, "none", undefined);
    expect(c.windDir).toBe(GRID.windDir);
  });

  it("drops a borrowed gust that is below the measured sustained wind", () => {
    const calmNeighbour = buoy("CNII2", { windKt: 3, windDir: 90, gustKt: 4 });
    const c = assemble(bel, new Map([["45198", buoy("45198", { windKt: 12 })], ["CNII2", calmNeighbour]]), GRID, "none", undefined);
    expect(c.windDir, "direction is still worth borrowing").toBe(90);
    expect(c.gustKt, "4 kt is not a gust on a 12 kt wind").toBeNull();
  });
});
