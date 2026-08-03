// Opt-in config for the live station validator (`npm run validate:stations`).
// Kept separate from vitest.config.ts so `npm test` stays offline, fast and
// deterministic — this one deliberately hits NDBC, NWS and GLOS over the network.
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    environment: "node",
    include: ["scripts/**/*.live.ts"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
