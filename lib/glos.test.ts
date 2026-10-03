import { describe, it, expect, vi, afterEach } from "vitest";
import { getGlosCurrent, obsUrl } from "./glos";

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

describe("obsUrl", () => {
  // Unfiltered, /obs returns every series a Spotter carries: 14 days of it ran 1.6-3.7 MB,
  // over Next's 2 MB cache limit, so /health re-downloaded ~10 MB per render and the weekly
  // job was OOM-killed (2026-09-21). Only the declared series may be requested.
  it("asks only for the series the ref declares", () => {
    const u = new URL(obsUrl(REF, "2026-10-01"));
    expect(u.searchParams.get("obsDatasetId")).toBe("1");
    expect(u.searchParams.get("startDate")).toBe("2026-10-01");
    expect(u.searchParams.get("parameterId")).toBe("10,11,12,13");
  });

  it("includes the wind series only when a ref declares one, and never 'undefined'", () => {
    expect(new URL(obsUrl({ datasetId: 2, waveId: 20 }, "2026-10-01")).searchParams.get("parameterId")).toBe("20");
    const wind = obsUrl({ ...REF, windId: 14 }, "2026-10-01");
    expect(new URL(wind).searchParams.get("parameterId")).toBe("10,11,12,13,14");
    expect(wind).not.toMatch(/undefined|null/);
  });

  it("is what getGlosCurrent actually fetches", async () => {
    stub({ 10: 0.5 });
    await getGlosCurrent(REF);
    const called = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(new URL(called).searchParams.get("parameterId")).toBe("10,11,12,13");
  });
});

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

  it("converts spectral wind m/s to knots, and a wind-only payload still counts", async () => {
    const REF_W = { ...REF, windId: 14 };
    stub({ 14: 6.0 }); // wave/temp sensors dark, wind alive
    const c = await getGlosCurrent(REF_W);
    expect(c, "wind alone is still usable data").not.toBeNull();
    expect(c!.windKt).toBeCloseTo(11.66, 1);
    expect(c!.waveFt).toBeNull();
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
