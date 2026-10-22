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

  it("still pulls the wave line, across its wrap", () => {
    expect(parseMarineForecast(LMZ742_SCA_IN_EFFECT).waveText).toBe(
      "Waves 3 to 6 ft occasionally to 8 ft subsiding to 3 to 5 ft",
    );
  });
});

// Live products, verbatim (trailing whitespace trimmed) as served by tgftp on 2026-10-18:
// one zone per office that writes Lake Michigan nearshore text, because each phrases
// waves its own way. LOT and GRB write "ft", the rest "feet" and "foot"; LOT and MQT
// print wave boilerplate above the zones.
const LMZ741_LOT = `Expires:202610182115;;311843
FZUS53 KLOT 181418
NSHLOT

Nearshore Marine Forecast
National Weather Service Chicago/Romeoville IL
918 AM CDT Sun Oct 18 2026

For waters within five nautical miles of shore on Lake Michigan

Waves are provided as a range of significant wave heights, which
is the average of the highest 1/3 of the waves, along with the
average height of the highest 10 percent of the waves which will
occasionally be encountered.


LMZ740-741-182115-
Winthrop Harbor to Wilmette Harbor IL-
Wilmette Harbor to Northerly Island IL-
918 AM CDT Sun Oct 18 2026

.REST OF TODAY...Southwest winds 15 to 25 kt. Sunny. Waves 2 to
4 ft.
.TONIGHT...Southwest winds 10 to 20 kt diminishing to around 10
kt. Clear. Waves 2 to 4 ft subsiding to 1 to 2 ft.
.MONDAY...Southwest winds around 10 kt becoming southeast in the
afternoon. Sunny. Waves 1 to 2 ft subsiding to 1 ft or less.
.MONDAY NIGHT...Southeast winds less than 10 kt. Mostly clear.
Waves 1 ft or less.


$$
`;

const LMZ844_GRR = `Expires:202610190800;;317016
FZUS53 KGRR 181706
NSHGRR

Nearshore Marine Forecast
National Weather Service Grand Rapids MI
105 PM EDT Sun Oct 18 2026

For waters within five nautical miles of shore on Lake Michigan


LMZ844-190800-
St Joseph to South Haven MI-
105 PM EDT Sun Oct 18 2026

...SMALL CRAFT ADVISORY IN EFFECT UNTIL 11 PM EDT THIS EVENING...

.THROUGH EARLY EVENING...Southwest winds 15 to 25 knots. Sunny.
Waves 3 to 5 feet.
.TONIGHT...South winds 10 to 20 knots. Clear. Waves 2 to 4 feet.
.MONDAY...South winds 10 to 15 knots veering southwest 5 to 10 knots
early in the afternoon. Sunny. Waves 1 to 3 feet.
.MONDAY NIGHT...North winds around 5 knots veering east in the late
evening and overnight. Mostly clear. Waves 1 foot or less.
.TUESDAY...East winds around 5 knots backing north early in the
afternoon. Sunny. Waves less than 1 foot.
.TUESDAY NIGHT...Northeast winds around 5 knots veering southeast in
the late evening and overnight. Mostly clear. Waves less than
1 foot.
.WEDNESDAY...South winds 5 to 10 knots veering southwest early in
the afternoon. Sunny. Waves less than 1 foot.
.THURSDAY...South winds around 5 knots veering northwest early in
the afternoon. Sunny. Waves less than 1 foot.
.FRIDAY...Southeast winds 5 to 10 knots. Sunny. Waves less than
1 foot.

$$
`;

const LMZ043_IWX = `Expires:202610182015;;312099
FZUS53 KIWX 181431
NSHIWX

Nearshore Marine Forecast
National Weather Service Northern Indiana
1031 AM EDT Sun Oct 18 2026

For waters within five nautical miles of shore on Lake Michigan


LMZ043-046-182015-
New Buffalo MI to St Joseph MI-Michigan City IN to New Buffalo MI-
1031 AM EDT Sun Oct 18 2026

.THIS AFTERNOON...Southwest winds 15 to 20 knots becoming south.
Sunny. Waves 2 to 4 feet.
.TONIGHT...South winds 5 to 15 knots becoming southwest. Mostly
clear. Waves 1 to 3 feet.
.MONDAY...South winds 5 to 10 knots becoming light and variable.
Sunny. Waves 2 feet or less.
.MONDAY NIGHT...Light and variable winds. Mostly clear. Waves
1 foot or less.

The water temperature at Michigan City is 60 degrees.

$$
`;

