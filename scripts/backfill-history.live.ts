// One-shot history backfill — run with `npm run backfill:history` (needs DATABASE_URL).
//
// The percentile feature is useless until history exists, and waiting 45 days for the
// poll cron to accumulate it would be silly when the sources already hold the past:
// NDBC realtime2 files carry 45 days, and GLOS /obs accepts a startDate. This script
// reconstructs hourly harbor_snapshots for every harbor whose sources allow it.
//
// Honest limits, mirrored in the UI copy: historical marine ADVISORIES, storm
// outlooks and NWS alerts are not reconstructable, so advisory is "none" and the
// re-rated history compares wind/waves only. Model-wind harbors without a Spotter
// wind series (cedar-river, kewaunee, sister-bay, menominee/fayette dark spells)
// simply get no backfilled wind — days without wind rate as "unknown" and are
// skipped by the streak/percentile math rather than counted.
//
// Idempotent: inserts use onConflictDoNothing against the (harbor_id, taken_at)
// unique constraint, so re-running (or overlapping the live poll) is safe.

import { describe, it, expect } from "vitest";
import { HARBORS, type Harbor } from "@/lib/harbors";
import { circularMeanDeg } from "@/lib/history";
import { rate } from "@/lib/rating";
import { getBoat, DEFAULT_BOAT_ID, DEFAULT_SKILL } from "@/lib/boats";
import type { Conditions } from "@/lib/types";
import { getDb } from "@/db";
import { harborSnapshots, type HarborSnapshotRow } from "@/db/schema";

const UA = { "User-Agent": process.env.NWS_USER_AGENT || "ChicagoHarborSailing/0.1 (backfill)" };
const MS_TO_KT = 1.94384;
const M_TO_FT = 3.28084;
const DAYS = 45;
const HOUR_MS = 3600_000;

interface HourPoint {
  windKt?: number[];
  windDir?: number[];
  gustKt?: number[];
  waveFt?: number[];
  wavePeriodS?: number[];
  waveDir?: number[];
  waterTempF?: number[];
}
type Hours = Map<number, HourPoint>; // key = epoch ms floored to the hour

const push = (hours: Hours, t: number, key: keyof HourPoint, v: number) => {
  const h = Math.floor(t / HOUR_MS) * HOUR_MS;
  const g = hours.get(h) ?? {};
  (g[key] ??= []).push(v);
  hours.set(h, g);
};

