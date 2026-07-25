import { describe, it, expect } from "vitest";
import { parseDurationHours, sampleAt } from "./nws";

describe("NWS gridpoint series parsing", () => {
  it("parses the ISO8601 durations NWS uses", () => {
    expect(parseDurationHours("PT1H")).toBe(1);
    expect(parseDurationHours("PT3H")).toBe(3);
    expect(parseDurationHours("P1D")).toBe(24);
    expect(parseDurationHours("P1DT6H")).toBe(30);
    expect(parseDurationHours("PT30M")).toBe(0.5);
  });

  it("samples the interval covering a timestamp", () => {
    const s = [
      { start: 0, end: 10, value: 1 },
      { start: 10, end: 20, value: 2 },
      { start: 20, end: 30, value: 3 },
    ];
    expect(sampleAt(s, 5)).toBe(1);
    expect(sampleAt(s, 10)).toBe(2); // interval start is inclusive
    expect(sampleAt(s, 29)).toBe(3);
    expect(sampleAt(s, -5)).toBe(1); // before first → first value
    expect(sampleAt(s, 100)).toBe(3); // after last → last value
    expect(sampleAt([], 5)).toBe(null);
  });

  it("preserves null values (missing model data)", () => {
    expect(sampleAt([{ start: 0, end: 10, value: null }], 5)).toBe(null);
  });
});
