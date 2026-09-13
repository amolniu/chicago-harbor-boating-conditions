import { describe, it, expect } from "vitest";
import {
  assessStation,
  assessDrift,
  stationUsage,
  summarize,
  DARK_AGE_H,
  SENSORLESS,
  isSpotterReference,
  DRIFT_MARK,
  type HealthColumn,
} from "./stationHealth";
import type { BuoyRow } from "./ndbc";

const H = 3600_000;
const NOW = Date.UTC(2026, 8, 4, 12, 0, 0);

/** n rows, newest `ageH` hours old, 10 min apart. `dead` columns are all null. */
function rows(n: number, ageH: number, dead: HealthColumn[] = []): BuoyRow[] {
  const v = (c: HealthColumn, val: number) => (dead.includes(c) ? null : val);
  return Array.from({ length: n }, (_, i) => ({
    time: NOW - ageH * H - i * 600_000,
    windDir: v("windDir", 180),
    windKt: v("windKt", 10),
    gustKt: v("gustKt", 13),
    waveFt: v("waveFt", 1.5),
    wavePeriodS: 3,
    waveDir: 180,
    waterTempF: v("waterTempF", 65),
    airTempF: 70,
  }));
}

const WIND: HealthColumn[] = ["windDir", "windKt", "gustKt"];

/** A file where `dead` columns worked historically and stopped: old rows carry them,
 *  rows inside the recent window don't. This is the real 45198 shape, and the only
 *  one that should read as a fault — see the absent-sensor rule. */
function died(dead: HealthColumn[], n = 100): BuoyRow[] {
  return [...rows(n, 0.1, dead), ...rows(n, 60)];
}

