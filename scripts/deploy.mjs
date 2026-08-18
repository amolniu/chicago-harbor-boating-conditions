// Deploy wrapper — run with `npm run deploy`. Does three things the bare
// `firebase deploy` doesn't:
//
// 1. Clears .next/dev and .next/cache first. Firebase's frameworks adapter copies
//    .next with a blanket glob and has no rule to skip dev-server output, so without
//    this a stale .next/dev (measured at 580 MB, over half the whole package) rides
//    along on every deploy. The deployed server runs dev:false and never reads it.
//    Cutting it took a deploy from 7m10s to 3m20s.
//
// 2. Raises FUNCTIONS_DISCOVERY_TIMEOUT. Firebase loads the SSR entry to work out
//    what to deploy and allows 10 s by default. Loading Next's server entry sits close
//    enough to that line that deploys fail intermittently — the same commit can pass
//    once and time out the next time. Moving Firestore to a dynamic import removed
//    ~4 s of it (see lib/firebase.ts), but the remaining cost is Next itself and can't
//    be trimmed without leaving framework-aware Hosting. So give it room rather than
//    relying on the machine being idle.
//
// 3. Propagates the real exit code. Piping firebase's output (e.g. `| tail`) masks a
//    failed deploy as exit 0, which has already caused a failure to be reported as
//    success once.

import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const CACHES = [".next/dev", ".next/cache"];
const DISCOVERY_TIMEOUT_S = "180";

for (const dir of CACHES) {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`cleared ${CACHES.join(", ")}`);

const result = spawnSync(
  "firebase",
  ["deploy", "--only", "hosting", "--project", "mootek-consulting"],
  {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, FUNCTIONS_DISCOVERY_TIMEOUT: DISCOVERY_TIMEOUT_S },
  },
);

process.exit(result.status ?? 1);
