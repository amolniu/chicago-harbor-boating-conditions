// Optional database client. If DATABASE_URL is unset, getDb() returns null and
// the app runs purely on live data (history features degrade to "collecting
// data"). Set DATABASE_URL (Neon) to turn on the historical record.

import { drizzle, NeonHttpDatabase } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

let cached: NeonHttpDatabase<typeof schema> | null = null;

export function getDb(): NeonHttpDatabase<typeof schema> | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!cached) cached = drizzle(neon(url), { schema });
  return cached;
}

export function historyEnabled(): boolean {
  return !!process.env.DATABASE_URL;
}

export { schema };
