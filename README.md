# Great Lakes Harbor Report

**Should you go out right now?** A green / yellow / red call for 27 harbors on Lake Michigan
and Green Bay — the Chicago lakefront, the Illinois–Wisconsin north shore, Michigan's east
shore, and Green Bay and the Bays de Noc — personalized to your **boat** and **skill**,
whether that's a keelboat, a Hobie Cat or a paddleboard.

Live at **https://chicago-harbor-sailing.web.app**

A lake-wide marine forecast says "waves 2–4 ft". It can't tell you that a NE wind piles steep
waves onto **Belmont's** entrance while **Burnham**, a few miles south, stays sheltered. This
app's value is the *interpretation*, not the aggregation: it takes live buoy and Spotter wind,
observed waves blended with per-harbor NWS model waves, nearshore marine advisories, NWS
warnings and HRRR thunderstorm risk, runs them through a per-harbor exposure model and a rules
engine, and returns one decision with the reason in plain English.

## Features

### The board (`/`)

- Every harbor rated for the boat and skill chosen in the header. Changing either re-rates
  instantly, in the browser.
- Region filters (Chicago · North Shore · Michigan · Green Bay) and ★ favorites, remembered
  between visits. A "best harbor right now" strip; cards sorted green → yellow → red → no data.
- Each card: status and 0–100 score, the reason, wind / gust / direction, waves, water temp,
  and separate **harbor-exit** and **open-lake** scores. ⛔ marks a life-threatening NWS warning;
  ⛈ marks an active or elevated thunderstorm.
- Refreshes every 5 minutes. Light / dark theme.

### Harbor detail (`/harbor/[id]`)

- Status, score and reason, with a pill for each NWS alert, the marine advisory, and the HRRR
  storm headline.
- **Launch score** — harbor exit vs open lake, and which factor is limiting. Some days are fine
  offshore and ugly getting in and out.
- **Recommended sail window** — the next 24 hours rated hour by hour for your boat, and the
  best daylight stretch ("Best window today: 8 AM–11 AM (green).").
- **How today compares** — history, when a database is configured (below).
- **Harbor intelligence** — up to seven condition-aware reads: entrance, docking (launch &
  landing for paddlers), hazards, wind & handling, sea state, cold water & safety, storm &
  squalls.
- Live wind over the last 24 h (harbors with their own NDBC station), current conditions, the
  nearshore marine forecast, a radar loop, a lakefront webcam where a representative one
  exists, and the local NWS Area Forecast Discussion.

### Boats, craft and skill

- Six built-in profiles: Kayak / Paddleboard, 18 ft Daysailer, Hobie Cat, J/24, Catalina 30
  (default), Beneteau 40.
- Three skill levels scale every limit: Beginner ×0.75, Intermediate ×1.0, Advanced ×1.2.
- **Craft-aware.** Paddlers get "Go kayaking / paddleboarding", "Launch & landing", an
  offshore-wind warning, and never reef or slip advice. The copy is deliberately craft-neutral.
- **My boats** (`/boats`, signed in) — add your own boat from its ISO 12217 design category
  (A–D) plus optional LOA, beam, displacement, ballast, draft and AVS. Limits are derived from
  the Capsize Screening Formula and an estimated angle of vanishing stability; a 53-boat
  catalog autofills specs. Custom boats are rated as sailboats.

### Accounts and alerts

- Google or email / password sign-in (Firebase Auth). Signed out, everything else still works:
  boat, skill, favorites, filter and theme live in `localStorage`.
- Signed in, favorites sync across devices, custom boats are saved, and you can set up an alert
  (`/alerts`): watched harbors, the alert's own boat and skill, and rules — turns green, wind
  from chosen directions, max wind / gust / waves (all must hold) — plus a channel (email or
  browser push).
- **Alert delivery is not built yet.** Settings are saved, but nothing evaluates or sends them.
  That is the next phase.

### History

With a Postgres database configured, every 15-minute poll is snapshotted, and the detail page
adds lines like *"Right now: rougher than 72% of October afternoons for your setup"* and
*"Green 6 of the last 9 afternoons for this boat"* — both re-rated in the browser for your
current boat and skill. Without a database the panel is simply hidden.

