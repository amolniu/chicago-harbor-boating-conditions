import { describe, it, expect } from "vitest";
import { fmtLocalTime } from "./astro";
import { getHarbor } from "./harbors";
import { DEFAULT_TZ_FALLBACK } from "./history";

describe("fmtLocalTime", () => {
  it("reads the clock in the harbor's own zone", () => {
    const sunset = new Date(Date.UTC(2026, 9, 21, 23, 33)); // 6:33 PM Central, 7:33 PM Eastern
    const zone = (id: string) => getHarbor(id)!.timezone ?? DEFAULT_TZ_FALLBACK;
    expect(fmtLocalTime(sunset, zone("belmont"))).toBe("6:33 PM");
    expect(fmtLocalTime(sunset, zone("grand-haven"))).toBe("7:33 PM");
  });
});
