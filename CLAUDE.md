@AGENTS.md

# Great Lakes Harbor Report

Green/yellow/red "should you go out right now?" status per harbor, personalized to
boat + skill. The value is **interpretation** of NOAA/NDBC data, not aggregation. Next.js 16
(App Router) + TypeScript + Tailwind v4, deploy target Vercel + Neon Postgres.

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
- `lib/ndbc.ts` / `lib/nws.ts` — **server-only** source fetchers (NDBC has no CORS).
- `lib/conditions.ts` — assembles per-harbor `Conditions` and persists snapshots.
- `db/` — Drizzle schema + Neon client, **optional** (gated on `DATABASE_URL`).
- `app/page.tsx`, `app/harbor/[id]/page.tsx` — client components; they fetch raw
  conditions and call `rate()` in the browser so boat/skill toggles recompute instantly.

## Conventions
- `lib/*` (except ndbc/nws/conditions) must stay **isomorphic** — no `fetch`/Node-only APIs,
  so the client can import them. Keep server-only fetching in ndbc/nws/conditions.
- Units are normalized at the edge to **knots / feet / °F** (`lib/units.ts`). NDBC is metric.
- The browser is the source of truth for personalization; the server stores only a single
  **baseline** status (default sailor) for history.

## Run / verify
- `npm run dev` (port 3000), `npm run build`, `npm test`, `npx tsc --noEmit`.
- Manual snapshot: `GET /api/cron/poll` (add `?secret=` if `CRON_SECRET` is set).
- Verified data sources: NDBC `45198`/`CHII2`/`CMTI2`, marine zone `LMZ742`, radar `KLOT`,
  GLERL cam `chi01.jpg`, AFD office `LOT`.
