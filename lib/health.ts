// Runs the station health check against live feeds. Server-only (fetches NDBC).
// The analysis itself is pure and lives in lib/stationHealth.ts.

import { getBuoyRows } from "./ndbc";
import { getGlosRows } from "./glos";
import { assessStation, stationUsage, summarize, type HealthSummary } from "./stationHealth";

/** Check every source the app depends on — NDBC buoys AND GLOS Spotters — in parallel.
 *  Both kinds are graded by the same analyzer; only the fetch differs. */
export async function runHealthCheck(): Promise<HealthSummary> {
  const usage = stationUsage();
  const reports = await Promise.all(
    usage.map(async (u) => {
      // NDBC: the whole ~45-day file, because SENSORLESS reasoning needs the full history.
      // GLOS: /obs is queried by date, and a Spotter's own history is far shorter, so ask
      // for a window comfortably wider than the 48 h fill measurement.
      const rows =
        u.kind === "glos" && u.glos
          ? await getGlosRows(u.glos, 14)
          : await getBuoyRows(u.station, Number.MAX_SAFE_INTEGER);
      return assessStation(u.station, rows, u.columns, u.harbors, Date.now(), {
        kind: u.kind,
        label: u.label,
      });
    }),
  );
  // Drift comparison needs a GLOS reference per station and is the slow half; it stays
  // in `npm run validate:stations`, which is the deep check. This scheduled pass is the
  // cheap one that catches outages and dead sensors — the failures that hide.
  return summarize(reports, []);
}