### Elsewhere

- Cross-links to the sister site **Recall Monitor**: a banner below the board, recall checks for
  your saved boats, and a life-jacket recall link when the water is below 70 °F.
- **`/health`** — an operations page (deliberately not in the nav) showing whether every data
  column the ratings depend on is still reporting. See [Operations](#operations).

## How the rating works

**Exposure model** (`lib/harbors.ts`, the core IP). Each harbor has an entrance bearing, an
exposure scale, and wind sectors that are sheltered (×0.4) or exposed (×1.4). A 16-point fetch
shape built for Chicago's west shore is rotated toward each harbor's own open water where
needed (`openWaterBearing`). From that:
`exit waves = waves × exposureForWind(direction)` and
`entrance crosswind = |sin(wind − entrance bearing)| × wind`.
The numbers are seed values, meant to be tuned with local knowledge.

**Rules engine** (`lib/rating.ts`, pure). Each metric scores linearly from 100 at the boat's
calm limit to 0 at its max, after skill scaling. Wind counts as the larger of the sustained
speed and 0.9 × the gust. The **open-lake** score uses wind and waves; the **harbor-exit** score
uses wind, exit waves and entrance crosswind. Score = the lower of the two; **green ≥ 60,
yellow 30–59, red < 30**, and the lowest-scoring metric is named as the limiter.

**Caps** — why a calm-looking day can still be red:

| Trigger | Score capped at |
|---|---|
| NWS Tornado, Severe Thunderstorm, Special Marine, Hurricane or Tropical Storm Warning; waterspouts | **0** — outranks every model, and leads the reason |
| Marine Storm Warning | 5 |
| HRRR thunderstorm **active** (stormy now or next hour) | 8 |
| Gale Warning | 10 |
| Small Craft Advisory | 24 / 48 / 58 by skill, plus up to 20 for a sheltered harbor |
| NWS Tornado or Severe Thunderstorm **Watch**; HRRR storm **elevated** (next 6 h) | 45 |

**Unknown wind direction → assume the worst.** If no station or model can supply a bearing,
exit waves use the harbor's worst exposure over every bearing and the crosswind is taken as the
full wind speed. A dead wind vane makes ratings cautious, never optimistic.

**Sail window** (`lib/window.ts`). The first 24 hours of the gridpoint forecast, each rated for
your boat; hours HRRR flags as stormy are forced red. The summary picks the longest daylight run
of green (at least 2 h), else yellow.

**Harbor intelligence** (`lib/intel.ts`). Turns the same inputs into per-facet reads with
Clear / Watch / Caution severity, written differently for sailors and paddlers.

**History** (`lib/history.ts`, pure; `db/history.ts` queries). Snapshots between noon and 6 PM
harbor-local time are collapsed into one summary per afternoon. The server sends raw summaries;
the browser re-rates them for the current boat and skill. The percentile ranks the *live* score
against past afternoons (same month once 8 exist; ties split down the middle) and appears after
8 ratable afternoons. The green count covers the last 10 calendar days. Storms and NWS alerts
can't be reconstructed per afternoon, so history leaves them out.

## Data sources

Everything is fetched server-side (NDBC has no CORS) and cached per source; the browser loads
only the radar and webcam images directly.

| Source | Provides | Notes |
|---|---|---|
| **NDBC** realtime2 (`lib/ndbc.ts`) | Wind speed / direction / gust, waves, water and air temp | 5 min cache. A station with nothing in the last 3 h counts as dark. |
| **NWS gridpoints** (`lib/nws.ts`) | Per-harbor model waves (height / period / direction), wind, 48 h hourly forecast | Each harbor's own cell, 30 min cache. The model half of the wave blend; wind only where no observation exists. |
| **NWS nearshore marine text** (tgftp) | Wave forecast line; Small Craft Advisory / Gale / Storm Warning | One product per marine zone, 30 min cache. |
| **NWS active alerts** (`lib/alerts.ts`) | Warnings and watches at each harbor's point | 5 min cache. Drives the 0 / 45 caps above. |
| **NWS Area Forecast Discussion** | Forecaster reasoning from the harbor's own office | 30 min cache. |
| **HRRR** (3 km) via **Open-Meteo** (`lib/storm.ts`) | CAPE, precipitation, gusts → thunderstorm risk | Per ~50 km storm cell, 45 min cache. An hour is stormy on CAPE ≥ 500 J/kg with rain, or on ≥ 2.5 mm/h of rain alone (CAPE collapses once a squall is overhead). |
| **GLOS Seagull** (`lib/glos.ts`) | Sofar Spotter waves and water temp; spectral wind where validated | Used where no NDBC wave buoy is close. Spotter "wind" is inferred from the wave spectrum and reads 1.1–1.9× an anemometer, so it is enabled per platform only after checking, and supplies speed only. Spotters are pulled each winter. |
| **NWS RIDGE radar** | Radar loop for the harbor's radar site | Image. |
| **NOAA GLERL webcams** | Lakefront camera | Image, only where a representative cam exists. |
| **suncalc** | Sunrise / sunset | Computed locally. |

**How a harbor's conditions are assembled** (`lib/conditions.ts`):

- **Wind** — speed, direction and gust each resolve independently, because a station can lose
  one sensor and keep the rest: the harbor's own station first, then (unless the harbor opts into
  `windFromGrid`) the Chicago lakefront stations. Failing those, a validated Spotter's speed
  (direction and gust from the model), then the gridpoint model. A borrowed gust below the
  sustained wind is dropped.
