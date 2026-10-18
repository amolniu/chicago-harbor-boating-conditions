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
    const open = computeWindow(gh, calmHours, daysailer, "intermediate", sunrise, sunset, { live: { windBasis: "station" } });
    expect(open.summary).toMatch(/Good to go now/);
    const capped = computeWindow(gh, calmHours, daysailer, "intermediate", sunrise, sunset, { live: { windBasis: "model" } });
    expect(capped.summary).not.toMatch(/Good to go/);
    expect(capped.hours.every((h) => h.score <= 59)).toBe(true);
    expect(capped.hours.some((h) => h.status === "green")).toBe(false);
  });

  it("a model-only harbor's window is unaffected — it never had a buoy to lose", () => {
    const kw = getHarbor("kewaunee")!;
    const w = computeWindow(kw, calmHours, daysailer, "intermediate", sunrise, sunset, { live: { windBasis: "model" } });
    expect(w.hours.some((h) => h.status === "green")).toBe(true);
  });

  it("a SCHEDULED advisory caps only the hours it covers", () => {
    // Issued at breakfast "from noon": before 2026-10-18 the window rated every hour with
    // advisory "none" (and the header capped from issuance). Now each hour gets what
    // covers it. Grand Haven is fairly open, so an SCA caps an intermediate at 48 + 20 x
    // shelter — below green.
    const gh = getHarbor("grand-haven")!;
    const sca = { event: "Small Craft Advisory", level: "info" as const, advisory: "small_craft" as const, onset: calmHours[6].time, ends: calmHours[12].time };
    const w = computeWindow(gh, calmHours, daysailer, "intermediate", sunrise, sunset, { live: { hazards: [sca] } });
    expect(w.hours[5].status, "before it starts").toBe("green");
    expect(w.hours[6].status, "first covered hour").not.toBe("green");
    expect(w.hours[11].status, "last covered hour").not.toBe("green");
    expect(w.hours[12].status, "after it ends").toBe("green");
  });

  it("a warning's hours are a hard no-go; a watch's hours are capped", () => {
    const gh = getHarbor("grand-haven")!;
    const smw = { event: "Special Marine Warning", level: "stop" as const, onset: calmHours[3].time, ends: calmHours[4].time };
    const watch = { event: "Tornado Watch", level: "watch" as const, onset: calmHours[8].time, ends: calmHours[10].time };
    // A Hurricane Force Wind Warning is BOTH the storm tier and a stop: it must pin to 0.
    const hf = { event: "Hurricane Force Wind Warning", level: "stop" as const, advisory: "storm" as const, onset: calmHours[14].time, ends: calmHours[15].time };
    const w = computeWindow(gh, calmHours, daysailer, "intermediate", sunrise, sunset, { live: { hazards: [smw, watch, hf] } });
    expect(w.hours[3].score).toBe(0);
    expect(w.hours[4].status).toBe("green");
    expect(w.hours[8].status, "watch hour").not.toBe("green");
    expect(w.hours[8].score).toBeLessThanOrEqual(45);
    expect(w.hours[10].status, "after the watch").toBe("green");
    expect(w.hours[14].score, "HF warning pins to 0, not the storm cap of 5").toBe(0);
  });

  it("no hour says 'go' while NWS warnings can't be checked", () => {
    const gh = getHarbor("grand-haven")!;
    const w = computeWindow(gh, calmHours, daysailer, "intermediate", sunrise, sunset, { live: { warningsUnavailable: true } });
    expect(w.hours.some((h) => h.status === "green")).toBe(false);
    expect(w.summary).not.toMatch(/Good to go/);
  });

  it("a harbor on a measured neighbour is unaffected", () => {
    const gh = getHarbor("grand-haven")!;
    const w = computeWindow(gh, calmHours, daysailer, "intermediate", sunrise, sunset, { live: { windBasis: "neighbor" } });
    expect(w.summary).toMatch(/Good to go now/);
  });
});
