// Boat profiles and skill modifiers. Different vessels have very different
// comfort envelopes: a paddleboard is done at 12 kt, a Beneteau 40 is just
// warming up. Each profile gives the wind/wave levels where conditions go from
// green → yellow (`calm`) and yellow → red (`max`). Skill scales those limits.

/** What you're actually on. Drives craft-appropriate copy: a paddler has no reef,
 *  no helm, and no slip, and cares about being blown offshore. Default "sail". */
export type CraftKind = "sail" | "paddle";

export interface BoatProfile {
  id: string;
  name: string;
  /** Wind (kt) up to which it's comfortable / green. */
  windCalmKt: number;
  /** Wind (kt) beyond which it's red. */
  windMaxKt: number;
  /** Wave height (ft) up to which it's comfortable / green. */
  waveCalmFt: number;
  /** Wave height (ft) beyond which it's red. */
  waveMaxFt: number;
  /** Crosswind (kt) across the entrance that starts to bite when docking. */
  crosswindMaxKt: number;
  /** Craft type, for craft-appropriate copy + the green call to action. Default "sail". */
  craft?: CraftKind;
}

export const BOATS: BoatProfile[] = [
  { id: "kayak-sup", name: "Kayak / Paddleboard", windCalmKt: 8, windMaxKt: 14, waveCalmFt: 0.7, waveMaxFt: 1.5, crosswindMaxKt: 12, craft: "paddle" },
  { id: "daysailer", name: "18 ft Daysailer", windCalmKt: 10, windMaxKt: 18, waveCalmFt: 1.5, waveMaxFt: 3.0, crosswindMaxKt: 15 },
  { id: "hobie", name: "Hobie Cat", windCalmKt: 12, windMaxKt: 22, waveCalmFt: 2.0, waveMaxFt: 4.0, crosswindMaxKt: 20 },
  { id: "j24", name: "J/24", windCalmKt: 12, windMaxKt: 22, waveCalmFt: 2.5, waveMaxFt: 4.5, crosswindMaxKt: 18 },
  { id: "catalina30", name: "Catalina 30", windCalmKt: 15, windMaxKt: 25, waveCalmFt: 3.0, waveMaxFt: 5.0, crosswindMaxKt: 20 },
  { id: "beneteau40", name: "Beneteau 40", windCalmKt: 18, windMaxKt: 30, waveCalmFt: 4.0, waveMaxFt: 7.0, crosswindMaxKt: 24 },
];

export const DEFAULT_BOAT_ID = "catalina30";

export function getBoat(id: string): BoatProfile {
  return BOATS.find((b) => b.id === id) ?? BOATS.find((b) => b.id === DEFAULT_BOAT_ID)!;
}

export type Skill = "beginner" | "intermediate" | "advanced";

export const SKILLS: { id: Skill; name: string; factor: number }[] = [
  { id: "beginner", name: "Beginner", factor: 0.75 },
  { id: "intermediate", name: "Intermediate", factor: 1.0 },
  { id: "advanced", name: "Advanced", factor: 1.2 },
];

export const DEFAULT_SKILL: Skill = "intermediate";

export function skillFactor(skill: Skill): number {
  return SKILLS.find((s) => s.id === skill)?.factor ?? 1.0;
}