- **Waves** — an observed wave (NDBC buoy or Spotter) is blended with the model, weighted by
  distance: 0.85 observation at the harbor, falling to 0.45 at 30 km or more.
- **Freshness** — a source that has gone quiet reads as *absent*, never as current, so ratings
  fall back to the model instead of showing stale observations.

## Local development

```bash
npm install
cp .env.example .env         # optional — the app runs with no env at all. Use .env, NOT .env.local
npm run dev                  # http://localhost:3000
npm test                     # unit tests (Vitest, offline)
npx tsc --noEmit             # type check
```

No database or API key is needed: the app runs on live public data. Sign-in uses the public
Firebase web config in `lib/firebase.ts`; swap it to point at your own project.

**Environment** — all optional, all in a gitignored `.env` at the repo root:

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Postgres (Neon) for history. Without it, history is off. |
| `CRON_SECRET` | Guards `/api/cron/*` (`?secret=` or `Authorization: Bearer`). When unset the routes are open, as in local dev. |
| `NWS_USER_AGENT` | Contact User-Agent that NWS asks for on its APIs. A generic fallback is used if unset. |

Use `.env`, not `.env.local`: `.env` is read by `next dev`, the live scripts and drizzle-kit (via
`scripts/load-env.ts`), and the deployed function. `.env.local` is read by `next dev` alone, so a
`DATABASE_URL` there appears to work locally and then silently does nothing everywhere else.

**Scripts:**

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev server / production build / production server |
| `npm test` / `test:watch` | Offline unit tests (`lib/**/*.test.ts`) |
| `npm run lint` | ESLint |
| `npm run validate:stations` | Live: does each harbor's wind source agree with an independent neighbour? |
| `npm run backfill:history` | Live: seed ~45 days of snapshots from NDBC / GLOS (needs `DATABASE_URL`) |
| `npm run db:push` | Apply the Drizzle schema to the database |
| `npm run deploy` | Deploy to Firebase Hosting (see below — always use this) |

Take a snapshot by hand: `curl http://localhost:3000/api/cron/poll`.

## Architecture

