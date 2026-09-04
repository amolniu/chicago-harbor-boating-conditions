// Runs the station health check against live feeds. Server-only (fetches NDBC).
// The analysis itself is pure and lives in lib/stationHealth.ts.

import { getBuoyRows } from "./ndbc";
import { assessStation, stationUsage, summarize, type HealthSummary } from "./stationHealth";

/** Check every station the app depends on. One request per station, in parallel. */
export async function runHealthCheck(): Promise<HealthSummary> {
  const usage = stationUsage();
  const reports = await Promise.all(
    usage.map(async (u) => assessStation(u.station, await getBuoyRows(u.station, Number.MAX_SAFE_INTEGER), u.columns, u.harbors)),
  );
  // Drift comparison needs a GLOS reference per station and is the slow half; it stays
  // in `npm run validate:stations`, which is the deep check. This scheduled pass is the
  // cheap one that catches outages and dead sensors — the failures that hide.
  return summarize(reports, []);
}