describe("assessStation", () => {
  it("passes a healthy station", () => {
    const r = assessStation("CNII2", rows(200, 0.2), WIND, ["belmont"], NOW);
    expect(r.status).toBe("ok");
    expect(r.findings).toHaveLength(0);
    expect(r.fill.windDir).toBe(1);
  });

  it("catches a whole-station outage, and says why nobody noticed", () => {
    const r = assessStation("CHII2", rows(200, DARK_AGE_H + 400), WIND, ["belmont", "montrose"], NOW);
    expect(r.status).toBe("dark");
    // The CHII2 lesson: live conditions look fine because of the fallback chain,
    // which is exactly why the outage went unnoticed for 16 days.
    expect(r.findings[0]).toMatch(/history freezes/);
  });

  it("catches a fresh feed with a DEAD column — the 45198 case", () => {
    // The failure that hid in plain sight: speed on every row, direction on none.
    const r = assessStation("45198", died(["windDir", "gustKt"]), WIND, ["belmont"], NOW);
    expect(r.status).toBe("degraded");
    expect(r.fill.windKt).toBe(1);
    expect(r.fill.windDir).toBe(0);
    expect(r.findings.join(" ")).toMatch(/wind direction/);
    expect(r.findings.join(" "), "the report must explain the consequence").toMatch(/exposure model/);
  });

  it("does not flag a sensor the platform is DECLARED not to carry", () => {
    // CNII2 is a lakefront met station with no water-temperature probe. Flagging that
    // weekly is how a health report gets ignored — but it is exempt because SENSORLESS
    // says so, never because the data happens to be empty.
    const never = rows(200, 0.1, ["waterTempF"]);
    const r = assessStation("CNII2", never, ["waterTempF"], ["belmont"], NOW);
    expect(r.status).toBe("ok");
    expect(r.absentSensors).toContain("waterTempF");
    expect(SENSORLESS.CNII2).toContain("waterTempF");
  });

  it("flags a permanently dead sensor instead of mistaking it for one that never existed", () => {
    // THE 13 SEPTEMBER BUG. 45198's wind vane died ~35 days ago; once the last working
    // row scrolls out of the 45-day file, an INFERRED absent-sensor rule would call the
    // column "not fitted" and mark the station healthy — going silent on the exact
    // failure this module exists to catch, for a buoy 20 harbors steer by.
    const allNull = rows(200, 0.1, ["windDir"]); // nothing anywhere in the file
    const r = assessStation("45198", allNull, WIND, ["belmont"], NOW);
    expect(r.status, "must not be exempted as 'never had the sensor'").toBe("degraded");
    expect(r.absentSensors, "45198 is not declared sensorless").not.toContain("windDir");
    expect(r.findings.join(" ")).toMatch(/not been reported ONCE/);
    expect(r.findings.join(" "), "says how to silence it legitimately").toMatch(/SENSORLESS/);
  });

  it("every declared-sensorless entry names a real station and real columns", () => {
    // A typo here silently exempts nothing, or worse, exempts the wrong column.
    const valid: HealthColumn[] = ["windDir", "windKt", "gustKt", "waveFt", "waterTempF"];
    for (const [station, cols] of Object.entries(SENSORLESS)) {
      expect(station, "ids are compared uppercase").toBe(station.toUpperCase());
      for (const c of cols) expect(valid).toContain(c);
      expect(cols, "an entry exempting nothing is a mistake").not.toHaveLength(0);
    }
  });

  it("DOES flag a sensor that used to work and stopped", () => {
    // The 45198 case: direction reported for weeks, then died. Old rows carry it,
    // recent rows don't — which is exactly what distinguishes this from the above.
    const old = rows(100, 60).map((r) => ({ ...r })); // outside the 48 h window, has dir
    const fresh = rows(100, 0.1, ["windDir"]); // inside the window, no dir
    const r = assessStation("45198", [...fresh, ...old], WIND, ["belmont"], NOW);
    expect(r.absentSensors, "the sensor existed, so it is not 'absent'").not.toContain("windDir");
    expect(r.status).toBe("degraded");
    expect(r.findings.join(" ")).toMatch(/wind direction/);
  });

  it("measures fill over TIME, not row count — a stalled feed can't hide", () => {
    // 200 perfect rows, all older than the window. Row-count fill would read 100%.
    const stalled = rows(200, 20 * 24);
    const r = assessStation("45161", stalled, WIND, ["muskegon"], NOW);
    expect(r.status).toBe("dark");
    expect(r.rowsSampled, "nothing inside the recent window").toBe(0);
  });

  it("is context-aware: a dead column nobody depends on is not a problem", () => {
    // 45198 is not declared sensorless for temp, so the exemption cannot apply; what
    // decides it here is purely whether a harbor depends on this station for it.
    const unused = assessStation("45198", died(["waterTempF"]), WIND, ["belmont"], NOW);
    expect(unused.status).toBe("ok");
    const used = assessStation("45198", died(["waterTempF"]), ["waterTempF"], ["belmont"], NOW);
    expect(used.status).toBe("degraded");
    expect(used.findings.join(" ")).toMatch(/cold-water warning/);
  });

  it("holds gusts to a looser bar — calm air legitimately reports none", () => {
    const sparseGust = rows(200, 0.1).map((r, i) => ({ ...r, gustKt: i % 4 === 0 ? 13 : null }));
    expect(assessStation("X", sparseGust, WIND, ["a"], NOW).status).toBe("ok"); // 25% > 20% floor
    const noGust = died(["gustKt"]);
    expect(assessStation("X", noGust, WIND, ["a"], NOW).status).toBe("degraded");
  });

  it("reports an unreachable feed as unknown rather than dark", () => {
    // A fetch failure is not evidence the station is down; don't cry wolf.
    const r = assessStation("SYWW3", [], WIND, ["a"], NOW);
    expect(r.status).toBe("unknown");
    expect(r.ageHours).toBeNull();
  });
});

