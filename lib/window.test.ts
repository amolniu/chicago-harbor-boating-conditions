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

// Until 2026-10-20 a run counted consecutive DAYLIGHT entries, so with the night filtered
// out today's 6 PM sat next to tomorrow's 7 AM: "Best window today: 4 PM–10 AM" on
// production. One letter per forecast hour: g = calm (green), r = rough.
const CALM = { windDir: 250, windKt: 6, gustKt: 8, waveFt: 0.5 };
const ROUGH = { windDir: 250, windKt: 28, gustKt: 36, waveFt: 6 };
const forecastFrom = (startUtc: number, pattern: string): ForecastHour[] =>
  [...pattern].map((ch, i) => ({ time: new Date(startUtc + i * 3600_000).toISOString(), ...(ch === "g" ? CALM : ROUGH) }));
// Sunday 2026-10-18: light from 7 AM to 6 PM Central, so 7 AM–6 PM are the daylight hours.
const SUNRISE = new Date(Date.UTC(2026, 9, 18, 12)); // 07:00 CDT
const SUNSET = new Date(Date.UTC(2026, 9, 18, 23)); // 18:00 CDT
const at = (hourUtc: number) => Date.UTC(2026, 9, 18, hourUtc);
const catalina = getBoat("catalina30");

describe("the sail window keeps today and tomorrow apart", () => {
  // From 1 PM: rough 1–4 PM, calm 4 PM through 10 AM tomorrow, rough again from 10 AM.
  const SPANS_THE_NIGHT = "rrr" + "ggg" + "g".repeat(12) + "ggg" + "rrr";

  it("a window that runs into sunset stops there — it doesn't resume tomorrow morning", () => {
    const w = computeWindow(getHarbor("montrose")!, forecastFrom(at(18), SPANS_THE_NIGHT), catalina, "intermediate", SUNRISE, SUNSET);
    expect(w.hours.map((h) => h.status[0]).join(""), "the fixture rates as drawn").toBe(SPANS_THE_NIGHT);
    expect(w.summary).toBe("Best window today: 4–6\u00a0PM (green).");
  });

  it("a window that exists only tomorrow says so", () => {
    // Southport on 2026-10-18: every daylight hour left today capped, green tomorrow 7–10 AM.
    const w = computeWindow(getHarbor("southport")!, forecastFrom(at(15), "r".repeat(21) + "ggg"), catalina, "intermediate", SUNRISE, SUNSET);
    expect(w.hours.slice(-3).every((h) => h.status === "green")).toBe(true);
    expect(w.summary).toBe("Best window: tomorrow 7–10\u00a0AM (green).");
  });

  it("after dark, tomorrow morning's window is not 'Good to go now'", () => {
    // From 9 PM: the first DAYLIGHT hour is 7 AM tomorrow, which used to read as "now".
    const w = computeWindow(getHarbor("montrose")!, forecastFrom(at(26), "g".repeat(14) + "r".repeat(10)), catalina, "intermediate", SUNRISE, SUNSET);
    expect(w.hours[0].daylight).toBe(false);
    expect(w.summary).toBe("Best window: tomorrow 7–11\u00a0AM (green).");
  });

  it("'Good to go now' ends at sunset, not at tomorrow's last green hour", () => {
    // Southport, advanced, 10 AM and calm for 24 h: it said "green through 10 AM" (tomorrow).
    const w = computeWindow(getHarbor("southport")!, forecastFrom(at(15), "g".repeat(24)), catalina, "advanced", SUNRISE, SUNSET);
    expect(w.summary).toBe("Good to go now — green through 6\u00a0PM.");
  });

  it("today's window comes first even when tomorrow's is longer", () => {
    // 3 PM, green until sunset; tomorrow green all morning. "Go now" beats "tomorrow".
    const w = computeWindow(getHarbor("montrose")!, forecastFrom(at(20), "g".repeat(24)), catalina, "intermediate", SUNRISE, SUNSET);
    expect(w.summary).toBe("Good to go now — green through 6\u00a0PM.");
  });

  it("a run breaks at a gap in time, not just at a change of status", () => {
    // Today's only green hour is the last light one (5 PM); tomorrow is green 7–10 AM.
    // Joined across the night they were "Best window today: 5 PM–10 AM".
    const overnight = computeWindow(getHarbor("montrose")!, forecastFrom(at(20), "rr" + "g".repeat(17) + "r".repeat(5)), catalina, "intermediate", SUNRISE, SUNSET);
    expect(overnight.summary).toBe("Best window: tomorrow 7–10\u00a0AM (green).");
    // NWS sometimes skips an hour; 1 PM and 3 PM aren't adjacent either.
    const missing = forecastFrom(at(15), "g".repeat(24)).filter((_, i) => i !== 4);
    const gap = computeWindow(getHarbor("montrose")!, missing, catalina, "intermediate", SUNRISE, SUNSET);
    expect(gap.summary).toBe("Good to go now — green through 2\u00a0PM.");
  });

  it("'green through' never runs more than half an hour past sunset, and after it isn't 'now'", () => {
    // Grand Haven, 2026-10-21: sunrise 8:06 AM, sunset 6:54 PM EDT. The 7 PM hour used to
    // count as daylight, so a calm evening read "Good to go now — green through 8 PM".
    const rise = new Date(Date.UTC(2026, 9, 21, 12, 6));
    const set = new Date(Date.UTC(2026, 9, 21, 22, 54));
    const gh = getHarbor("grand-haven")!;
    const from4pm = computeWindow(gh, forecastFrom(Date.UTC(2026, 9, 21, 20), "g".repeat(24)), catalina, "intermediate", rise, set);
    expect(from4pm.summary).toBe("Good to go now — green through 7\u00a0PM.");
    const from7pm = computeWindow(gh, forecastFrom(Date.UTC(2026, 9, 21, 23), "g".repeat(24)), catalina, "intermediate", rise, set);
    expect(from7pm.hours[0].daylight).toBe(false);
    expect(from7pm.summary).not.toMatch(/now/i);
  });
  it("times read in the harbor's own zone — Michigan's east shore is Eastern", () => {
    // The same instants as the Montrose case: 4–6 PM Central is 5–7 PM in Grand Haven.
    const w = computeWindow(getHarbor("grand-haven")!, forecastFrom(at(18), SPANS_THE_NIGHT), catalina, "intermediate", SUNRISE, SUNSET);
    expect(w.hours[3].hour).toBe(17);
    expect(w.summary).toBe("Best window today: 5–7\u00a0PM (green).");
  });
});
