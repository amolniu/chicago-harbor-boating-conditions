import { describe, it, expect, vi, afterEach } from "vitest";
import { getGlosCurrent } from "./glos";

const REF = { datasetId: 1, waveId: 10, periodId: 11, dirId: 12, tempId: 13 };

function stub(points: Record<number, number>) {
  const now = new Date().toISOString();
  const body = [
    {
      parameters: Object.entries(points).map(([id, value]) => ({
        parameter_id: Number(id),
        observations: [{ timestamp: now, value }],
      })),
    },
  ];
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => body })));
}

afterEach(() => vi.unstubAllGlobals());

describe("getGlosCurrent", () => {
  it("converts metres to feet and KELVIN to Fahrenheit", async () => {
    stub({ 10: 0.5, 11: 3.2, 12: 180, 13: 295.15 });
    const c = await getGlosCurrent(REF);
    expect(c!.waveFt).toBeCloseTo(1.64, 1);
    expect(c!.wavePeriodS).toBe(3.2);
    expect(c!.waterTempF).toBeCloseTo(71.6, 1);
  });

  // Spotters spike to 25-34 s when the sea is flat and the spectral peak lands on noise.
  // Left through, that reads as "longer period, rolling and easier-motioned" on small chop.
  it("drops implausible wave periods rather than reporting them", async () => {
    stub({ 10: 0.3, 11: 25.6, 13: 295.15 });
    const c = await getGlosCurrent(REF);
    expect(c!.wavePeriodS, "25.6 s is not a Great Lakes wind-sea period").toBeNull();
    expect(c!.waveFt, "the wave height is still good").toBeCloseTo(0.98, 1);
  });

  it("returns null when the platform has gone quiet", async () => {
    const old = new Date(Date.now() - 8 * 3600_000).toISOString();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => [{ parameters: [{ parameter_id: 10, observations: [{ timestamp: old, value: 0.5 }] }] }],
    })));
    expect(await getGlosCurrent(REF)).toBeNull();
  });
});
