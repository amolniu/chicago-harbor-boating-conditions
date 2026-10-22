import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Deploy artifacts (generated bundles — not our source):
    ".firebase/**",
    ".vercel/**",
    // Agent worktrees: each is a full checkout with its own .next, so linting the repo
    // root swept in tens of thousands of problems from other branches and builds.
    ".claude/**",
  ]),
]);

export default eslintConfig;
