import { describe, it, expect } from "vitest";
import { computeWindow } from "./window";
import { getHarbor } from "./harbors";
import { getBoat } from "./boats";
import type { ForecastHour } from "./types";

// 24 calm forecast hours from 06:00 local — green for a daysailer on any normal day.
const START = Date.UTC(2026, 9, 20, 11); // 06:00 CDT
const calmHours: ForecastHour[] = Array.from({ length: 24 }, (_, i) => ({
  time: new Date(START + i * 3600_000).toISOString(),
  windDir: 250, windKt: 6, gustKt: 8, waveFt: 0.5,
}));
const sunrise = new Date(START);
const sunset = new Date(START + 12 * 3600_000);
const daysailer = getBoat("daysailer");

describe("the sail window follows the live forecast-wind cap", () => {
  it("a harbor that has lost its own buoy can't be told 'Good to go now' by the same model", () => {
    // The header says Caution because the wind is the model; the window is built from the
    // same model, so it must not say "go" either — before this, the page said both at once.
    const gh = getHarbor("grand-haven")!;
    const open = computeWindow(gh, calmHours, daysailer, "intermediate", sunrise, sunset, [], "station");
    expect(open.summary).toMatch(/Good to go now/);
    const capped = computeWindow(gh, calmHours, daysailer, "intermediate", sunrise, sunset, [], "model");
    expect(capped.summary).not.toMatch(/Good to go/);
    expect(capped.hours.every((h) => h.score <= 59)).toBe(true);
    expect(capped.hours.some((h) => h.status === "green")).toBe(false);
  });

  it("a model-only harbor's window is unaffected — it never had a buoy to lose", () => {
    const kw = getHarbor("kewaunee")!;
    const w = computeWindow(kw, calmHours, daysailer, "intermediate", sunrise, sunset, [], "model");
    expect(w.hours.some((h) => h.status === "green")).toBe(true);
  });

  it("a harbor on a measured neighbour is unaffected", () => {
    const gh = getHarbor("grand-haven")!;
    const w = computeWindow(gh, calmHours, daysailer, "intermediate", sunrise, sunset, [], "neighbor");
    expect(w.summary).toMatch(/Good to go now/);
  });
});
