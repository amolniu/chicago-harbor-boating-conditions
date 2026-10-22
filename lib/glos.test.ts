import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { getGlosCurrent, getGlosRows, glosTime, obsUrl } from "./glos";

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

// Seagull writes "2026-10-21T21:40:00" with no zone, and it is UTC. ECMAScript reads a bare
// date-time in the RUNTIME's zone, so passed through raw the browser showed Escanaba's 21:40Z
// observation as "10:40 PM" at 6:14 PM EDT — and the server was right only because Firebase
// runs in UTC. These use the API's real bare format, unlike stub() above.
describe("GLOS timestamps", () => {
  const NOW = Date.UTC(2026, 9, 21, 22, 14); // 6:14 PM EDT
  const series = (points: Record<number, [string, number][]>) => [
    {
      parameters: Object.entries(points).map(([id, obs]) => ({
        parameter_id: Number(id),
        observations: obs.map(([timestamp, value]) => ({ timestamp, value })),
      })),
    },
  ];
  const serve = (body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => body })));

  // Read as local time, a bare timestamp is only wrong OUTSIDE UTC — so pin a zone that
  // isn't, or on a UTC machine (Linux, CI, production) these would pass against the bug.
  // Restore by ASSIGNING the zone we started in: deleting TZ doesn't make Node re-detect
  // it, so later tests in this process would quietly run in Detroit.
  let restoreTz = "";
  beforeEach(() => {
    restoreTz = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    process.env.TZ = "America/Detroit";
    // Assigning TZ only takes effect in a child process (vitest's default "forks" pool), not
    // in a worker thread — fail loudly rather than pass against the bug under another pool.
    expect(new Date(NOW).getTimezoneOffset(), "the TZ pin took effect").toBe(240);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = restoreTz;
  });

  it("turns a bare Seagull timestamp into explicit UTC on observedAt and windObservedAt", async () => {
    serve(series({ 10: [["2026-10-21T21:40:00", 0.5]], 14: [["2026-10-21T21:40:00", 6.0]] }));
    const c = await getGlosCurrent({ ...REF, windId: 14 });
    expect(c!.observedAt, "must carry its zone, or the browser reads it as local").toMatch(/Z$/);
    expect(c!.observedAt).toBe("2026-10-21T21:40:00.000Z");
    expect(c!.windObservedAt).toBe("2026-10-21T21:40:00.000Z");
    expect(Date.parse(c!.observedAt!)).toBe(Date.UTC(2026, 9, 21, 21, 40));
  });

  it("judges freshness in UTC, whatever zone the server runs in", async () => {
    // 4 h old in UTC. Read as Central it would be 23:10Z — in the future, so "fresh".
    serve(series({ 10: [["2026-10-21T18:10:00", 0.5]] }));
    expect(await getGlosCurrent(REF)).toBeNull();
  });

  it("picks the newest point by instant, not by how its string happens to be written", async () => {
    // 21:50Z written with an offset sorts BEFORE bare 21:40 as a raw string ("17" < "21").
    serve(series({ 10: [["2026-10-21T21:40:00", 0.5], ["2026-10-21T17:50:00-04:00", 0.9]] }));
    const c = await getGlosCurrent(REF);
    expect(c!.observedAt).toBe("2026-10-21T21:50:00.000Z");
    expect(c!.waveFt).toBeCloseTo(0.9 * 3.28084, 2);
  });

  it("buckets health rows by the UTC hour", async () => {
    serve(series({ 10: [["2026-10-21T21:40:00", 0.5]] }));
    const rows = await getGlosRows(REF, 1);
    expect(rows.map((r) => r.time)).toEqual([Date.UTC(2026, 9, 21, 21)]);
  });

  it("leaves an already-zoned timestamp's instant alone and rejects junk", () => {
    expect(glosTime("2026-10-21T21:40:00Z")).toBe("2026-10-21T21:40:00.000Z");
    expect(glosTime("2026-10-21T17:40:00-04:00")).toBe("2026-10-21T21:40:00.000Z");
    expect(glosTime("not a time")).toBeNull();
  });
});
