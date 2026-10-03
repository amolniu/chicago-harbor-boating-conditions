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
