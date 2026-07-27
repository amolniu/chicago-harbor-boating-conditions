import { describe, it, expect } from "vitest";
import { harborIntel } from "./intel";
import { getHarbor } from "./harbors";
import { getBoat } from "./boats";
import { Conditions } from "./types";

function cond(p: Partial<Conditions>): Conditions {
  return {
    windDir: 45, windKt: 10, gustKt: 12, waveFt: 1, wavePeriodS: 5, waveDir: 45,
    waterTempF: 70, airTempF: 72, advisory: "none", source: "test", observedAt: null,
    ...p,
  };
}

const belmont = getHarbor("belmont")!;
const catalina = getBoat("catalina30");

describe("harborIntel", () => {
  it("always includes the three base facets, each keeping its local note", () => {
    const items = harborIntel(belmont, cond({}), catalina, "intermediate");
    for (const label of ["Entrance", "Docking", "Hazards"]) {
      const item = items.find((i) => i.label === label)!;
      expect(item).toBeTruthy();
      expect(item.note && item.note.length).toBeGreaterThan(0);
    }
  });

  it("entrance read flips with wind direction via the exposure model", () => {
    // Same 4.5 ft on the lake: NE piles it on Belmont's gap; SW is offshore.
    const ne = harborIntel(belmont, cond({ windDir: 45, windKt: 16, waveFt: 4.5 }), catalina, "intermediate");
    const sw = harborIntel(belmont, cond({ windDir: 225, windKt: 16, waveFt: 4.5 }), catalina, "intermediate");
    expect(ne.find((i) => i.label === "Entrance")!.severity).toBe("alert");
    expect(sw.find((i) => i.label === "Entrance")!.severity).toBe("ok");
  });

  it("cold-water severity is personalized to the boat", () => {
    const chilly = cond({ waterTempF: 65 });
    const kayak = harborIntel(belmont, chilly, getBoat("kayak-sup"), "intermediate").find((i) => i.label === "Cold water & safety")!;
    const keel = harborIntel(belmont, chilly, getBoat("beneteau40"), "intermediate").find((i) => i.label === "Cold water & safety")!;
    expect(kayak.severity).toBe("watch");
    expect(keel.severity).toBe("ok");
  });

  it("never gives a paddler sailing advice (no reef/helm/slip/motor)", () => {
    const kayak = getBoat("kayak-sup");
    const jargon = /reef|helm|round you up|ghosting|motor|slip\b|steerage|MOB/i;
    // Sweep a range of conditions so every wording branch gets exercised.
    const cases = [
      cond({ windDir: 45, windKt: 4, gustKt: 5 }), // light
      cond({ windDir: 45, windKt: 9, gustKt: 11 }), // steady
      cond({ windDir: 45, windKt: 8, gustKt: 18 }), // gusty
      cond({ windDir: 45, windKt: 20, gustKt: 26, waveFt: 3 }), // strong
      cond({ windDir: 225, windKt: 10, gustKt: 12 }), // offshore at Belmont
      cond({ waterTempF: 52 }), // cold water
    ];
    for (const c of cases) {
      for (const item of harborIntel(belmont, c, kayak, "intermediate")) {
        expect(item.impact, `"${item.impact}"`).not.toMatch(jargon);
      }
    }
  });

  it("warns a paddler about an offshore wind, but not a keelboat", () => {
    // SW at Belmont blows off the land — trivial for a sailboat, the classic
    // way a paddler gets blown out and can't get back.
    const offshore = cond({ windDir: 225, windKt: 11, gustKt: 13 });
    const kayak = harborIntel(belmont, offshore, getBoat("kayak-sup"), "intermediate").find((i) => i.label === "Wind & handling")!;
    const keel = harborIntel(belmont, offshore, getBoat("beneteau40"), "intermediate").find((i) => i.label === "Wind & handling")!;
    expect(kayak.impact).toMatch(/offshore/i);
    expect(kayak.severity).toBe("watch");
    expect(keel.impact).not.toMatch(/offshore/i);
    expect(keel.severity).toBe("ok");
  });

  it("relabels docking as launch & landing for a paddler", () => {
    const items = harborIntel(belmont, cond({}), getBoat("kayak-sup"), "intermediate");
    expect(items.find((i) => i.label === "Launch & landing")).toBeTruthy();
    expect(items.find((i) => i.label === "Docking")).toBeUndefined();
  });

  it("wind severity and wording agree when it's strong but steady", () => {
    // gusts exceed the boat's max, but the spread is small (not 'gusty')
    const strongSteady = cond({ windDir: 225, windKt: 24, gustKt: 26, waveFt: 1 });
    const w = harborIntel(belmont, strongSteady, catalina, "intermediate").find((i) => i.label === "Wind & handling")!;
    expect(w.severity).toBe("alert");
    expect(w.impact).not.toMatch(/predictable/i); // the mismatch we fixed
  });
});
