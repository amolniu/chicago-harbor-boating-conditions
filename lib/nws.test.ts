import { describe, it, expect } from "vitest";
import { marineHeadlines, parseDurationHours, parseMarineForecast, sampleAt } from "./nws";

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

// --- Nearshore marine text --------------------------------------------------
// Live products, verbatim (trailing spaces trimmed) as served by tgftp on 2026-10-02.
// LMZ521 is the zone that exposed the bug: its only mention of an advisory is outlook
// wording for Saturday night, yet it capped Menominee and Sister Bay.
const LMZ521_OUTLOOK_ONLY = `Expires:202610030400;;437749
FZUS53 KGRB 030056
NSHGRB

Nearshore Marine Forecast
National Weather Service Green Bay WI
756 PM CDT Fri Oct 2 2026

For waters within five nautical miles of shore on Lake Michigan


LMZ521-522-030400-
Green Bay south of line from Cedar River to Rock Island Passage
and north of a line from Oconto WI to Little Sturgeon Bay WI-
Green Bay south of line from Oconto WI to Little Sturgeon Bay WI-
756 PM CDT Fri Oct 2 2026

.TONIGHT...N wind 5 to 10 kts veering E after midnight. Waves
2 ft or less. Clear.
.SATURDAY...S wind 10 to 15 kts. Waves 1 to 3 ft. Partly cloudy
in the morning then becoming mostly cloudy.
.SATURDAY NIGHT...S wind 15 to 25 kts veering SW after midnight.
Waves 3 to 5 ft. A chance of showers. A Small Craft Advisory may
be needed.
.SUNDAY...W wind 10 to 15 kts veering NW early in the afternoon.
Waves 2 to 4 ft subsiding to 1 to 3 ft in the afternoon. Sunny.

$$
`;

const LMZ742_SCA_IN_EFFECT = `Expires:202610030315;;426480
FZUS53 KLOT 021936
NSHLOT

Nearshore Marine Forecast
National Weather Service Chicago/Romeoville IL
236 PM CDT Fri Oct 2 2026

For waters within five nautical miles of shore on Lake Michigan

Waves are provided as a range of significant wave heights, which
is the average of the highest 1/3 of the waves, along with the
average height of the highest 10 percent of the waves which will
occasionally be encountered.


LMZ740>742-030315-
Winthrop Harbor to Wilmette Harbor IL-
Wilmette Harbor to Northerly Island IL-
Northerly Island to Calumet Harbor IL-
236 PM CDT Fri Oct 2 2026

...SMALL CRAFT ADVISORY IN EFFECT THROUGH LATE TONIGHT...

.TONIGHT...North winds 15 to 25 kt becoming east 10 to 15 kt
after midnight. Clear. Waves 3 to 6 ft occasionally to 8 ft
subsiding to 3 to 5 ft.
.SATURDAY...Southeast winds 10 to 15 kt. Sunny. Waves 2 to 4 ft
subsiding to 1 to 3 ft.
.SATURDAY NIGHT...Southeast winds around 10 kt becoming south
overnight. Mostly clear. Waves 1 to 2 ft.
.SUNDAY...West winds 10 to 15 kt becoming northwest in the
afternoon. Sunny. Waves 1 to 2 ft.

$$
`;

/** A KGRB nearshore product for LMZ521-522 in the live format, around `body`. */
const grb = (issued: string, body: string) => `Expires:202611110400;;437750
FZUS53 KGRB 102056
NSHGRB

Nearshore Marine Forecast
National Weather Service Green Bay WI
${issued}

For waters within five nautical miles of shore on Lake Michigan


LMZ521-522-110400-
Green Bay south of line from Cedar River to Rock Island Passage
and north of a line from Oconto WI to Little Sturgeon Bay WI-
Green Bay south of line from Oconto WI to Little Sturgeon Bay WI-
${issued}

${body}

$$
`;

