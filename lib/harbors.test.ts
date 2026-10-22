import { describe, it, expect } from "vitest";
import {
  getHarbor,
  exposureForWind,
  HARBORS,
  REGIONS,
  regionOf,
  windNeighbors,
  NEIGHBOR_STATIONS,
  MAX_NEIGHBOR_KM,
  harborZones,
} from "./harbors";

const belmont = getHarbor("belmont")!; // Chicago west shore (openWaterBearing unset)
const stjoe = getHarbor("st-joseph")!; // Michigan east shore (openWaterBearing set)

describe("shore-aware fetch orientation", () => {
  it("west shore (Chicago): onshore from the NE/E, offshore from the W", () => {
    expect(exposureForWind(belmont, 45)).toBeGreaterThan(exposureForWind(belmont, 270));
  });

  it("east shore (Michigan): mirrored — onshore from the W, offshore from the E", () => {
    expect(exposureForWind(stjoe, 270)).toBeGreaterThan(exposureForWind(stjoe, 90));
  });

  it("the SAME west wind is a big wave-maker at St. Joseph but offshore/calm at Belmont", () => {
    expect(exposureForWind(stjoe, 270)).toBeGreaterThan(exposureForWind(belmont, 270));
  });
});

describe("same-shore wind neighbours (never across the lake)", () => {
  const station = (id: string) => NEIGHBOR_STATIONS.find((s) => s.id === id)!;
  const km = (aLat: number, aLon: number, bLat: number, bLon: number) => {
    const R = 6371, p = Math.PI / 180;
    return 2 * R * Math.asin(Math.sqrt(Math.sin(((bLat - aLat) * p) / 2) ** 2 +
      Math.cos(aLat * p) * Math.cos(bLat * p) * Math.sin(((bLon - aLon) * p) / 2) ** 2));
  };

  it("every harbor borrows only from its own shore, within reach, nearest first", () => {
    // The invariant, over every harbor, so a new one can't reintroduce the old global
    // Chicago list — under which a dark 45161 put Grand Haven, Muskegon and Whitehall on
    // Chicago wind from 170-200 km across the lake.
    const shoreOf = (id: string) =>
      regionOf(id) === "michigan-east" ? "east" : regionOf(id) === "green-bay" ? null : "west";
    for (const h of HARBORS) {
      const n = windNeighbors(h);
      const dists = n.map((id) => km(h.lat, h.lon, station(id).lat, station(id).lon));
      for (const [i, id] of n.entries()) {
        expect(station(id).shore, `${h.id} borrows ${id}`).toBe(shoreOf(h.id));
        expect(dists[i], `${h.id} -> ${id}`).toBeLessThanOrEqual(MAX_NEIGHBOR_KM[station(id).shore]);
        expect(id, `${h.id} lists its own station`).not.toBe(h.buoyStation);
        if (i > 0) expect(dists[i], `${h.id} order`).toBeGreaterThanOrEqual(dists[i - 1]);
      }
    }
  });

  it("the harbors that used to borrow across the lake now borrow nothing, and use their model", () => {
    for (const id of ["grand-haven", "muskegon", "whitehall"]) {
      expect(windNeighbors(getHarbor(id)!), id).toEqual([]);
    }
  });

  it("the north shore leans on its own buoys first, with Chicago's crib and buoy as same-shore backup", () => {
    // Both north-shore buoys are deployed and pulled on the same days, so Southport and
    // North Point need a year-round same-shore station before the model — measured: the
    // Chicago Buoy tracks 45187 at 1.08x (r 0.76) from 69 km.
    for (const id of ["southport", "north-point"]) {
      const n = windNeighbors(getHarbor(id)!);
      expect(n[0], id).toBe("45186");
      expect(n, id).toEqual(expect.arrayContaining(["CHII2", "45198"]));
    }
  });

  it("the reach is per shore: east-shore stations 88 km apart barely track, so they stay out", () => {
    expect(MAX_NEIGHBOR_KM.east).toBeLessThan(MAX_NEIGHBOR_KM.west);
    // South Haven's 45168 is ~74 km from Grand Haven: inside the west-shore reach, outside the east's.
    expect(windNeighbors(getHarbor("grand-haven")!)).not.toContain("45168");
  });

  it("the Chicago fleet keeps its lakefront crib first", () => {
    expect(windNeighbors(getHarbor("belmont")!)[0]).toBe("CHII2");
  });

  it("never borrows from a station measured to read low (CMTI2 0.65x, CNII2 0.73x)", () => {
    // Borrowing from a station known to read low errs in the dangerous direction.
    for (const bad of ["CMTI2", "CNII2"]) {
      expect(NEIGHBOR_STATIONS.map((s) => s.id)).not.toContain(bad);
      for (const h of HARBORS) expect(windNeighbors(h), `${h.id} / ${bad}`).not.toContain(bad);
    }
  });

  it("windFromGrid harbors borrow nothing: their fallback is their own model", () => {
    for (const h of HARBORS.filter((x) => x.windFromGrid)) expect(windNeighbors(h), h.id).toEqual([]);
  });
});

