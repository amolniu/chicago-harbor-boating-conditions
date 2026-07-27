// Condition-aware Harbor Intelligence. Each item pairs the harbor's static local
// knowledge (from lib/harbors.ts notes) with a live "what this means right now"
// read derived from current conditions + the exposure model, personalized to the
// user's boat and skill. Pure/isomorphic so the browser recomputes it on toggle.

import { Conditions } from "./types";
import { Harbor, exposureForWind, crosswindKt } from "./harbors";
import { BoatProfile, Skill, skillFactor } from "./boats";
import { degToCompass } from "./units";

export type IntelSeverity = "ok" | "watch" | "alert";

export interface IntelItem {
  label: string;
  /** Live interpretation of the current conditions for this feature. */
  impact: string;
  /** Static local knowledge (present for the harbor's base facets). */
  note?: string;
  severity: IntelSeverity;
}

const NO_WIND = "No live wind reading — see the local note below.";

function sev(value: number, calm: number, max: number): IntelSeverity {
  if (value >= max) return "alert";
  if (value >= calm) return "watch";
  return "ok";
}

export function harborIntel(harbor: Harbor, c: Conditions, boat: BoatProfile, skill: Skill): IntelItem[] {
  const sf = skillFactor(skill);
  const waveCalm = boat.waveCalmFt * sf;
  const waveMax = boat.waveMaxFt * sf;

  const hasWind = c.windKt != null && c.windDir != null;
  const dir = c.windDir != null ? degToCompass(c.windDir) : "";
  const windKt = c.windKt ?? 0;
  const gustKt = c.gustKt ?? windKt;
  const waveFt = c.waveFt;
  const period = c.wavePeriodS;
  const shortP = period != null && period <= 4;
  // A paddler has no reef, no helm and no slip, and the danger that matters most is
  // being blown offshore — so several reads below need craft-appropriate wording.
  const paddle = boat.craft === "paddle";

  const items: IntelItem[] = [];

  // Entrance — effective wave at the mouth via the exposure model.
  {
    let impact = NO_WIND;
    let severity: IntelSeverity = "ok";
    if (hasWind && waveFt != null) {
      const exposure = exposureForWind(harbor, c.windDir!);
      const entranceWave = waveFt * exposure;
      severity = sev(entranceWave, waveCalm, waveMax);
      const exposedHit = harbor.exposedDirs?.includes(degToCompass(c.windDir!));
      if (exposure < 0.35) {
        impact = `${dir} wind is blowing offshore here — the mouth is sheltered, only ~${entranceWave.toFixed(1)} ft right now.`;
      } else if (severity === "alert") {
        impact = `${dir} wind is stacking ~${entranceWave.toFixed(1)} ft onto the entrance${exposedHit ? ", hitting the breakwall gap head-on" : ""} — steep, confused approach.`;
      } else if (severity === "watch") {
        impact = `${dir} wind is putting ~${entranceWave.toFixed(1)} ft on the entrance — passable, but lumpy through the gap.`;
      } else {
        impact = `Only ~${entranceWave.toFixed(1)} ft at the entrance — an easy approach right now.`;
      }
    }
    items.push({ label: "Entrance", note: harbor.notes.entrance, impact, severity });
  }

  // Docking / landing — crosswind across the channel and slips (or the launch).
  {
    let impact = NO_WIND;
    let severity: IntelSeverity = "ok";
    if (hasWind) {
      const cross = crosswindKt(harbor, c.windDir!, windKt);
      severity = sev(cross, boat.crosswindMaxKt * sf * 0.6, boat.crosswindMaxKt * sf);
      const kt = Math.round(cross);
      if (paddle) {
        impact =
          severity === "alert"
            ? `${kt} kt of crosswind across the mouth — it shoves you sideways the moment you stop paddling. Land bow-into the wind and expect to be set down onto whatever is downwind of you.`
            : severity === "watch"
              ? `${kt} kt of crosswind at the entrance — a noticeable side push. Keep paddling through the gap instead of coasting, and aim upwind of your landing.`
              : `Only ${kt} kt of crosswind across the entrance — an easy launch and landing.`;
      } else {
        impact =
          severity === "alert"
            ? `${kt} kt of crosswind across the mouth — set up early, hold steerage, and expect to crab into the slip.`
            : severity === "watch"
              ? `${kt} kt of crosswind at the entrance — noticeable; carry a little extra speed and commit to the approach.`
              : `Only ${kt} kt of crosswind across the entrance — docking should be straightforward.`;
      }
    }
    items.push({ label: paddle ? "Launch & landing" : "Docking", note: harbor.notes.docking, impact, severity });
  }

  // Hazards — how much the sea state is activating the local hazards.
  {
    let impact = "No live wave reading — see the local note below.";
    let severity: IntelSeverity = "ok";
    if (waveFt != null) {
      severity = waveFt >= waveMax || (waveFt >= waveCalm && shortP) ? "alert" : waveFt >= waveCalm ? "watch" : "ok";
      impact =
        severity === "ok"
          ? `Calm water (~${waveFt.toFixed(1)} ft) — low risk right now, but the hazards below still apply.`
          : `With ${waveFt.toFixed(1)} ft running${shortP ? ` at a short ${Math.round(period!)} s period` : ""}, the hazards below are at their worst — give them room.`;
    }
    items.push({ label: "Hazards", note: harbor.notes.hazards, impact, severity });
  }

  // Wind & handling — gustiness and power for this boat.
  if (hasWind) {
    const strong = gustKt >= boat.windMaxKt * sf;
    const gusty = gustKt - windKt >= 8 || (windKt > 0 && gustKt / windKt >= 1.4);
    const w = Math.round(windKt);
    const g = Math.round(gustKt);
    const light = windKt < boat.windCalmKt * sf * 0.5;
    // For a paddler, an offshore wind is the classic way to get in trouble: the way
    // out is effortless and the way back is straight upwind. The exposure model
    // already tells us when the wind is blowing off the land here.
    const offshore = paddle && !light && exposureForWind(harbor, c.windDir!) < 0.35;
    const severity: IntelSeverity = strong ? "alert" : gusty || offshore ? "watch" : "ok";
    let impact: string;
    if (paddle) {
      if (strong) {
        impact = `Strong${gusty ? " and gusty" : ""} — ${w} kt sustained, gusts to ${g}, past what a ${boat.name} handles. It will blow you downwind faster than you can paddle back; stay off the water.`;
      } else if (offshore) {
        impact = `${dir} ${w} kt is blowing offshore here — an easy paddle out and a hard slog back, and that catches people out. Stay close in and keep the return leg in mind.`;
      } else if (gusty) {
        impact = `Gusty — sustained ${w} kt, gusts to ${g}. Puffs will swing the bow and knock you off balance; stay near shore and pick a landmark to hold your line.`;
      } else if (light) {
        impact = `Light ${dir} ${w} kt — easy, glassy paddling.`;
      } else {
        impact = `Steady ${dir} ${w} kt — manageable. Head out into the wind so the tired leg home is downwind.`;
      }
    } else if (gusty && strong) {
      impact = `Strong and gusty — ${w} kt sustained, gusts to ${g}, past what a ${boat.name} wants. Reef down and sail conservative.`;
    } else if (gusty) {
      impact = `Gusty — sustained ${w} kt, gusts to ${g}. Reef early; the puffs will round you up.`;
    } else if (strong) {
      impact = `Strong, steady ${dir} ${w} kt, gusts to ${g} near your limit — a handful; a reef will settle the helm.`;
    } else if (light) {
      impact = `Light ${dir} ${w} kt — ghosting conditions; you may motor more than sail.`;
    } else {
      impact = `Steady ${dir} ${w} kt — powered up but predictable for a ${boat.name}.`;
    }
    items.push({ label: "Wind & handling", impact, severity });
  }

  // Sea state — steepness vs. swell.
  if (waveFt != null) {
    let severity: IntelSeverity = "ok";
    let impact: string;
    if (waveFt < 1) {
      impact = `Nearly flat (~${waveFt.toFixed(1)} ft) — smooth water.`;
    } else if (shortP) {
      severity = waveFt >= waveCalm ? "watch" : "ok";
      impact = `Short ${Math.round(period!)} s period on ${waveFt.toFixed(1)} ft — steep, closely-spaced chop. Wetter and slower than the height alone suggests.`;
    } else {
      impact = `${waveFt.toFixed(1)} ft${period ? ` at a longer ${Math.round(period)} s period` : ""} — rolling and easier-motioned.`;
    }
    items.push({ label: "Sea state", impact, severity });
  }

  // Cold water & safety — immersion risk, sterner for open/small boats.
  if (c.waterTempF != null) {
    const t = c.waterTempF;
    // Low wave tolerance ≈ an open / easily-swamped boat (built-in or custom).
    const smallBoat = boat.waveMaxFt <= 4.0;
    let severity: IntelSeverity;
    let impact: string;
    if (t < 60) {
      severity = "alert";
      impact = paddle
        ? `Water is ${Math.round(t)}°F — cold-shock territory, and on a board or in a kayak you're in it the moment you come off. Dress for immersion, not for the air, and keep the PFD on.`
        : `Water is ${Math.round(t)}°F — cold-shock territory. A capsize or MOB gets dangerous within minutes${smallBoat ? " on an open boat like this" : ""}. Dress for immersion and keep the PFD on.`;
    } else if (t < 70) {
      severity = smallBoat ? "watch" : "ok";
      impact = `Water is ${Math.round(t)}°F — chilly. A swim would be a real shock${paddle ? "; a wetsuit is worth it if you're likely to go in" : smallBoat ? "; consider a wetsuit" : ""}.`;
    } else {
      severity = "ok";
      impact = `Water is ${Math.round(t)}°F — comfortable if you end up in it.`;
    }
    items.push({ label: "Cold water & safety", impact, severity });
  }

  // Storm & squalls — HRRR convective outlook (regional).
  if (c.storm) {
    const level = c.storm.level;
    const severity: IntelSeverity = level === "active" || level === "elevated" ? "alert" : level === "watch" ? "watch" : "ok";
    const capePart = c.storm.capeNow != null && c.storm.capeNow >= 300 ? ` CAPE ~${Math.round(c.storm.capeNow)} J/kg.` : "";
    items.push({ label: "Storm & squalls", impact: c.storm.headline + capePart, severity });
  }

  return items;
}