```
lib/              domain logic — isomorphic unless marked server-only
  harbors.ts      27 harbor configs + exposure / crosswind model        ← the core IP
  rating.ts       green / yellow / red rules engine (pure)
  window.ts       next-24 h sail window
  intel.ts        Harbor Intelligence, craft-aware
  history.ts      afternoon summaries → percentile + green count (pure)
  boats.ts        built-in boat profiles + skill factors
  boatSpecs.ts    custom boats: ISO 12217 category + CSF + AVS → limits
  boatCatalog.ts  53-boat catalog for the My boats typeahead
  stationHealth.ts  per-column station health, the drift rule, and which source each
                  harbor's live wind comes from (pure; shared with the validator)
  units.ts        knots / feet / °F conversions (NDBC is metric)
  brand.ts        product name + tagline — the only place the name lives
  recalls.ts      Recall Monitor links
  astro.ts        sunrise / sunset
  types.ts        shared types
  conditions.ts   assembles per-harbor conditions + persists snapshots    (server-only)
  ndbc.ts  nws.ts  alerts.ts  storm.ts  glos.ts   source fetchers         (server-only)
  health.ts       fetches the rows stationHealth.ts grades                (server-only)
  firebase.ts     Firebase client (Auth + Firestore, loaded lazily)
  userPrefs.ts    favorites, custom boats and alert settings on users/{uid}
db/               optional Drizzle + Neon Postgres: schema, client, history query
app/
  page.tsx                  the board (client — re-rates on boat / skill change)
  harbor/[id]/page.tsx      harbor detail
  boats/  alerts/  account/ My boats, alert settings, sign in
  health/page.tsx           station health (server-rendered, unlinked)
  api/conditions            current conditions for every harbor
  api/harbor/[id]           detail bundle;  …/history  afternoon summaries
  api/cron/poll             15-minute snapshot
  api/cron/health           station health check (200 healthy / 503 needs attention)
components/       Header, HarborCard, WindChart, HourStrip, ScoreBars, Panel, auth, prefs, theme
scripts/          deploy wrapper, live validator, history backfill, .env loader
docs/             ADDING_HARBORS.md — the playbook for adding a harbor
```

The browser fetches raw conditions and rates them with the same `lib/` code the server uses.
That is what makes boat and skill changes instant, and why most of `lib/` must stay isomorphic
(no `fetch`, no Node-only APIs, no `process.env`).

## Operations

### Deploy (Firebase Hosting)

Firebase's web-frameworks integration: SSR runs on a Cloud Function in us-central1
(`frameworksBackend`: max 2 instances, **512 MiB**) behind Hosting site `chicago-harbor-sailing`
in project `mootek-consulting`.

```bash
npm run deploy
```

**Always `npm run deploy`, never bare `firebase deploy`.** The wrapper (`scripts/deploy.mjs`)
clears `.next/dev` and `.next/cache` (a stale 580 MB dev cache once doubled the upload and the
deploy time), raises Firebase's 10 s SSR-discovery timeout to 180 s, and exits with Firebase's
real status — piping the bare command's output once masked a failed deploy as success.

- **Runtime:** Node 22 (`package.json` engines; firebase-tools maps it to `nodejs22` and
  refuses to deploy a decommissioned runtime). Google stops patching Node 22 on 2027-04-30.
- **Memory:** keep 512 MiB. Node 22 exceeds the 256 MiB default; at 256, about 40% of poll
  attempts were killed, and the scheduler's retries hid it. After any runtime or infra change,
  check the poll's per-attempt failures and `Memory limit` log lines, not just that pages load.
- **Env:** the deploy copies `.env` into the function, and each key becomes a Cloud Run
  environment variable.
- **Auth and Firestore** live in a *separate* Firebase project (`chicago-harbor-sailing-app`),
  default database, rules allowing each user only their own `users/{uid}` document. The deploy
  wrapper doesn't touch them; deploy rules to that project:
  `firebase deploy --only firestore:rules --project chicago-harbor-sailing-app`.
  One-time console setup: enable the Google and Email/Password providers and add the hosting
  domain to Authorized Domains.
- `vercel.json` is an alternative target (its cron is daily — a Vercel Hobby limit).
  `apphosting.yaml` is an unused leftover; the shipping path is the one above.

### Scheduled jobs (Cloud Scheduler)

Two jobs, both sending `Authorization: Bearer $CRON_SECRET`. Substitute your own secret and
project.

```bash
gcloud scheduler jobs create http harbor-poll-15min --project=mootek-consulting --location=us-central1 --schedule="*/15 * * * *" --uri="https://chicago-harbor-sailing.web.app/api/cron/poll" --http-method=GET --headers="Authorization=Bearer $CRON_SECRET" --attempt-deadline=90s --max-retry-attempts=2
```

