# Chicago Harbor Sailing Dashboard

**Should I sail out of my harbor right now?** A green / yellow / red status for every
Chicago Park District harbor, personalized to your **boat** and **skill level**.

It does more than re-display a forecast. Lake-wide marine forecasts say "waves 2–4 ft"
but can't tell you that a NE wind piles steep waves on **Belmont's** breakwall while
**Burnham** stays sheltered. This app encodes that harbor-by-harbor knowledge and
interprets live NOAA/NDBC data into one decision.

## What makes it more than an aggregator

- **Harbor exposure model** (`lib/harbors.ts`) — each harbor's entrance bearing, fetch by
  wind direction, and breakwater shelter. Turns one lake forecast into ten answers.
- **Rules engine** (`lib/rating.ts`) — combines conditions + your boat + your skill into a
  status with a plain-English reason, and splits **harbor-exit** vs **open-lake** comfort
  (the "launch score" — some days are fine offshore but ugly getting in and out).
- **Sail-window engine** (`lib/window.ts`) — scores the next 24 h so you can plan:
  "Best window today: 8–11 AM."
- **Stored history** (optional Postgres) — every poll is snapshotted, which powers the
  planned percentiles ("rougher than 90% of July afternoons"), "green X of last 10 days,"
  and green→red notifications.

## Data sources

| Source | Provides | Notes |
|---|---|---|
| NDBC buoys `45198`, `CHII2`, `CNII2`, `CMTI2` | Live wind, waves, water temp | Proxied server-side (no CORS). `45198` is the primary wave source. |
| api.weather.gov | Hourly wind forecast, forecast discussion | CORS-open |
| NWS nearshore text `LMZ742` | Wave forecast + Small Craft/Gale advisories | Parsed server-side |
| NWS RIDGE radar `KLOT` | Radar loop | Embedded image |
| NOAA GLERL Chicago cam | Lakefront webcam | Embedded image |
| suncalc | Sunrise / sunset | Computed locally |

## Local development

```bash
npm install
cp .env.example .env.local   # optional — app runs without any env
npm run dev                  # http://localhost:3000
npm test                     # rules-engine unit tests (Vitest)
```

No database or API keys are required for local dev — the app runs on live data. History
features show "collecting data" until a `DATABASE_URL` is set.

Ingest a snapshot manually:

```bash
curl http://localhost:3000/api/cron/poll
```

## Architecture

```
lib/            isomorphic domain logic (runs on server AND in the browser)
  harbors.ts    10 harbor configs + exposure/crosswind model   ← the core IP
  boats.ts      boat profiles + skill modifiers
  rating.ts     green/yellow/red rules engine (pure, unit-tested)
  window.ts     next-24h sail-window scoring
  ndbc.ts       NDBC realtime2 parser (server-only)
  nws.ts        api.weather.gov + nearshore marine text (server-only)
  conditions.ts orchestration: assemble per-harbor conditions + persist
  astro.ts      sunrise/sunset
db/             optional Drizzle + Neon Postgres (history)
app/
  page.tsx              status board (client — recomputes on boat/skill change)
  harbor/[id]/page.tsx  full harbor detail
  api/conditions        current conditions for all harbors
  api/harbor/[id]       detail bundle
  api/cron/poll         scheduled snapshot (secret-guarded)
components/     UI (Header, HarborCard, WindChart, HourStrip, ScoreBars, …)
```

The browser fetches raw conditions and computes ratings **client-side** using the shared
`lib/` code, so changing boat or skill recomputes instantly.

## Deployment (Vercel + Neon)

1. Push to GitHub and import into **Vercel**.
2. Create a **Neon** (or any Postgres) database; run `npm run db:push` with `DATABASE_URL`
   set to create the tables.
3. Set environment variables in Vercel: `DATABASE_URL`, `CRON_SECRET`, `NWS_USER_AGENT`.
4. **Scheduling:** `vercel.json` includes a daily cron (the Hobby-plan limit). For the
   ~15-minute polling that history/notifications want, either upgrade to Pro (change the
   schedule to `*/15 * * * *`) or point an external scheduler
   ([cron-job.org](https://cron-job.org) or a GitHub Actions `*/15` workflow) at
   `https://<your-app>/api/cron/poll?secret=<CRON_SECRET>`.

## Caveats & roadmap

- **Exposure values are seed data.** `lib/harbors.ts` numbers come from geometry + general
  knowledge; they're a *living dataset* to refine with local sailor input.
- **Forecast wave heights are wind-sea estimates** (NWS gives hourly wind, not hourly
  nearshore waves).
- **Next (v2):** "Belmont just turned Green" notifications, historical-percentile copy once
  data accumulates, exposure tuning, and expansion to other Great Lakes marinas.

Guidance is interpretive — not an official forecast. Always check conditions yourself.
