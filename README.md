# Chicago Harbor Sailing Dashboard

**Should I sail out of my harbor right now?** A green / yellow / red status for every
Chicago Park District harbor, personalized to your **boat** and **skill level**.

It does more than re-display a forecast. Lake-wide marine forecasts say "waves 2–4 ft"
but can't tell you that a NE wind piles steep waves on **Belmont's** breakwall while
**Burnham** stays sheltered. The app fuses per-harbor NWS gridpoint waves, live buoy wind,
and HRRR thunderstorm risk through a harbor-exposure model + rules engine to turn it all into
one decision — and signed-in users can watch harbors and set alert thresholds.

## What makes it more than an aggregator

- **Harbor exposure model** (`lib/harbors.ts`) — each harbor's entrance bearing, fetch by
  wind direction, and breakwater shelter. Turns one lake forecast into ten answers.
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
- **Stored history** (optional Postgres) — every poll can be snapshotted, powering planned
  percentiles ("rougher than 90% of July afternoons") and "green X of last 10 days."

## Data sources

| Source | Provides | Notes |
|---|---|---|
| NDBC buoys `45198`, `CHII2`, `CNII2`, `CMTI2` | Live wind + gusts, water temp; buoy wave (fallback) | Proxied server-side (no CORS). Wind uses a fallback chain if a buoy's anemometer drops out. |
| **api.weather.gov gridpoints** (`LOT/x,y`) | **Per-harbor wave height / period / direction + marine wind**, hourly forecast | CORS-open. Each harbor's offshore cell → its own waves; drives the board *and* the sail window. |
| api.weather.gov products | NOAA forecast discussion (AFD) | CORS-open |
| NWS nearshore text `LMZ741/742` | Wave-forecast line + Small Craft / Gale advisories | Parsed server-side |
| **HRRR** (3 km) via **Open-Meteo** (`lib/storm.ts`) | **Thunderstorm / convective risk** (CAPE), gusts, precip | JSON (NOMADS only offers GRIB2, impractical serverless). Regional; feeds the storm banner, the rating cap, and the sail window. |
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
  harbors.ts    10 harbor configs + exposure/crosswind model   ← the core IP
  boats.ts      boat profiles + skill modifiers
  rating.ts     green/yellow/red rules engine (pure, unit-tested)
  intel.ts      condition-aware Harbor Intelligence (per-facet live reads)
  window.ts     next-24h sail-window scoring
  ndbc.ts       NDBC realtime2 parser (server-only)
  nws.ts        api.weather.gov gridpoints (per-harbor wave+wind) + marine text (server-only)
  storm.ts      HRRR thunderstorm risk via Open-Meteo (server-only)
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
  api/conditions        current conditions for all harbors
  api/harbor/[id]       detail bundle
  api/cron/poll         scheduled snapshot (secret-guarded)
components/     UI (Header, HarborCard, WindChart, HourStrip, ScoreBars, auth, …)
```

The browser fetches raw conditions and computes ratings **client-side** using the shared
`lib/` code, so changing boat or skill recomputes instantly.

## Deployment (Firebase Hosting)

Deployed via Firebase's web-frameworks integration — SSR runs on a Cloud Function
(us-central1) behind a dedicated Hosting site.

```bash
firebase deploy --only hosting --project <your-project>          # the app
firebase deploy --only firestore:rules --project <your-project>  # auth-data rules
```

- **Config:** `firebase.json` (hosting `site` + `frameworksBackend`, plus the Firestore rules
  target), `firestore.rules` (own-document-only), Node 20 runtime (`package.json` engines).
- **Auth (one-time console setup):** enable Authentication + the **Google** and **Email/Password**
  providers, and add your hosting domain to **Authorized Domains**. User data lives in a dedicated
  `sailing` Firestore database.
- **Optional history:** set `DATABASE_URL` (Neon/Postgres) to persist snapshots; drive the ~15-min
  poll (`/api/cron/poll`, secret-guarded) with **Cloud Scheduler** or an external pinger.
- A `vercel.json` is also included if you'd rather deploy to Vercel instead.

## Caveats & roadmap

- **Exposure values are seed data.** `lib/harbors.ts` numbers come from geometry + general
  knowledge; they're a *living dataset* to refine with local sailor input.
- **Waves are NWS gridpoint *model* output** per harbor (not buoy observations) — spatially
  differentiated but modeled; a wind-sea estimate is only the fallback when a cell has no value.
- **Next:** alert **delivery** (a scheduled evaluator → email + browser push for watched harbors);
  historical percentiles + "green X of last 10 days" once snapshots accumulate; exposure tuning;
  water-level / seiche data and more Great Lakes marinas.

Guidance is interpretive — not an official forecast. Always check conditions yourself.