```bash
gcloud scheduler jobs create http harbor-health-weekly --project=mootek-consulting --location=us-central1 --schedule="0 8 * * 1" --time-zone="America/Chicago" --uri="https://chicago-harbor-sailing.web.app/api/cron/health" --http-method=GET --headers="Authorization=Bearer $CRON_SECRET" --attempt-deadline=90s --max-retry-attempts=0
```

- **`/api/cron/poll`** snapshots every harbor. Retries make sense: a missed run is a permanent
  hole in the history.
- **`/api/cron/health`** returns **200 healthy / 503 needs attention**, so a failed job in the
  console *is* the alert. No retries: a 503 is a finding, not a transient error.
- ⚠️ After creating or rotating either job, **verify its header matches `.env`** (compare
  hashes, never paste the secret). A job with the wrong secret 401s silently every run while
  the site looks perfectly healthy — that happened here.
- Firebase Hosting caps a proxied request at 60 s, so a longer attempt deadline buys nothing.

### Station health and validation

Two checks with different jobs:

- **`/health` and the weekly job** — *is every column we depend on still reporting?* Each NDBC
  station and GLOS Spotter is graded per column over the last 48 hours, because a fresh feed can
  carry a dead sensor for weeks (45198 reported wind speed with no direction). Which sensors a
  platform lacks is **declared** (`SENSORLESS`), never inferred. The job returns 503 when any
  NDBC station is dark or has a dead depended-on column, or when a Spotter that supplies *wind*
  is. Expect a seasonal 503 when such a Spotter is pulled for the winter. `/health` itself is
  public (only the cron route is guarded) and runs a live check on every load.
- **`npm run validate:stations`** — *does each station still agree with its neighbours?* It
  tests the source each harbor actually rates from against the nearest independent reference
  over 10 days, and fails on anything reading below 0.7× — the direction that makes conditions
  look safer than they are. Nothing schedules it: run it before shipping any new station.
  [`docs/ADDING_HARBORS.md`](docs/ADDING_HARBORS.md) explains how to read its output.

### History database

Two tables (`db/schema.ts`): `harbor_snapshots`, one row per harbor per poll, and
`observations`, keyed per station. Unique keys on (harbor, time) and (station, time) make the
poll and the backfill idempotent. The schema is applied with `npm run db:push` — no migrations
are committed. ⚠️ On a populated database, never accept drizzle-kit's offer to truncate a table.

## Adding a harbor

Follow [`docs/ADDING_HARBORS.md`](docs/ADDING_HARBORS.md): marine zone and gridpoint, picking
and **validating** a wind station (proximity is not accuracy), exposure geometry, radar /
forecast office / webcam, optional GLOS sources, then `validate:stations` and `/health`.
`lib/harbors.ts` is the source of truth for which stations each harbor uses; `/health` says which
of them are reporting right now.

## Known issues

- **Exposure values are seed data** — geometry and general knowledge, to be refined with local
  sailors' input.
- **Times are shown in Central time** on the detail page, including for the Michigan harbors that
  keep Eastern time.
- The Area Forecast Discussion link is labelled "LOT" for every harbor, though it loads the
  harbor's own office. A caption still calls forecast waves "wind-sea estimates", though they come
  from the NWS gridpoint.
- With no wind direction the **rating** assumes the worst, but **Harbor intelligence** shows the
  entrance as "Clear".
- Harbors without their own NDBC station show no 24-hour wind chart.
- A harbor whose own station goes dark borrows wind from the Chicago lakefront stations, which
  can be 70+ km away for the Wisconsin and Michigan harbors.
- Some copy still says "sailor" / "sail window" where it should be craft-neutral.

## Roadmap

- **Alert delivery** — a scheduled evaluator that reads saved alert settings and sends email /
  browser push for watched harbors.
- Fix the known issues above; tune exposure values with local input.
- More Great Lakes harbors; water-level / seiche data.
- Move to Node 24 before Node 22 stops being patched (2027-04-30).

---

Guidance is interpretive — not an official forecast. Always check conditions yourself.
