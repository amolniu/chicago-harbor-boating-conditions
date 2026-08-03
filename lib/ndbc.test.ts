import { describe, it, expect, vi, afterEach } from "vitest";
import { parseRealtime2, getBuoyCurrent, getBuoyWindHistory } from "./ndbc";

const HEADER = `#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE
#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft`;

/** One realtime2 row at the given time. */
function row(at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return [
    at.getUTCFullYear(), p(at.getUTCMonth() + 1), p(at.getUTCDate()),
    p(at.getUTCHours()), p(at.getUTCMinutes()),
    "180", "5.0", "6.0", "0.4", "3", "MM", "205", "1015.0", "20.0", "21.0", "18.0", "MM", "MM", "MM",
  ].join(" ");
}

function stubFeed(text: string) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => text })));
}

afterEach(() => vi.unstubAllGlobals());

describe("parseRealtime2", () => {
  it("parses a row and normalizes units (m/s → kt, °C → °F)", () => {
    const rows = parseRealtime2(`${HEADER}\n${row(new Date("2026-08-02T22:18:00Z"))}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].windKt).toBeCloseTo(9.72, 1);
    expect(rows[0].waterTempF).toBeCloseTo(69.8, 1);
    expect(rows[0].windDir).toBe(180);
  });

  it("treats MM as missing rather than zero", () => {
    const rows = parseRealtime2(`${HEADER}\n${row(new Date()).replace(" 5.0 ", " MM ")}`);
    expect(rows[0].windKt).toBeNull();
  });
});

// A station can keep serving a file long after it stops reporting. Presenting that as
// "right now" is worse than no reading, because callers can fall back to a neighbour
// or the gridpoint model instead.
describe("getBuoyCurrent staleness guard", () => {
  it("returns the reading when the feed is current", async () => {
    stubFeed(`${HEADER}\n${row(new Date(Date.now() - 10 * 60_000))}`);
    const c = await getBuoyCurrent("KWNW3");
    expect(c).not.toBeNull();
    expect(c!.windKt).toBeCloseTo(9.72, 1);
  });

  it("returns null when the newest row is hours old", async () => {
    stubFeed(`${HEADER}\n${row(new Date(Date.now() - 8 * 3600_000))}`);
    expect(await getBuoyCurrent("FPTM4")).toBeNull();
  });

  it("returns null for an empty or headers-only feed", async () => {
    stubFeed(HEADER);
    expect(await getBuoyCurrent("SYWW3")).toBeNull();
  });

  it("does not plot a dark station's old data as the last 24 h", async () => {
    const stale = [0, 1, 2].map((h) => row(new Date(Date.now() - (8 * 24 + h) * 3600_000))).join("\n");
    stubFeed(`${HEADER}\n${stale}`);
    expect(await getBuoyWindHistory("FPTM4")).toEqual([]);

    stubFeed(`${HEADER}\n${row(new Date(Date.now() - 10 * 60_000))}`);
    expect(await getBuoyWindHistory("KWNW3")).toHaveLength(1);
  });
});
