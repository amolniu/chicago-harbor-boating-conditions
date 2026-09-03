// Minimal .env loader for the tooling paths that don't load it themselves
// (vitest live scripts, drizzle-kit). Next.js loads .env on its own, and the
// deployed function gets the same file via firebase-tools (frameworks/index.js
// prepends the repo's .env into the generated function's .env at package time) —
// so the repo's gitignored .env is the single source of truth everywhere.
// Never overwrites variables already present in the environment.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export function loadDotEnv(dir: string = process.cwd()): void {
  let text: string;
  try {
    text = readFileSync(join(dir, ".env"), "utf-8");
  } catch {
    return; // no .env — fine, everything stays opt-in
  }
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    const [, key, raw] = m;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
}