describe("marine zones (the water the harbor opens onto)", () => {
  it("every zone id is a well-formed Lake Michigan nearshore zone, listed once", () => {
    // A well-formed but WRONG zone id returns "no alerts" from NWS rather than an error,
    // so a typo here would read as all-clear. Shape is the most a unit test can check;
    // the zone polygons themselves were verified against api.weather.gov on 2026-10-17.
    for (const h of HARBORS) {
      const zones = harborZones(h);
      expect(zones[0], h.id).toBe(h.marineZone);
      for (const z of zones) expect(z, h.id).toMatch(/^LMZ\d{3}$/);
      expect(new Set(zones).size, `${h.id} lists a zone twice`).toBe(zones.length);
    }
  });

  it("pins the seven corrections of 2026-10-18", () => {
    // The north-side Chicago harbors open onto LMZ741 (Wilmette Harbor to Northerly
    // Island); LMZ742 starts south of Northerly Island. St Joseph sits in LMZ844 (the
    // old LMZ043 came from a lookup point nudged 3 km west), and Whitehall's channel
    // exits into LMZ847.
    for (const id of ["montrose", "belmont", "diversey", "dusable", "monroe"]) {
      expect(getHarbor(id)!.marineZone, id).toBe("LMZ741");
    }
    expect(getHarbor("st-joseph")!.marineZone).toBe("LMZ844");
    expect(getHarbor("whitehall")!.marineZone).toBe("LMZ847");
  });

  it("pins the post-deploy corrections of 2026-10-18", () => {
    // Grand Haven: both pierheads sit in LMZ846; the 846/847 boundary reaches shore
    // ~0.4 km north of the mouth. The downtown marina point is ~1 km north of the channel,
    // which is how 847 got picked as primary.
    expect(getHarbor("grand-haven")!.marineZone).toBe("LMZ846");
    // Monroe: the 741/742 boundary runs east from Northerly Island ~0.5 km south of the
    // south gap, so a southbound departure is in 742 within a kilometre — same water as Burnham.
    expect(harborZones(getHarbor("monroe")!)).toContain("LMZ742");
  });

  it("boundary harbors watch both zones", () => {
    const both: Record<string, string[]> = {
      burnham: ["LMZ742", "LMZ741"],
      monroe: ["LMZ741", "LMZ742"],
      "north-point": ["LMZ646", "LMZ740"],
      "st-joseph": ["LMZ844", "LMZ043"],
      "new-buffalo": ["LMZ046", "LMZ043"],
      "south-haven": ["LMZ844", "LMZ845"],
      "grand-haven": ["LMZ846", "LMZ847"],
      whitehall: ["LMZ847", "LMZ848"],
      "cedar-river": ["LMZ221", "LMZ521"],
    };
    for (const [id, zones] of Object.entries(both)) expect(harborZones(getHarbor(id)!), id).toEqual(zones);
  });
});

describe("regions", () => {
  it("every harbor maps to exactly one known region", () => {
    const known = new Set(REGIONS.map((r) => r.id));
    for (const h of HARBORS) {
      const r = regionOf(h.id);
      expect(r, `${h.id} has no region`).toBeDefined();
      expect(known.has(r!), `${h.id} → unknown region ${r}`).toBe(true);
    }
  });
});
