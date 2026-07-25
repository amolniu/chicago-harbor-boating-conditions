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
