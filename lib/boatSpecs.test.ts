import { describe, it, expect } from "vitest";
import { BoatSpec, computeCSF, estimateAVS, deriveBoatProfile } from "./boatSpecs";

function spec(p: Partial<BoatSpec>): BoatSpec {
  return { id: "custom:t", name: "Test", category: "C", ...p };
}

describe("computeCSF", () => {
  it("matches the known formula (~2.0 for a Catalina 30)", () => {
    const csf = computeCSF(spec({ beamFt: 10.83, displacementLb: 10200 }))!;
    expect(csf).toBeGreaterThan(1.9);
    expect(csf).toBeLessThan(2.1);
  });
  it("is null without beam + displacement", () => {
    expect(computeCSF(spec({ beamFt: 10 }))).toBeNull();
  });
});

describe("estimateAVS", () => {
  it("uses the override when provided", () => {
    expect(estimateAVS(spec({ avsOverride: 128 }))).toBe(128);
  });
  it("estimates from dimensions and lands in a sane range", () => {
    const avs = estimateAVS(spec({ beamFt: 10.83, displacementLb: 10200, ballastLb: 4200, draftFt: 5.3 }))!;
    expect(avs).toBeGreaterThanOrEqual(80);
    expect(avs).toBeLessThanOrEqual(150);
  });
  it("is null without the required dimensions", () => {
    expect(estimateAVS(spec({ beamFt: 10, displacementLb: 10000 }))).toBeNull();
  });
});

describe("deriveBoatProfile", () => {
  it("category alone drives the thresholds (bigger category → higher limits)", () => {
    const d = deriveBoatProfile(spec({ category: "D" }));
    const c = deriveBoatProfile(spec({ category: "C" }));
    const a = deriveBoatProfile(spec({ category: "A" }));
    expect(d.windMaxKt).toBeLessThan(c.windMaxKt);
    expect(c.windMaxKt).toBeLessThan(a.windMaxKt);
    expect(d.waveMaxFt).toBeLessThan(a.waveMaxFt);
  });

  it("a stiffer boat (lower CSF) scores higher than a tender one in the same category", () => {
    const stiff = deriveBoatProfile(spec({ category: "C", beamFt: 8.6, displacementLb: 10000 })); // CSF ~1.6
    const tender = deriveBoatProfile(spec({ category: "C", beamFt: 12.9, displacementLb: 10000 })); // CSF ~2.4
    expect(stiff.windMaxKt).toBeGreaterThan(tender.windMaxKt);
    expect(stiff.waveMaxFt).toBeGreaterThan(tender.waveMaxFt);
  });

  it("never exceeds the safety caps", () => {
    const a = deriveBoatProfile(spec({ category: "A", beamFt: 8, displacementLb: 30000, ballastLb: 15000, draftFt: 7, avsOverride: 140 }));
    expect(a.windMaxKt).toBeLessThanOrEqual(40);
    expect(a.waveMaxFt).toBeLessThanOrEqual(10);
  });

  it("carries the spec id + name onto the profile", () => {
    const p = deriveBoatProfile(spec({ id: "custom:abc", name: "My Boat", category: "B" }));
    expect(p.id).toBe("custom:abc");
    expect(p.name).toBe("My Boat");
  });
});
