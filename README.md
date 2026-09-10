# Great Lakes Harbor Report

**Should you go out right now?** A green / yellow / red status for 27 harbors across
Illinois, Wisconsin and Michigan — from the Chicago lakefront to Green Bay and the Bays
de Noc — personalized to your **boat** and **skill level**, whether that's a keelboat or
a paddleboard.

It does more than re-display a forecast. Lake-wide marine forecasts say "waves 2–4 ft"
but can't tell you that a NE wind piles steep waves on **Belmont's** breakwall while
**Burnham** stays sheltered. The app fuses per-harbor NWS gridpoint waves, live buoy wind,
and HRRR thunderstorm risk through a harbor-exposure model + rules engine to turn it all into
one decision — and signed-in users can watch harbors and set alert thresholds.

## What makes it more than an aggregator

- **Harbor exposure model** (`lib/harbors.ts`) — each harbor's entrance bearing, fetch by
  wind direction, and breakwater shelter. Turns one lake forecast into 27 answers.
- **Per-harbor conditions** — each harbor reads its own NWS gridpoint waves + marine wind, plus a
  regional HRRR **thunderstorm** signal, so scores differentiate instead of flat-lining.
- **Rules engine** (`lib/rating.ts`) — combines conditions + your boat + your skill into a
  status with a plain-English reason, and splits **harbor-exit** vs **open-lake** comfort
  (the "launch score" — some days are fine offshore but ugly getting in and out).
- **Harbor Intelligence** (`lib/intel.ts`) — condition-aware per-facet reads: entrance, docking,
  hazards, wind handling, sea state, cold-water safety, and storm risk.
- **Sail-window engine** (`lib/window.ts`) — scores the next 24 h (skipping storm hours) so you
  can plan: "Best window today: 8–11 AM."
- **Accounts & alerts** (Firebase Auth) — Google / email sign-in; watch harbors and set thresholds
  (wind direction, wind/gust limits, "turns green for my boat"). Delivery is the next phase.
- **Historical context** (Postgres, live) — every poll is snapshotted, powering "right now:
  rougher than 72% of September afternoons **for your setup**" and a 10-day green streak.
  Both are re-rated in the browser for your current boat, like everything else.
- **Station health** (`/health`) — checks that every data *column* the app depends on is still
  reporting. A station can be fresh and still have a dead sensor; that failure is quieter than
  an outage and changes what the ratings say.

## Data sources

| Source | Provides | Notes |
|---|---|---|
| NDBC buoys (per harbor — see `lib/harbors.ts`) | Live wind + gusts, waves, water temp | Proxied server-side (no CORS). Wind **speed, direction and gust resolve independently** down a fallback chain, because a station can lose one sensor and keep the rest. |
| **api.weather.gov `alerts/active`** | **NWS warnings and watches per harbor point** | A Tornado / Severe Thunderstorm / Special Marine Warning **pins the score to 0** — it outranks every model. Polled every 5 min. |
| **GLOS / Seagull** (`lib/glos.ts`) | Sofar Spotter waves + water temp; wind only where validated | Used where the nearest NDBC buoy reports no waves. Spotter "wind" is inferred from the wave spectrum and reads 1.1–1.9× an anemometer, so it is enabled per platform only after checking. |
| **api.weather.gov gridpoints** (`LOT/x,y`) | **Per-harbor wave height / period / direction + marine wind**, hourly forecast | CORS-open. Each harbor's offshore cell → its own waves; drives the board *and* the sail window. |
| api.weather.gov products | NOAA forecast discussion (AFD) | CORS-open |
| NWS nearshore text (11 zones, per harbor) | Wave-forecast line + Small Craft / Gale advisories | Parsed server-side |
| **HRRR** (3 km) via **Open-Meteo** (`lib/storm.ts`) | **Thunderstorm / convective risk** (CAPE), gusts, precip | JSON (NOMADS only offers GRIB2, impractical serverless). Regional; feeds the storm banner, the rating cap, and the sail window. |
| NWS RIDGE radar `KLOT` | Radar loop | Embedded image |
| NOAA GLERL Chicago cam | Lakefront webcam | Embedded image |
| suncalc | Sunrise / sunset | Computed locally |

