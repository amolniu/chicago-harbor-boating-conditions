// Historical snapshot queries. Server-only (touches the DB).
//
// The SQL keeps only AFTERNOON rows (12:00–17:59 in the harbor's own timezone) so the
// payload stays one summary per day and the percentile compares like with like — see
// lib/history.ts for why the afternoon is the unit. `AT TIME ZONE` does the local-hour
// math in Postgres, DST included; the timezone string comes from harbor config, never
// from user input.

import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "./index";
import { harborSnapshots } from "./schema";
import type { Harbor } from "@/lib/harbors";
import { DEFAULT_TZ_FALLBACK, summarizeAfternoons, type DaySummary } from "@/lib/history";

/** Afternoon day-summaries for one harbor, newest first. Null when history is off. */
export async function getAfternoonHistory(harbor: Harbor, sinceDays = 400): Promise<DaySummary[] | null> {
  const db = getDb();
  if (!db) return null;
  const tz = harbor.timezone ?? DEFAULT_TZ_FALLBACK;
  const since = new Date(Date.now() - sinceDays * 24 * 3600_000);
  const rows = await db
    .select({
      takenAt: harborSnapshots.takenAt,
      windDir: harborSnapshots.windDir,
      windKt: harborSnapshots.windKt,
      gustKt: harborSnapshots.gustKt,
      waveFt: harborSnapshots.waveFt,
      wavePeriodS: harborSnapshots.wavePeriodS,
      waveDir: harborSnapshots.waveDir,
      waterTempF: harborSnapshots.waterTempF,
      advisory: harborSnapshots.advisory,
    })
    .from(harborSnapshots)
    .where(
      and(
        eq(harborSnapshots.harborId, harbor.id),
        gte(harborSnapshots.takenAt, since),
        sql`extract(hour from ${harborSnapshots.takenAt} at time zone ${tz}) between 12 and 17`,
      ),
    );
  return summarizeAfternoons(rows, tz);
}