const GALE_WARNING = grb(
  "256 PM CST Tue Nov 10 2026",
  `...GALE WARNING IN EFFECT FROM 9 PM CST THIS EVENING THROUGH
WEDNESDAY AFTERNOON...

.TONIGHT...SW wind 20 to 30 kts backing to W with gusts to 40 kts.
Waves 4 to 7 ft building to 6 to 9 ft. A chance of showers.
.WEDNESDAY...W wind 25 to 30 kts with gusts to 40 kts diminishing
to 15 to 25 kts in the afternoon. Waves 6 to 9 ft subsiding to
3 to 5 ft. Partly cloudy.
.WEDNESDAY NIGHT...W wind 10 to 20 kts. Waves 2 to 4 ft. A Small
Craft Advisory may be needed.`,
);

const GALE_WATCH = grb(
  "352 AM CDT Fri Oct 9 2026",
  `...GALE WATCH IN EFFECT FROM SATURDAY EVENING THROUGH SUNDAY
AFTERNOON...

.TODAY...S wind 5 to 10 kts. Waves 1 to 2 ft. Sunny.
.TONIGHT...S wind 10 to 15 kts. Waves 1 to 3 ft. Mostly clear.
.SATURDAY...S wind 15 to 20 kts. Waves 2 to 4 ft. Mostly cloudy.
.SATURDAY NIGHT...SW wind 25 to 30 kts with gales to 35 kts
possible. Waves 5 to 8 ft. Showers likely.
.SUNDAY...W wind 25 to 30 kts with gales to 35 kts possible.
Waves 6 to 9 ft.`,
);

const STORM_WARNING = grb(
  "905 PM CST Mon Nov 9 2026",
  `...STORM WARNING IN EFFECT UNTIL 10 AM CST TUESDAY...

.TONIGHT...NE wind 35 to 45 kts with gusts to 55 kts. Waves 10 to
14 ft. Rain.
.TUESDAY...N wind 30 to 40 kts diminishing to gales to 35 kts in
the afternoon. Waves 9 to 13 ft subsiding to 6 to 9 ft.`,
);

const SCA_THEN_GALE_OUTLOOK = grb(
  "330 PM CDT Fri Oct 16 2026",
  `...SMALL CRAFT ADVISORY IN EFFECT UNTIL 4 AM CDT SATURDAY...

.TONIGHT...N wind 15 to 25 kts. Waves 3 to 6 ft.
.SATURDAY...NE wind 10 to 15 kts. Waves 2 to 4 ft.
.SATURDAY NIGHT...NE wind 20 to 30 kts with gusts to 35 kts. Waves
4 to 7 ft. A Gale Warning may be needed.
.SUNDAY...N gales to 35 kts. Waves 6 to 9 ft.`,
);

