import { describe, it, expect } from "vitest";
import { getHarbor, exposureForWind } from "./harbors";

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