const LMZ645_MKX = `Expires:202610182200;;315360
FZUS53 KMKX 181610
NSHMKX

Nearshore Marine Forecast
National Weather Service Milwaukee/Sullivan WI
1110 AM CDT Sun Oct 18 2026

For waters within five nautical miles of shore on Lake Michigan


LMZ645-182200-
North Point Light to Wind Point WI-
1110 AM CDT Sun Oct 18 2026

...SMALL CRAFT ADVISORY IN EFFECT UNTIL 7 PM CDT THIS EVENING...

.REST OF TODAY...Southwest wind 10 to 20 knots becoming 15 to
20 knots late in the afternoon. Gusts up to 25 knots. Sunny.
Waves 2 to 4 feet.
.TONIGHT...South wind 15 to 20 knots with gusts to around
25 knots veering southwest with gusts to around 25 knots late in
the evening, then becoming 10 to 20 knots with gusts to around
25 knots after midnight becoming 10 to 15 knots early in the
morning. Clear. Waves 2 to 4 feet subsiding to 1 to 2 feet early
in the morning.
.MONDAY...Southwest wind 10 to 15 knots easing to 5 to 10 knots
late in the morning, then backing south early in the afternoon
backing southeast late in the afternoon. Sunny. Waves around
1 foot.
.MONDAY NIGHT...Southeast wind 5 to 10 knots veering south late
in the evening, then becoming southwest after midnight veering
north early in the morning. Partly cloudy. Waves around 1 foot.

$$
`;

const LMZ542_GRB = `Expires:202610182200;;317018
FZUS53 KGRB 181706
NSHGRB

Nearshore Marine Forecast
National Weather Service Green Bay WI
1206 PM CDT Sun Oct 18 2026

For waters within five nautical miles of shore on Lake Michigan


LMZ542-543-182200-
Sturgeon Bay to Two Rivers WI-Two Rivers to Sheboygan WI-
1206 PM CDT Sun Oct 18 2026

...SMALL CRAFT ADVISORY IN EFFECT THROUGH LATE TONIGHT...

.THIS AFTERNOON...SW wind to 30 kts with gale force gusts to
around 35 kts. Waves 4 to 7 ft. Sunny.
.TONIGHT...SW wind 15 to 25 kts decreasing to 10 to 15 kts after
midnight. Waves 4 to 7 ft subsiding to 3 to 5 ft after midnight.
Clear.
.MONDAY...SW wind 5 to 10 kts backing SE early in the afternoon.
Waves 1 to 3 ft. Mostly sunny.
.MONDAY NIGHT...S wind around 5 kts early in the evening becoming
variable 10 kts or less. Waves 2 ft or less. Patchy fog after
midnight.

$$
`;

const LMZ221_MQT = `Expires:202610182000;;312829
FZUS53 KMQT 181501
NSHMQT

Nearshore Marine Forecast
National Weather Service Marquette MI
1100 AM EDT Sun Oct 18 2026

For waters within five nautical miles of shore

Waves are the significant wave height - the average of the
highest 1/3 of the wave spectrum. Occasional wave height is the
average of the highest 1/10 of the wave spectrum.


LMZ221-182000-
Green Bay North of line from Cedar River MI to Rock Island
Passage-
1101 AM EDT Sun Oct 18 2026

...SMALL CRAFT ADVISORY IN EFFECT THROUGH LATE TONIGHT...

.REST OF TODAY...Southwest wind up to 30 knots. Mostly sunny.
Waves 4 to 7 feet occasionally to 9 feet subsiding to 3 to 6 feet
occasionally to 8 feet.
.TONIGHT...Southwest wind 15 to 25 knots with gusts up to
32 knots diminishing to 10 to 15 knots with gusts up to 22 knots
late. Clear. Waves subsiding to 1 to 2 feet.
.MONDAY...West wind less than 10 knots in the morning becoming
variable. Mostly sunny. Waves 1 to 2 feet.
.MONDAY NIGHT...Variable wind less than 10 knots. Mostly clear.
Waves calm to 1 foot.

$$
`;

/** `product` as if `period` were its first forecast period: the ones before it are dropped. */
const startingAt = (product: string, period: string) => {
  const at = product.indexOf(`\n.${period}...`);
  if (at < 0) throw new Error(`no .${period}... period`);
  return product.slice(0, product.search(/^\.[A-Z]/m)) + product.slice(at + 1);
};

