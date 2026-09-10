@AGENTS.md

# Great Lakes Harbor Report

Green/yellow/red "should you go out right now?" status per harbor, personalized to
boat + skill. The value is **interpretation** of NOAA/NDBC data, not aggregation. Next.js 16
(App Router) + TypeScript + Tailwind v4.

**Deploys to Firebase Hosting (web frameworks) — always via `npm run deploy`**, never bare
`firebase deploy`: the wrapper clears a stale `.next/dev` (580 MB), raises Firebase's 10 s
SSR-discovery timeout, and propagates the real exit code (piping has masked a failed deploy
as success). A `vercel.json` exists as an alternative target but is not what ships.
Postgres (Neon) is **live** and optional-by-design — gated on `DATABASE_URL`.

The product name lives in `lib/brand.ts` — nothing else hardcodes it, because it is
expected to change again (dropping "Great Lakes" for plain "Harbor Report"). Keep the
name free of geography it will outgrow, and of "sailing" — the app rates kayaks and
paddleboards too (`BoatProfile.craft`), and the copy is deliberately craft-neutral.

## Where things live
- `lib/harbors.ts` — **the core IP.** Per-harbor exposure model: `entranceBearing`,
  `exposureScale`, `shelteredDirs`/`exposedDirs`, `exposureForWind()`, `crosswindKt()`.
  Exposure numbers are seed values meant to be tuned with real local input.
- `lib/rating.ts` — pure rules engine → `{status, score, exitScore, openScore, reason, limiter}`.
  Unit-tested in `lib/rating.test.ts` (the tests encode the value prop: Belmont red /
  Burnham green in the same NE blow). Run `npm test`.
- `lib/window.ts` — next-24h sail-window; `estimateWaveFt()` is a wind-sea approximation.
- `lib/intel.ts` — per-facet Harbor Intelligence; craft-aware (a paddler never gets reef/slip advice).
- `lib/history.ts` + `db/history.ts` — afternoon summaries → "rougher than X% of September
  afternoons" and the green streak. The server ships raw summaries; the **browser** re-rates them.
- `lib/alerts.ts` — NWS active warnings. A stop-level warning pins the score to 0, outranking
  every model. `lib/storm.ts` — HRRR convective outlook. `lib/glos.ts` — GLOS/Seagull waves,
  temp, and (only where validated against an anemometer) Spotter wind.
- `lib/stationHealth.ts` + `lib/health.ts` + `/health` — is every data column we depend on still
  reporting? Severity is context-aware; capability is **declared** in `SENSORLESS`, never inferred.
- `lib/brand.ts` — product name/tagline in one place; expected to change again.
- `lib/ndbc.ts` / `lib/nws.ts` — **server-only** source fetchers (NDBC has no CORS).
- `lib/conditions.ts` — assembles per-harbor `Conditions` and persists snapshots.
- `db/` — Drizzle schema + Neon client, **optional** (gated on `DATABASE_URL`).
- `app/page.tsx`, `app/harbor/[id]/page.tsx` — client components; they fetch raw
  conditions and call `rate()` in the browser so boat/skill toggles recompute instantly.

## Conventions
- Most of `lib/*` must stay **isomorphic** — no `fetch`, no Node-only APIs, no `process.env` —
  so the browser can import it. Apply the rule rather than memorising a list: `ndbc`, `nws`,
  `alerts`, `glos` and `storm` call `fetch` directly; `conditions` and `health` are server-only
  because they orchestrate those (and `conditions` touches the DB). Everything else is importable
  by the client, which is what makes instant boat/skill re-rating possible.
- Keep the **pure/fetching split** deliberate: `stationHealth.ts` takes rows and decides, while
  `health.ts` fetches them. Same shape as `history.ts` (pure) vs `db/history.ts` (queries). It is
  what makes both unit-testable without network.
- Units are normalized at the edge to **knots / feet / °F** (`lib/units.ts`). NDBC is metric.
- The browser is the source of truth for personalization; the server stores only a single
  **baseline** status (default sailor) for history.

## Run / verify
- `npm run dev` (port 3000), `npm run build`, `npm test`, `npx tsc --noEmit`.
- `npm run deploy` to ship. `npm run validate:stations` before shipping any new station.
  `npm run backfill:history` seeds ~45 days of snapshots (needs `DATABASE_URL`).
- Secrets live in a gitignored **`.env`** at the repo root — not `.env.local`, which only
  `next dev` reads and which therefore never reaches production. `CRON_SECRET` guards both
  `/api/cron/poll` and `/api/cron/health`.
- Manual snapshot: `GET /api/cron/poll` (add `?secret=` or a Bearer header if `CRON_SECRET` is set).
- **Don't hardcode a station list here** — it goes stale and gets believed. `lib/harbors.ts` is the
  source of truth, and `/health` says which stations are currently reporting what. Stations do fail
  partially: a fresh feed can carry a dead column for weeks (45198 served wind speed with no
  direction and no gusts), so check per-column fill, not just freshness.
