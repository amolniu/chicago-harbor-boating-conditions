import { describe, it, expect } from "vitest";
import { classifyAlert, worstAlertLevel, type WeatherAlert } from "./alerts";

const mk = (event: string): WeatherAlert => ({ event, headline: null, level: classifyAlert(event), ends: null });

describe("classifyAlert", () => {
  it("treats life-threatening warnings as a hard stop", () => {
    for (const e of [
      "Tornado Warning",
      "Severe Thunderstorm Warning",
      "Special Marine Warning",
      "Hurricane Force Wind Warning",
    ]) {
      expect(classifyAlert(e), e).toBe("stop");
    }
  });

  it("treats watches as caution, not a stop", () => {
    expect(classifyAlert("Tornado Watch")).toBe("watch");
    expect(classifyAlert("Severe Thunderstorm Watch")).toBe("watch");
  });

  it("does not let a watch masquerade as its warning", () => {
    // Substring matching would classify "Tornado Watch" as a stop — the whole point of
    // the distinction is that a watch is not a warning.
    expect(classifyAlert("Tornado Watch")).not.toBe("stop");
  });

  it("keeps unrelated alerts informational so they never distort the score", () => {
    for (const e of ["Heat Advisory", "Lakeshore Flood Warning", "Air Quality Alert", "Special Weather Statement"]) {
      expect(classifyAlert(e), e).toBe("info");
    }
  });
});

describe("worstAlertLevel", () => {
  it("reports the most constraining level present", () => {
    expect(worstAlertLevel([mk("Heat Advisory"), mk("Tornado Warning")])).toBe("stop");
    expect(worstAlertLevel([mk("Heat Advisory"), mk("Tornado Watch")])).toBe("watch");
    expect(worstAlertLevel([mk("Heat Advisory")])).toBe("info");
  });

  it("is informational when there is nothing active", () => {
    expect(worstAlertLevel([])).toBe("info");
    expect(worstAlertLevel(undefined)).toBe("info");
  });
});