## Local development

```bash
npm install
cp .env.example .env         # optional — app runs without any env. NOT .env.local
npm run dev                  # http://localhost:3000
npm test                     # unit tests (Vitest, offline)
```

Use `.env`, not `.env.local`. Only `.env` is read by everything that needs it — `next dev`,
the live scripts and drizzle-kit (via `scripts/load-env.ts`), and the deployed function.
`.env.local` is loaded by `next dev` alone, so a `DATABASE_URL` placed there appears to work
locally and then silently does nothing in `npm run backfill:history`, `npm run db:push`, or
production. Both files are gitignored.

Occasional commands:

```bash
npm run validate:stations    # live: does each harbor's wind source agree with a neighbour?
npm run backfill:history     # live: seed ~45 days of snapshots from NDBC/GLOS (needs DATABASE_URL)
npm run db:push              # apply the Drizzle schema
```

No database or API keys are required for local dev — the app runs on live data. History
features show "collecting data" until a `DATABASE_URL` is set. Sign-in/alerts use the Firebase
project config baked into `lib/firebase.ts` (public web config); to run against your own project,
swap that config and enable the Auth providers.

Ingest a snapshot manually:

```bash
curl http://localhost:3000/api/cron/poll
```

## Architecture

```
lib/            isomorphic domain logic (runs on server AND in the browser)
  harbors.ts    27 harbor configs + exposure/crosswind model   ← the core IP
  boats.ts      boat profiles + skill modifiers
  rating.ts     green/yellow/red rules engine (pure, unit-tested)
  intel.ts      condition-aware Harbor Intelligence (per-facet live reads)
  window.ts     next-24h sail-window scoring
  ndbc.ts       NDBC realtime2 parser (server-only)
  nws.ts        api.weather.gov gridpoints (per-harbor wave+wind) + marine text (server-only)
  storm.ts      HRRR thunderstorm risk via Open-Meteo (server-only)
  alerts.ts     NWS active warnings — a stop-level warning pins the score to 0 (server-only)
  glos.ts       GLOS/Seagull waves, water temp, validated Spotter wind (server-only)
  history.ts    afternoon summaries -> percentiles + green streak (pure; db/history.ts queries)
  stationHealth.ts  per-column station health (pure); health.ts does the fetching
  brand.ts      product name + tagline, in one place
  conditions.ts orchestration: assemble per-harbor conditions + persist
  astro.ts      sunrise/sunset
  firebase.ts   Firebase client init (Auth + Firestore "sailing" DB)
  userPrefs.ts  per-user alert prefs (Firestore read/write)
db/             optional Drizzle + Neon Postgres (history)
app/
  page.tsx              status board (client — recomputes on boat/skill change)
  harbor/[id]/page.tsx  full harbor detail
  account/page.tsx      sign in / sign up (Google + email)
  alerts/page.tsx       watch-list + alert thresholds (signed-in)
  health/page.tsx       station health — an ops page, deliberately not linked from the nav
  api/conditions        current conditions for all harbors
  api/harbor/[id]       detail bundle
  api/harbor/[id]/history  afternoon summaries the browser re-rates for percentiles
  api/cron/poll         scheduled snapshot (secret-guarded)
  api/cron/health       station health check (secret-guarded, 200 healthy / 503 needs attention)
components/     UI (Header, HarborCard, WindChart, HourStrip, ScoreBars, auth, …)
```

The browser fetches raw conditions and computes ratings **client-side** using the shared
`lib/` code, so changing boat or skill recomputes instantly.

## Deployment (Firebase Hosting)

Deployed via Firebase's web-frameworks integration — SSR runs on a Cloud Function
(us-central1) behind a dedicated Hosting site.

```bash
npm run deploy                                                   # the app
firebase deploy --only firestore:rules --project <your-project>  # auth-data rules
```