describe("assessDrift", () => {
  const many = (v: number) => Array(24).fill(v);

  it("fails a station reading LOW against a real anemometer", () => {
    const d = assessDrift("KWNW3", many(5), "45186", 13, many(10));
    expect(d.status).toBe("under");
    expect(d.ratio).toBeCloseTo(0.5, 2);
    expect(d.finding).toMatch(/safer than they are/);
  });

  it("the real KWNW3 was measured against a SPOTTER, so it only reads as suspect", () => {
    // Worth pinning honestly rather than pretending otherwise. KWNW3 (0.9 km off the
    // marina, reading half the true wind) was caught at 0.51x a Spotter — and a Spotter's
    // own 1.1-1.9x bias produces that ratio from a HEALTHY station too, so the comparison
    // alone could not prove it. It was confirmed only when the model wind at the same spot
    // read 1.10x that same Spotter. The validator therefore surfaces this loudly without
    // failing, and the finding must tell the reader what would settle it.
    const d = assessDrift("KWNW3", many(5), "SPOT-30949C", 13, many(10));
    expect(d.status).toBe("suspect");
    expect(d.finding).toMatch(/second anemometer/);
  });

  it("only notes a station reading high — conservative is not a fault", () => {
    expect(assessDrift("MNMM4", many(20), "45186", 23, many(10)).status).toBe("over");
  });

  it("does NOT fail a low ratio measured against a Spotter", () => {
    // Spotters read 1.1-1.9x a real anemometer, so a healthy station lands at 0.5-0.9
    // against one. Three good stations (grand-haven, whitehall, fayette) were being
    // marked bad every run by this exact comparison. A check that cries wolf is one
    // nobody reads, which is how the next genuine 0.51x station slips through.
    const d = assessDrift("FPTM4", many(7), "SPOT-30364R", 26, many(17));
    expect(d.status).toBe("suspect");
    expect(d.finding).toMatch(/Sofar Spotter/);
    expect(d.finding, "tells the reader what would settle it").toMatch(/second anemometer/);
  });

  it("still fails the SAME ratio when the reference is a real anemometer", () => {
    // The pair that matters: identical numbers, opposite verdicts, decided only by what
    // the reference is. This is the line between a false alarm and a real KWNW3.
    const spotter = assessDrift("X", many(7), "SPOT-30364R", 26, many(17));
    const anemometer = assessDrift("X", many(7), "45186", 26, many(17));
    expect(spotter.ratio).toBeCloseTo(anemometer.ratio, 6);
    expect(spotter.status).toBe("suspect");
    expect(anemometer.status).toBe("under");
  });

  it("recognises Spotter ids, and nothing else", () => {
    expect(isSpotterReference("SPOT-30364R")).toBe(true);
    expect(isSpotterReference("spot-1234")).toBe(true);
    expect(isSpotterReference(" SPOT-42 ")).toBe(true);
    expect(isSpotterReference("45186")).toBe(false);
    expect(isSpotterReference("CNII2")).toBe(false);
    expect(isSpotterReference("Sturgeon Bay Spotter"), "name, not an id").toBe(false);
  });

  it("marks only `under` as a failure symbol", () => {
    // The validator fails the run on "!!" alone; if another status ever gained that
    // marker the run would start breaking on non-faults.
    expect(DRIFT_MARK.under).toBe("!!");
    expect(DRIFT_MARK.suspect).not.toBe("!!");
    expect(DRIFT_MARK.over).not.toBe("!!");
    expect(DRIFT_MARK.ok).not.toBe("!!");
  });

  it("stays quiet on thin samples", () => {
    expect(assessDrift("X", [5], "R", 5, [10]).status).toBe("insufficient");
  });
});

