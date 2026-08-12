// The rules engine. Given conditions at a harbor plus the user's boat and skill,
// it produces a green / yellow / red verdict, an open-lake vs harbor-exit split
// (the "launch score"), and a plain-English reason naming the binding factor.
//
// Pure and deterministic so it can run identically on the server (for the stored
// baseline) and in the browser (so boat/skill toggles recompute instantly), and
// so it can be unit-tested. See lib/rating.test.ts.

import { Advisory, Conditions, Rating, Status, StormRisk } from "./types";
import { Harbor, exposureForWind, crosswindKt } from "./harbors";
import { BoatProfile, Skill, skillFactor } from "./boats";
import { degToCompass } from "./units";
import { worstAlertLevel, type AlertLevel } from "./alerts";

/** 100 when value ≤ calm, 0 when value ≥ max, linear in between. */
function scoreMetric(value: number, calm: number, max: number): number {
  if (max <= calm) return value <= calm ? 100 : 0;
  if (value <= calm) return 100;
  if (value >= max) return 0;
  return 100 * (1 - (value - calm) / (max - calm));
}

function statusFromScore(score: number): Status {
  if (score >= 60) return "green";
  if (score >= 30) return "yellow";
  return "red";
}

// A marine advisory caps the comfort score directly (rather than overriding the
// status after the fact — that made score and status disagree). Beginners get a
// tighter cap than advanced sailors. A Small Craft Advisory is zone-wide, but a
// sheltered harbor is genuinely safer to get out of and day-sail near than an
// exposed one under the same advisory, so the SCA cap is eased by `shelter`
// (= 1 - exposureScale, 0 = fully exposed … ~0.7 = tucked away). This also stops
// the SCA from flat-lining every harbor to the same score. Gale/storm stay flat —
// dangerous everywhere. Returns the highest score the advisory allows (100 = none).
function advisoryCap(advisory: Advisory, skill: Skill, shelter: number): number {
  switch (advisory) {
    case "storm":
      return 5;
    case "gale":
      return 10;
    case "small_craft": {
      const base = skill === "beginner" ? 24 : skill === "advanced" ? 58 : 48;
      return base + 20 * Math.max(0, Math.min(1, shelter));
    }
    default:
      return 100;
  }
}

function advisoryLabel(advisory: Advisory): string {
  return advisory === "gale" ? "gale warning" : advisory === "storm" ? "storm warning" : "small-craft advisory";
}

// An NWS warning outranks every model and every comfort calculation. A Tornado or
// Severe Thunderstorm Warning means the authorities have said this is dangerous NOW, so
// it pins the score at zero rather than merely capping it low — there is no boat and no
// skill level for which it is a judgement call. A watch caps at the same level as an
// "elevated" convective outlook.
function alertCap(level: AlertLevel): number {
  return level === "stop" ? 0 : level === "watch" ? 45 : 100;
}

// HRRR convective outlook caps the score: an active thunderstorm is a hard no-go;
// "elevated" (storms likely soon) is yellow at best. "watch"/"none" don't cap —
// they're surfaced in the intel panel and banner instead.
function stormCap(level: StormRisk["level"] | undefined): number {
  return level === "active" ? 8 : level === "elevated" ? 45 : 100;
}

interface Metric {
  key: string;
  label: string;
  score: number;
}

export function rate(
  harbor: Harbor,
  c: Conditions,
  boat: BoatProfile,
  skill: Skill,
): Rating {
  if (c.windKt == null) {
    return { status: "unknown", score: 0, openScore: 0, exitScore: 0, reason: "Live conditions unavailable right now.", limiter: "no data" };
  }

  const sf = skillFactor(skill);
  const windCalm = boat.windCalmKt * sf;
  const windMax = boat.windMaxKt * sf;
  const waveCalm = boat.waveCalmFt * sf;
  const waveMax = boat.waveMaxFt * sf;
  const crossCalm = boat.crosswindMaxKt * sf * 0.6;
  const crossMax = boat.crosswindMaxKt * sf;

  const windMetric = Math.max(c.windKt, (c.gustKt ?? c.windKt) * 0.9);
  const windScore = scoreMetric(windMetric, windCalm, windMax);

  // Open-lake and harbor-exit metrics. Exit metrics need a wind direction.
  const open: Metric[] = [{ key: "wind", label: "wind", score: windScore }];
  const exit: Metric[] = [{ key: "wind", label: "wind", score: windScore }];

  let exitWaveFt: number | null = null;
  let crossKt: number | null = null;

  if (c.waveFt != null) {
    open.push({ key: "openWave", label: "open-lake waves", score: scoreMetric(c.waveFt, waveCalm, waveMax) });
    if (c.windDir != null) {
      exitWaveFt = c.waveFt * exposureForWind(harbor, c.windDir);
      exit.push({ key: "exitWave", label: "exit waves", score: scoreMetric(exitWaveFt, waveCalm, waveMax) });
    }
  }
  if (c.windDir != null) {
    crossKt = crosswindKt(harbor, c.windDir, c.windKt);
    exit.push({ key: "crosswind", label: "entrance crosswind", score: scoreMetric(crossKt, crossCalm, crossMax) });
  }

  // An advisory is an open-lake condition, so it enters as a metric on the open
  // side. overall = min(...) then flows to the score, so score and status agree.
  const cap = advisoryCap(c.advisory, skill, 1 - harbor.exposureScale);
  if (cap < 100) open.push({ key: "advisory", label: advisoryLabel(c.advisory), score: cap });

  const sCap = stormCap(c.storm?.level);
  if (sCap < 100) open.push({ key: "storm", label: "storm risk", score: sCap });

  const alertLevel = worstAlertLevel(c.alerts);
  const aCap = alertCap(alertLevel);
  if (aCap < 100) {
    open.push({ key: "alert", label: c.alerts?.[0]?.event.toLowerCase() ?? "weather warning", score: aCap });
  }

  const openScore = Math.min(...open.map((m) => m.score));
  const exitScore = Math.min(...exit.map((m) => m.score));
  const overall = Math.min(openScore, exitScore);
  const status = statusFromScore(overall);

  const limiter = [...open, ...exit].reduce((a, b) => (b.score < a.score ? b : a));
  const reason = buildReason(harbor, c, status, limiter, skill, { windMetric, exitWaveFt, crossKt });

  return {
    status,
    score: Math.round(overall),
    openScore: Math.round(openScore),
    exitScore: Math.round(exitScore),
    reason,
    limiter: limiter.label,
  };
}