**Deploy with `npm run deploy`, not bare `firebase deploy`.** The wrapper
(`scripts/deploy.mjs`) exists because the bare command has bitten this project three ways:
it uploads a stale `.next/dev` (measured at 580 MB — over half the package, and the reason
deploys took 7+ minutes), it leaves Firebase's 10 s SSR-discovery timeout at a value the
Next entry intermittently exceeds, and piping its output masks a *failed* deploy as exit 0.

- **Config:** `firebase.json` (hosting `site` + `frameworksBackend`, plus the Firestore rules
  target), `firestore.rules` (own-document-only), Node 20 runtime (`package.json` engines).
- **Auth (one-time console setup):** enable Authentication + the **Google** and **Email/Password**
  providers, and add your hosting domain to **Authorized Domains**. User data lives in a dedicated
  `sailing` Firestore database.
- **Optional history:** set `DATABASE_URL` (Neon/Postgres) to persist snapshots. Both keys live in
  a gitignored `.env` at the repo root — that one file feeds `next dev`, the tooling, and the
  deployed function (the deploy copies it in and Firebase turns each key into a Cloud Run env var).
  `.env.local` is loaded **only** by `next dev` and never reaches production.
- A `vercel.json` is included if you'd rather deploy to Vercel. Its cron is **daily**, which is a
  Vercel Hobby limitation rather than the schedule this app wants — on Firebase the poll runs every
  15 minutes via Cloud Scheduler (below).

### Scheduled jobs (Cloud Scheduler)

Two jobs, both authenticating with `Authorization: Bearer $CRON_SECRET`. Substitute your own
secret and project.

```bash
gcloud scheduler jobs create http harbor-poll-15min --project=mootek-consulting --location=us-central1 --schedule="*/15 * * * *" --uri="https://chicago-harbor-sailing.web.app/api/cron/poll" --http-method=GET --headers="Authorization=Bearer $CRON_SECRET" --attempt-deadline=90s --max-retry-attempts=2
```

```bash
gcloud scheduler jobs create http harbor-health-weekly --project=mootek-consulting --location=us-central1 --schedule="0 8 * * 1" --time-zone="America/Chicago" --uri="https://chicago-harbor-sailing.web.app/api/cron/health" --http-method=GET --headers="Authorization=Bearer $CRON_SECRET" --attempt-deadline=90s --max-retry-attempts=0
```

- **`/api/cron/poll`** — snapshots all harbors. Retries make sense here: a missed run is a
  permanent hole in the history.
- **`/api/cron/health`** — station health (see `/health`). Returns **200 healthy / 503
  needs-attention**, so a failed job in the console *is* the alert. Retries are **0** on purpose:
  a 503 is a determination, not a transient error, and the stations will not be healthier in
  sixty seconds.
- ⚠️ After creating or rotating either job, **verify the header matches `.env`**. A job created
  with the wrong secret 401s silently every run while the site looks perfectly healthy — that
  happened here, and the poll went nowhere until it was caught by comparing hashes.
- `attempt-deadline` above 90 s buys nothing: Firebase Hosting hard-caps a proxied request at 60 s.

## Caveats & roadmap

- **Exposure values are seed data.** `lib/harbors.ts` numbers come from geometry + general
  knowledge; they're a *living dataset* to refine with local sailor input.
- **Waves are NWS gridpoint *model* output** per harbor (not buoy observations) — spatially
  differentiated but modeled; a wind-sea estimate is only the fallback when a cell has no value.
- **Shipped since:** historical percentiles and the green streak (live, backed by Neon +
  a 15-minute poll), NWS warning ingestion, and automated station-health checks (`/health`).
- **Next:** alert **delivery** (a scheduled evaluator → email + browser push for watched
  harbors) — the settings page saves rules today but nothing reads them yet; exposure tuning;
  water-level / seiche data and more Great Lakes marinas.

Guidance is interpretive — not an official forecast. Always check conditions yourself.
