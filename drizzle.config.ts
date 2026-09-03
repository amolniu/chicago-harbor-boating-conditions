import type { Config } from "drizzle-kit";
import { loadDotEnv } from "./scripts/load-env";

loadDotEnv(__dirname);

export default {
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL || "" },
} satisfies Config;
