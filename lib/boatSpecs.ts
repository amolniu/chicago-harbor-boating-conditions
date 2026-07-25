// User-added boats. A BoatSpec (what the user enters/looks up) is reduced to a
// BoatProfile — the exact shape lib/rating.ts already consumes — so custom boats
// flow through scoring, Harbor Intelligence, and the sail window unchanged.
//
// Scoring is grounded in real seaworthiness specs:
//  - ISO 12217 design category (A/B/C/D) → base wind/wave thresholds.
//  - Capsize Screening Formula (beam + displacement) → primary refinement.
//  - Angle of Vanishing Stability (estimated from dimensions, or user-entered)
//    → secondary refinement. Its exact formula needs canoe-body draft (not a
//    listed spec), so it is an ESTIMATE.

import { BoatProfile } from "./boats";

export type BoatCategory = "A" | "B" | "C" | "D";

export interface BoatSpec {
  id: string; // "custom:<uuid>"
  name: string;
  category: BoatCategory;
  loaFt?: number | null;
  beamFt?: number | null;
  displacementLb?: number | null;
  ballastLb?: number | null;
  draftFt?: number | null;
  /** User-supplied AVS (deg); overrides the estimate when present. */
  avsOverride?: number | null;
}

export const CATEGORY_LABEL: Record<BoatCategory, string> = {
  A: "A — Ocean",
  B: "B — Offshore",
  C: "C — Coastal / inshore",
  D: "D — Sheltered waters",
};

// Base thresholds per ISO category, scaled from the design wind/wave limits to
// day-sail comfort and aligned with the built-in boats (lib/boats.ts):
// D ≈ kayak/daysailer, C ≈ J/24 · Catalina, B/A ≈ Beneteau 40.
const CATEGORY_BASE: Record<BoatCategory, Omit<BoatProfile, "id" | "name">> = {
  A: { windCalmKt: 18, windMaxKt: 32, waveCalmFt: 4.5, waveMaxFt: 8.0, crosswindMaxKt: 24 },
  B: { windCalmKt: 15, windMaxKt: 27, waveCalmFt: 3.5, waveMaxFt: 6.0, crosswindMaxKt: 22 },
  C: { windCalmKt: 12, windMaxKt: 22, waveCalmFt: 2.5, waveMaxFt: 4.5, crosswindMaxKt: 18 },
  D: { windCalmKt: 8, windMaxKt: 15, waveCalmFt: 1.0, waveMaxFt: 2.5, crosswindMaxKt: 12 },
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Capsize Screening Formula = beam / (disp_lb / 64)^(1/3). Lower = stiffer/safer. */
export function computeCSF(spec: BoatSpec): number | null {
  if (!spec.beamFt || !spec.displacementLb) return null;
  return spec.beamFt / Math.cbrt(spec.displacementLb / 64);
}

/**
 * Angle of Vanishing Stability (deg). Uses the user override if given, else
 * estimates via AVS ≈ 110 + 400/(SSV−10). Canoe-body ("hull") draft isn't a
 * listed spec, so it's approximated from total draft — hence an estimate.
 */
export function estimateAVS(spec: BoatSpec): number | null {
  if (spec.avsOverride != null) return clamp(spec.avsOverride, 60, 160);
  const { beamFt, displacementLb, ballastLb, draftFt } = spec;
  if (!beamFt || !displacementLb || !ballastLb || !draftFt) return null;
  const beamM = beamFt * 0.3048;
  const dispKg = displacementLb * 0.453592;
  const dv = dispKg / 1025; // displacement volume, m³ (seawater)
  const br = ballastLb / displacementLb; // ballast ratio
  const hullDraftM = draftFt * 0.3048 * 0.35; // rough canoe-body fraction of total draft
  const ssv = (beamM * beamM) / (br * hullDraftM * Math.cbrt(dv));
  if (ssv <= 10) return 150; // very stiff → effectively self-righting
  return clamp(110 + 400 / (ssv - 10), 80, 150);
}

/** Reduce a BoatSpec to a scoring BoatProfile. */
export function deriveBoatProfile(spec: BoatSpec): BoatProfile {
  const base = CATEGORY_BASE[spec.category];

  const csf = computeCSF(spec);
  const avs = estimateAVS(spec);
  const csfFactor = csf != null ? clamp(1 + (2.0 - csf) * 0.1, 0.85, 1.15) : 1;
  const avsFactor = avs != null ? clamp(1 + (avs - 115) / 250, 0.9, 1.1) : 1;
  const f = clamp(csfFactor * avsFactor, 0.8, 1.2);

  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    id: spec.id,
    name: spec.name,
    windCalmKt: Math.round(base.windCalmKt * f),
    windMaxKt: Math.min(40, Math.round(base.windMaxKt * f)),
    waveCalmFt: r1(base.waveCalmFt * f),
    waveMaxFt: Math.min(10, r1(base.waveMaxFt * f)),
    crosswindMaxKt: Math.round(base.crosswindMaxKt * f),
  };
}
