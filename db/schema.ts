// Postgres schema (Drizzle). Two tables:
//  - observations: raw buoy readings, one row per station per timestamp.
//  - harbor_snapshots: the canonical per-harbor conditions at each poll, plus a
//    single baseline status (default sailor). This is the historical record that
//    later powers percentiles ("rougher than 90% of July afternoons"),
//    "green X of last 10 days", and green→red transition notifications.

import { pgTable, serial, text, real, timestamp, unique } from "drizzle-orm/pg-core";

export const observations = pgTable(
  "observations",
  {
    id: serial("id").primaryKey(),
    station: text("station").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    windDir: real("wind_dir"),
    windKt: real("wind_kt"),
    gustKt: real("gust_kt"),
    waveFt: real("wave_ft"),
    wavePeriodS: real("wave_period_s"),
    waveDir: real("wave_dir"),
    waterTempF: real("water_temp_f"),
    airTempF: real("air_temp_f"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ uniqObs: unique().on(t.station, t.observedAt) }),
);

export const harborSnapshots = pgTable(
  "harbor_snapshots",
  {
    id: serial("id").primaryKey(),
    harborId: text("harbor_id").notNull(),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
    windDir: real("wind_dir"),
    windKt: real("wind_kt"),
    gustKt: real("gust_kt"),
    waveFt: real("wave_ft"),
    wavePeriodS: real("wave_period_s"),
    waveDir: real("wave_dir"),
    waterTempF: real("water_temp_f"),
    airTempF: real("air_temp_f"),
    advisory: text("advisory").notNull().default("none"),
    source: text("source"),
    baselineStatus: text("baseline_status"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ uniqSnap: unique().on(t.harborId, t.takenAt) }),
);

export type HarborSnapshotRow = typeof harborSnapshots.$inferInsert;
export type ObservationRow = typeof observations.$inferInsert;