describe("GLOS sources are monitored too", () => {
  const GLOS = { kind: "glos" as const, label: "Bay de Noc Spotter" };

  it("appears in the usage map with only the series its ref declares", () => {
    // The Bay de Noc Spotter (ds 695) is the LIVE WIND source for two harbors, and every
    // GLOS platform was invisible to this check until 2026-09-13.
    const u = stationUsage().find((x) => x.station === "glos:695")!;
    expect(u.kind).toBe("glos");
    expect(u.columns).toContain("windKt");
    expect(u.columns).toContain("waveFt");
    expect(u.columns, "Spotters report speed only, never a bearing").not.toContain("windDir");
    expect(u.harbors).toEqual(["escanaba", "gladstone"]);
  });

  it("a wave-only Spotter is not graded on wind", () => {
    const u = stationUsage().find((x) => x.station === "glos:671")!; // Grand Haven
    expect(u.columns).toContain("waveFt");
    expect(u.columns).not.toContain("windKt");
  });

  it("every GLOS platform in config is monitored, and no NDBC id collides with one", () => {
    const usage = stationUsage();
    const glos = usage.filter((u) => u.kind === "glos");
    expect(glos.length, "five Spotters are wired in harbors.ts").toBe(5);
    for (const u of glos) expect(u.glos, "the caller needs the ref to fetch it").toBeTruthy();
    expect(new Set(usage.map((u) => u.station)).size).toBe(usage.length);
  });

  it("a dark Spotter says it may simply be the off-season", () => {
    // Spotters are pulled for the winter. If every dark one screamed, this report would be
    // red from October to April and nobody would read it in July when it matters.
    const r = assessStation("glos:671", rows(200, 400), ["waveFt"], ["grand-haven"], NOW, GLOS);
    expect(r.status).toBe("dark");
    expect(r.findings.join(" ")).toMatch(/seasonal/i);
    expect(r.findings.join(" "), "names the fallback").toMatch(/gridpoint/i);
    expect(r.label).toBe("Bay de Noc Spotter");
  });

  it("losing a wave Spotter does not fail the run; losing a WIND Spotter does", () => {
    // The distinction that matters. A lost wave/temp Spotter degrades to the gridpoint —
    // documented and acceptable. A lost wind Spotter drops Escanaba and Gladstone onto a
    // model that reads 0.72x a same-site anemometer: optimistic, the dangerous direction.
    const waveOnly = assessStation("glos:671", rows(200, 400), ["waveFt"], ["grand-haven"], NOW, GLOS);
    expect(summarize([waveOnly], []).ok, "seasonal wave outage is not a failure").toBe(true);

    const windSource = assessStation("glos:695", rows(200, 400), ["waveFt", "windKt"], ["escanaba", "gladstone"], NOW, GLOS);
    expect(summarize([windSource], []).ok, "a dark WIND source must fail").toBe(false);
    expect(windSource.findings.join(" ")).toMatch(/0\.72/);
    expect(windSource.findings.join(" ")).toMatch(/optimistic/);
  });

  it("still reports both kinds as problems even when only one fails the run", () => {
    const waveOnly = assessStation("glos:671", rows(200, 400), ["waveFt"], ["grand-haven"], NOW, GLOS);
    const s = summarize([waveOnly], []);
    expect(s.problems, "reported, just not fatal").toHaveLength(1);
    expect(s.ok).toBe(true);
  });
});

describe("stationUsage", () => {
  it("knows 45198 drives wind direction for the whole Chicago fleet", () => {
    // This is the fact that made its dead sensor critical rather than cosmetic.
    const u = stationUsage().find((s) => s.station === "45198")!;
    expect(u.columns).toContain("windDir");
    expect(u.harbors.length).toBeGreaterThan(5);
    expect(u.harbors).toContain("belmont");
  });

  it("does not attribute waves to a wind-only station", () => {
    // CNII2 is a lakefront met station in WIND_FALLBACK with no wave sensor. Columns
    // must follow the role, or the checker grades a station on data nobody reads.
    // (The mirror case — a wave-only station — no longer exists: every waveBuoy is
    // now also somebody's wind source, which is why this asserts the other direction.)
    const u = stationUsage().find((s) => s.station === "CNII2")!;
    expect(u.columns).toContain("windKt");
    expect(u.columns).not.toContain("waveFt");
  });

  it("drops a station once no harbor references it", () => {
    // 45199 and MCYI3 were retired on 2026-09-04. A checker that keeps polling
    // retired stations reports permanent red rows for nothing, which is how the
    // report trains people to ignore it.
    const ids = stationUsage().map((s) => s.station);
    expect(ids).not.toContain("45199");
    expect(ids).not.toContain("MCYI3");
    expect(ids, "45187 took over as a wind source").toContain("45187");
  });
});

describe("summarize", () => {
  it("sorts worst first and fails only on real problems", () => {
    const ok = assessStation("A", rows(50, 0.1), WIND, ["a"], NOW);
    const dark = assessStation("B", rows(50, 99), WIND, ["b"], NOW);
    const degraded = assessStation("C", died(["windDir"], 50), WIND, ["c"], NOW);
    const unknown = assessStation("D", [], WIND, ["d"], NOW);
    const s = summarize([ok, unknown, degraded, dark], []);
    expect(s.stations.map((x) => x.station)).toEqual(["B", "C", "D", "A"]);
    expect(s.ok).toBe(false);
  });

  it("does not fail on unknown or conservative drift alone", () => {
    const unknown = assessStation("D", [], WIND, ["d"], NOW);
    const over = assessDrift("X", Array(24).fill(20), "R", 5, Array(24).fill(10));
    const s = summarize([unknown], [over]);
    expect(s.driftProblems).toHaveLength(1);
    expect(s.ok, "a fetch blip and a conservative reading are not failures").toBe(true);
  });
});