const avg = (v?: number[]) => (v?.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

/** Parse an NDBC realtime2 file into per-hour buckets. */
async function ndbcHours(station: string, cutoff: number): Promise<Hours> {
  const hours: Hours = new Map();
  const res = await fetch(`https://www.ndbc.noaa.gov/data/realtime2/${station.toUpperCase()}.txt`, { headers: UA });
  if (!res.ok) return hours;
  for (const line of (await res.text()).split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const f = line.trim().split(/\s+/);
    if (f.length < 15) continue;
    const t = Date.UTC(+f[0], +f[1] - 1, +f[2], +f[3], +f[4]);
    if (t < cutoff) continue;
    const num = (i: number) => (f[i] === "MM" ? null : parseFloat(f[i]));
    const wd = num(5), ws = num(6), gs = num(7), wv = num(8), dpd = num(9), mwd = num(11), wt = num(14);
    if (wd != null) push(hours, t, "windDir", wd);
    if (ws != null) push(hours, t, "windKt", ws * MS_TO_KT);
    if (gs != null) push(hours, t, "gustKt", gs * MS_TO_KT);
    if (wv != null) push(hours, t, "waveFt", wv * M_TO_FT);
    if (dpd != null) push(hours, t, "wavePeriodS", dpd);
    if (mwd != null) push(hours, t, "waveDir", mwd);
    if (wt != null) push(hours, t, "waterTempF", (wt * 9) / 5 + 32);
  }
  return hours;
}

/** Pull a GLOS platform's history into per-hour buckets, mapped via the harbor's
 *  stored parameter ids. */
async function glosHours(
  ref: { datasetId: number; waveId: number; periodId?: number; dirId?: number; tempId?: number; windId?: number },
  cutoff: number,
): Promise<Hours> {
  const hours: Hours = new Map();
  const start = new Date(cutoff).toISOString().slice(0, 10);
  const res = await fetch(
    `https://seagull-api.glos.org/api/v1/obs?obsDatasetId=${ref.datasetId}&startDate=${start}`,
    { headers: UA },
  );
  if (!res.ok) return hours;
  const data = (await res.json()) as { parameters?: { parameter_id: number; observations?: { timestamp: string; value: number | null }[] }[] }[];
  const map: [number | undefined, keyof HourPoint, (v: number) => number][] = [
    [ref.waveId, "waveFt", (v) => v * M_TO_FT],
    [ref.periodId, "wavePeriodS", (v) => v],
    [ref.dirId, "waveDir", (v) => v],
    [ref.tempId, "waterTempF", (v) => ((v - 273.15) * 9) / 5 + 32],
    [ref.windId, "windKt", (v) => v * MS_TO_KT],
  ];
  for (const ds of data ?? []) {
    for (const p of ds.parameters ?? []) {
      const m = map.find(([id]) => id === p.parameter_id);
      if (!m) continue;
      for (const o of p.observations ?? []) {
        if (o.value == null) continue;
        const t = new Date(o.timestamp).getTime();
        if (t >= cutoff) {
          // Apply the same plausibility clamp the live path uses for Spotter periods.
          if (m[1] === "wavePeriodS" && (o.value < 1 || o.value > 15)) continue;
          push(hours, t, m[1], m[2](o.value));
        }
      }
    }
  }
  return hours;
}

const merge = (base: Hours, extra: Hours, keys: (keyof HourPoint)[]) => {
  for (const [t, pt] of extra) {
    const g = base.get(t) ?? {};
    for (const k of keys) if (pt[k]?.length && !g[k]?.length) g[k] = pt[k];
    base.set(t, g);
  }
};

async function backfillHarbor(h: Harbor, boat = getBoat(DEFAULT_BOAT_ID)): Promise<HarborSnapshotRow[]> {
  const cutoff = Date.now() - DAYS * 24 * HOUR_MS;
  const hours: Hours = new Map();

  // Wind (and whatever else the wind station carries) from the harbor's own buoy.
  if (h.buoyStation) merge(hours, await ndbcHours(h.buoyStation, cutoff), ["windKt", "windDir", "gustKt", "waveFt", "wavePeriodS", "waveDir", "waterTempF"]);

  // Waves/temp (and Spotter wind where validated) from the dedicated wave source.
  if (h.waveBuoy?.station && h.waveBuoy.station !== h.buoyStation) {
    merge(hours, await ndbcHours(h.waveBuoy.station, cutoff), ["waveFt", "wavePeriodS", "waveDir", "waterTempF"]);
  } else if (h.waveBuoy?.glos) {
    const keys: (keyof HourPoint)[] = ["waveFt", "wavePeriodS", "waveDir", "waterTempF"];
    if (h.waveBuoy.glos.windId != null) keys.push("windKt");
    merge(hours, await glosHours(h.waveBuoy.glos, cutoff), keys);
  }

  const rows: HarborSnapshotRow[] = [];
  for (const [t, pt] of hours) {
    const windKt = avg(pt.windKt);
    if (windKt == null) continue; // a windless hour can't be rated later — skip
    const c: Conditions = {
      windDir: circularMeanDeg(pt.windDir ?? []),
      windKt,
      gustKt: avg(pt.gustKt),
      waveFt: avg(pt.waveFt),
      wavePeriodS: avg(pt.wavePeriodS),
      waveDir: avg(pt.waveDir),
      waterTempF: avg(pt.waterTempF),
      airTempF: null,
      advisory: "none",
      source: "backfill",
      observedAt: new Date(t).toISOString(),
    };
    rows.push({
      harborId: h.id,
      takenAt: new Date(t),
      windDir: c.windDir,
      windKt: c.windKt,
      gustKt: c.gustKt,
      waveFt: c.waveFt,
      wavePeriodS: c.wavePeriodS,
      waveDir: c.waveDir,
      waterTempF: c.waterTempF,
      advisory: "none",
      source: "backfill",
      baselineStatus: rate(h, c, boat, DEFAULT_SKILL).status,
    });
  }
  return rows;
}

describe("history backfill (live, writes to DATABASE_URL)", () => {
  it("reconstructs up to 45 days of hourly snapshots per harbor", async () => {
    const db = getDb();
    expect(db, "set DATABASE_URL before running the backfill").not.toBeNull();

    let total = 0;
    for (const h of HARBORS) {
      const rows = await backfillHarbor(h);
      for (let i = 0; i < rows.length; i += 500) {
        await db!.insert(harborSnapshots).values(rows.slice(i, i + 500)).onConflictDoNothing();
      }
      total += rows.length;
      console.log(`  ${h.id.padEnd(20)} ${String(rows.length).padStart(5)} hourly rows`);
    }
    console.log(`\n  total rows offered: ${total} (existing timestamps skipped by onConflictDoNothing)`);
    expect(total).toBeGreaterThan(0);
  }, 900_000);
});