describe("parseMarineForecast wave line", () => {
  // The 2026-10-18 bugs: GRR and IWX write "feet", which a match on "FT" never found, so
  // St. Joseph through Whitehall and New Buffalo had no wave line; and LOT's first line
  // wraps ("Waves 2 to\n4 ft."), so Chicago showed TONIGHT's line instead of today's.
  it.each([
    { office: "LOT", product: LMZ741_LOT, want: "Waves 2 to 4 ft" },
    { office: "GRR", product: LMZ844_GRR, want: "Waves 3 to 5 feet" },
    { office: "IWX", product: LMZ043_IWX, want: "Waves 2 to 4 feet" },
    { office: "MKX", product: LMZ645_MKX, want: "Waves 2 to 4 feet" },
    { office: "GRB", product: LMZ542_GRB, want: "Waves 4 to 7 ft" },
    {
      office: "MQT",
      product: LMZ221_MQT,
      want: "Waves 4 to 7 feet occasionally to 9 feet subsiding to 3 to 6 feet occasionally to 8 feet",
    },
  ])("takes the first period's wave sentence from $office", ({ product, want }) => {
    expect(parseMarineForecast(product).waveText).toBe(want);
  });

  it.each([
    { office: "LOT", period: "MONDAY", product: LMZ741_LOT, want: "Waves 1 to 2 ft subsiding to 1 ft or less" },
    { office: "GRR", period: "MONDAY NIGHT", product: LMZ844_GRR, want: "Waves 1 foot or less" },
    { office: "GRR", period: "TUESDAY NIGHT", product: LMZ844_GRR, want: "Waves less than 1 foot" },
    { office: "IWX", period: "MONDAY NIGHT", product: LMZ043_IWX, want: "Waves 1 foot or less" },
    {
      office: "MKX",
      period: "TONIGHT",
      product: LMZ645_MKX,
      want: "Waves 2 to 4 feet subsiding to 1 to 2 feet early in the morning",
    },
    { office: "MKX", period: "MONDAY", product: LMZ645_MKX, want: "Waves around 1 foot" },
    { office: "GRB", period: "MONDAY NIGHT", product: LMZ542_GRB, want: "Waves 2 ft or less" },
    { office: "MQT", period: "TONIGHT", product: LMZ221_MQT, want: "Waves subsiding to 1 to 2 feet" },
    { office: "MQT", period: "MONDAY NIGHT", product: LMZ221_MQT, want: "Waves calm to 1 foot" },
  ])("reads $office $period when it leads: $want", ({ product, period, want }) => {
    expect(parseMarineForecast(startingAt(product, period)).waveText).toBe(want);
  });

  it("returns null, not a later period or the header boilerplate, when the first period has no waves", () => {
    const lot = LMZ741_LOT.replace("Sunny. Waves 2 to\n4 ft.", "Sunny.");
    const mqt = LMZ221_MQT.replace(/Mostly sunny\.\nWaves[\s\S]*?8 feet\./, "Mostly sunny.");
    expect(lot).not.toBe(LMZ741_LOT);
    expect(mqt).not.toBe(LMZ221_MQT);
    expect(parseMarineForecast(lot).waveText).toBe(null);
    expect(parseMarineForecast(mqt).waveText).toBe(null);
  });

  it("reads light air, which has no unit, and a unit glued to its number", () => {
    // GRR 2026-10-20 18:06Z and MKX 2026-10-20 10:10Z: 73 of 632 recent products read
    // "No nearshore wave line" because of these. LOT writes "18ft" on rough days.
    const grr = LMZ844_GRR.replace("Sunny.\nWaves 3 to 5 feet.", "Sunny. Waves\ncalm.");
    const mkx = LMZ645_MKX.replace("Sunny.\nWaves 2 to 4 feet.", "Sunny. Waves nearly calm.");
    const lot = LMZ741_LOT.replace("Sunny. Waves 2 to\n4 ft.", "Sunny. Waves 2 to\n4ft.");
    for (const [edited, original] of [[grr, LMZ844_GRR], [mkx, LMZ645_MKX], [lot, LMZ741_LOT]]) {
      expect(edited).not.toBe(original);
    }
    expect(parseMarineForecast(grr).waveText).toBe("Waves calm");
    expect(parseMarineForecast(mkx).waveText).toBe("Waves nearly calm");
    expect(parseMarineForecast(lot).waveText).toBe("Waves 2 to 4ft");
    // ...without mistaking a word that merely ends in "ft" for the unit.
    expect(parseMarineForecast(LMZ741_LOT.replace("Sunny. Waves 2 to\n4 ft.", "Sunny. Waves drift left.")).waveText).toBe(null);
  });

  it("handles CRLF and the trailing spaces live products carry", () => {
    expect(parseMarineForecast(LMZ741_LOT.replace(/\n/g, "\r\n")).waveText).toBe("Waves 2 to 4 ft");
    expect(parseMarineForecast(LMZ741_LOT.replace(/\n/g, " \n")).waveText).toBe("Waves 2 to 4 ft");
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