const SKILL_POSSESSIVE: Record<Skill, string> = {
  beginner: "a beginner's",
  intermediate: "an intermediate sailor's",
  advanced: "an advanced sailor's",
};

function buildReason(
  harbor: Harbor,
  c: Conditions,
  status: Status,
  limiter: Metric,
  skill: Skill,
  v: { windMetric: number; exitWaveFt: number | null; crossKt: number | null },
): string {
  const dir = c.windDir != null ? degToCompass(c.windDir) : "";
  const wind = `${Math.round(c.windKt ?? 0)} kt`;

  // An active NWS warning leads everything else. Nothing below this — not a gale, not
  // the convective model — is more urgent than "the weather service has issued a
  // warning covering this harbor right now".
  const stopAlert = c.alerts?.find((a) => a.level === "stop");
  if (stopAlert) {
    return `${stopAlert.event} in effect — do not go out. ${stopAlert.headline ?? "Get off the water and take shelter."}`;
  }

  if (c.advisory === "gale" || c.advisory === "storm") {
    return `${c.advisory === "gale" ? "Gale" : "Storm"} warning in effect — stay in.`;
  }

  // A thunderstorm is never a footnote. Normally the copy names the lowest-scoring
  // factor, but the storm cap is flat (45 elevated / 8 active) while the advisory cap
  // scales with skill — so a beginner's SCA cap dips BELOW the storm cap and used to
  // push the storm out of the headline for exactly the sailor least equipped to handle
  // one. An active or likely storm now leads regardless of which scored lower; the
  // advisory still gets its mention. ("watch" doesn't cap the score, so it stays in the
  // intel panel rather than shouting here.)
  const stormLead = c.storm?.headline ?? "Thunderstorm risk in the area — stay in.";
  if (c.storm?.level === "active" || c.storm?.level === "elevated") {
    return c.advisory === "small_craft" ? `${stormLead} Small Craft Advisory is up as well.` : stormLead;
  }

  if (status === "green") {
    const wavePart = c.waveFt != null ? `, ${c.waveFt.toFixed(1)} ft on the lake` : "";
    const scNote =
      c.advisory === "small_craft" ? " Small Craft Advisory is up on the open lake, but this harbor is protected." : "";
    return `Clean ${dir} ${wind} breeze${wavePart} — good to go from ${harbor.name}.${scNote}`;
  }

  const scPrefix = c.advisory === "small_craft" && limiter.key !== "advisory" ? "Small Craft Advisory up. " : "";

  switch (limiter.key) {
    // Unreachable while only active/elevated cap the score (both return above), but
    // kept so a future storm level that caps can't silently fall through to the wind copy.
    case "storm":
      return stormLead;
    case "advisory":
      return `Small Craft Advisory in effect — the open lake is above ${SKILL_POSSESSIVE[skill]} comfort, even if it looks manageable at the dock.`;
    case "exitWave":
      return `${scPrefix}${dir} wind is stacking ~${(v.exitWaveFt ?? 0).toFixed(1)} ft right at ${harbor.name}'s entrance — the exit is the crux.`;
    case "crosswind":
      return `${scPrefix}${Math.round(v.crossKt ?? 0)} kt of crosswind across the mouth — docking and threading the gap will be tricky.`;
    case "openWave":
      return `${scPrefix}${(c.waveFt ?? 0).toFixed(1)} ft chop out on the open lake${c.wavePeriodS ? ` at a short ${Math.round(c.wavePeriodS)} s period` : ""} — rough ride.`;
    case "wind":
    default:
      return `${scPrefix}${dir} wind pushing ${Math.round(v.windMetric)} kt${c.gustKt ? ` (gusts ${Math.round(c.gustKt)})` : ""} — more than you'll want here.`;
  }
}