describe("parseMarineForecast", () => {
  it("reads an advisory that is in effect", () => {
    const f = parseMarineForecast(LMZ742_SCA_IN_EFFECT);
    expect(f.advisory).toBe("small_craft");
    expect(f.headline).toBe("SMALL CRAFT ADVISORY IN EFFECT THROUGH LATE TONIGHT");
  });

  it("ignores an advisory that is only 'may be needed' for a later period", () => {
    // The 2026-10-02 bug: this product capped Menominee and Sister Bay.
    const f = parseMarineForecast(LMZ521_OUTLOOK_ONLY);
    expect(f.advisory).toBe("none");
    expect(f.headline).toBe(null);
  });

  it("reads a gale warning in effect, across a wrapped headline", () => {
    const f = parseMarineForecast(GALE_WARNING);
    expect(f.advisory).toBe("gale");
    expect(f.headline).toBe("GALE WARNING IN EFFECT FROM 9 PM CST THIS EVENING THROUGH WEDNESDAY AFTERNOON");
  });

  it("does not cap for a gale watch, but keeps it as the informational headline", () => {
    // Gales are possible tomorrow evening, not blowing now — and "gales ... possible"
    // in the periods doesn't count either.
    const f = parseMarineForecast(GALE_WATCH);
    expect(f.advisory).toBe("none");
    expect(f.headline).toBe("GALE WATCH IN EFFECT FROM SATURDAY EVENING THROUGH SUNDAY AFTERNOON");
  });

  it("reads a storm warning in effect", () => {
    expect(parseMarineForecast(STORM_WARNING).advisory).toBe("storm");
  });

  it("keeps an in-effect SCA when a gale is only 'may be needed' later", () => {
    expect(parseMarineForecast(SCA_THEN_GALE_OUTLOOK).advisory).toBe("small_craft");
  });

  it("ranks a gale warning over a small craft advisory regardless of headline order", () => {
    const f = parseMarineForecast(
      grb(
        "305 PM CDT Fri Oct 23 2026",
        `...SMALL CRAFT ADVISORY IN EFFECT UNTIL 10 PM CDT THIS EVENING...
...GALE WARNING IN EFFECT FROM 10 PM THIS EVENING TO 4 PM CDT SATURDAY...

.TONIGHT...NW wind 25 to 30 kts with gales to 40 kts. Waves 6 to 9 ft.`,
      ),
    );
    expect(f.advisory).toBe("gale");
    expect(f.headline).toBe("GALE WARNING IN EFFECT FROM 10 PM THIS EVENING TO 4 PM CDT SATURDAY");
  });

  it("caps for the SCA in effect, not the gale watch beside it", () => {
    const f = parseMarineForecast(
      grb(
        "305 PM CDT Fri Oct 23 2026",
        `...SMALL CRAFT ADVISORY REMAINS IN EFFECT UNTIL 4 AM CDT SATURDAY...

...GALE WATCH IN EFFECT FROM SATURDAY EVENING THROUGH SUNDAY MORNING...

.TONIGHT...N wind 15 to 25 kts. Waves 3 to 6 ft.`,
      ),
    );
    expect(f.advisory).toBe("small_craft");
    expect(f.headline).toBe("SMALL CRAFT ADVISORY REMAINS IN EFFECT UNTIL 4 AM CDT SATURDAY");
  });

  it("ignores hazards that have ended", () => {
    const downgraded = grb(
      "905 PM CDT Fri Oct 23 2026",
      `...GALE WARNING HAS EXPIRED...

...SMALL CRAFT ADVISORY IN EFFECT UNTIL 4 AM CDT SATURDAY...

.TONIGHT...NW wind 20 to 30 kts. Waves 5 to 8 ft.`,
    );
    const cancelled = grb(
      "905 PM CDT Fri Oct 23 2026",
      `...SMALL CRAFT ADVISORY IS CANCELLED...

.TONIGHT...NW wind 5 to 10 kts. Waves 1 to 2 ft.`,
    );
    expect(parseMarineForecast(downgraded).advisory).toBe("small_craft");
    expect(parseMarineForecast(cancelled).advisory).toBe("none");
  });

  it("handles CRLF line endings", () => {
    expect(parseMarineForecast(LMZ742_SCA_IN_EFFECT.replace(/\n/g, "\r\n")).advisory).toBe("small_craft");
    expect(parseMarineForecast(GALE_WARNING.replace(/\n/g, "\r\n")).advisory).toBe("gale");
  });

  it("still pulls the wave line", () => {
    expect(parseMarineForecast(LMZ742_SCA_IN_EFFECT).waveText).toBe("Waves 3 to 6 ft occasionally to 8 ft");
  });
});

describe("marineHeadlines", () => {
  it("splits two headlines that share a line", () => {
    expect(marineHeadlines("...GALE WARNING IN EFFECT... ...SMALL CRAFT ADVISORY IN EFFECT...")).toEqual([
      "GALE WARNING IN EFFECT",
      "SMALL CRAFT ADVISORY IN EFFECT",
    ]);
  });

  it("does not let an unterminated '...' swallow the period forecasts", () => {
    const text = `...SMALL CRAFT ADVISORY IN EFFECT
.TONIGHT...N wind 15 to 25 kts...
.SATURDAY...Gale warning possible...`;
    expect(marineHeadlines(text)).toEqual([]);
  });
});
