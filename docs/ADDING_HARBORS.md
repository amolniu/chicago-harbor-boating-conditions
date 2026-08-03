# Adding a harbor / marina

A harbor is one entry in `HARBORS` (`lib/harbors.ts`). Everything else — scoring,
Harbor Intelligence, the sail window, the detail page — is driven off that config,
so adding a marina is mostly **research + one config object + a sanity test**.

This is the repeatable process for scaling to the rest of the Great Lakes. The two
Michigan harbors (St. Joseph, New Buffalo) are worked examples in `lib/harbors.ts`.

## The `Harbor` fields and where each comes from

| Field | What it is | How to get it |
|---|---|---|
| `id`, `name`, `lat`, `lon` | identity + location | the marina's coordinates |
| `buoyStation?` | NDBC station for **live wind + temp** | nearest station with a `realtime2` feed (step 2). Omit for buoy-less harbors (set `windFromGrid`) |
| `windFromGrid?` | take live wind from the **gridpoint model** instead of a buoy | `true` when no usable wind buoy exists nearby (e.g. Green Bay). Waves still come from `waveGrid`; water temp is left blank |
| `waveBuoy?` | `{ station, km }` — a wave buoy right off the harbor + its distance | optional — a buoy closer than `buoyStation` for waves; its **observed** wave is blended with the gridpoint model, weighted by `km` (closer ⇒ more weight). Often a wave-only buoy like `45186`/`45187` (step 2) |
| `marineZone` | NWS nearshore zone (advisories, wave text) | from the point lookup (step 1) — e.g. `LMZ043` |
| `waveGrid` | NWS gridpoint `OFFICE/x,y` for **per-harbor waves + marine wind** | from the point lookup (step 1) — e.g. `IWX/19,82` |
| `openWaterBearing?` | bearing (°true) toward **open water / longest fetch** | **the key shore-aware field** (step 3). Unset ⇒ Chicago west-shore default |
| `entranceBearing` | heading you steer leaving the harbor | from the chart / satellite view |
| `exposureScale` | overall openness, 0 (tucked away) – 1 (wide open) | seed estimate, refine with local input |
| `exposedDirs?` / `shelteredDirs?` | dirs the breakwater funnels (×1.4) / blocks (×0.4) | seed estimate |
| `discussionOffice?` | NWS office for the Area Forecast Discussion | from the point lookup `office` (default `LOT`) |
| `radarStation?` | NWS RIDGE radar, e.g. `KGRR` | nearest radar covering the shoreline (default `KLOT`) |
| `webcamUrl?` | lakefront webcam image URL | a GLERL cam if one exists nearby; `""` hides the panel |
| `timezone?` | IANA tz for local-time copy (storm headlines) | default `America/Chicago`; Michigan's east shore **and Delta County in the UP** are `America/Detroit`, while the far-western UP (Menominee, Dickinson, Iron, Gogebic counties) stays Central |
| `notes` | entrance / docking / hazards local knowledge | local knowledge (seed) |

## Step 1 — resolve marine zone + wave gridpoint + office

Pick a point **just offshore** of the harbor (nudge into open water), then:

```bash
python3 - <<'PY'
import json, urllib.request
UA = "yourapp you@example.com"
lat, lon = 42.1146, -86.52   # offshore of the harbor
def get(u):
    r = urllib.request.Request(u, headers={"User-Agent": UA, "Accept": "application/geo+json"})
    return json.load(urllib.request.urlopen(r, timeout=20))
p = get(f"https://api.weather.gov/points/{lat},{lon}")["properties"]
grid = f"{p['gridId']}/{p['gridX']},{p['gridY']}"
gp = get(f"https://api.weather.gov/gridpoints/{p['gridId']}/{p['gridX']},{p['gridY']}")["properties"]
print("office:", p["cwa"], "| grid (waveGrid):", grid,
      "| zone (marineZone):", p["forecastZone"].split("/")[-1],
      "| waveHeight entries:", len(gp.get("waveHeight", {}).get("values") or []))
PY
```

`waveHeight entries > 0` confirms the cell has wave model output. Use `grid` as
`waveGrid`, the zone as `marineZone`, and `office` as `discussionOffice`.

## Step 2 — find the nearest buoy (live wind)

Look up NDBC stations near the harbor (ndbc.noaa.gov map, or search). A station is
usable here only if it has a **`realtime2` text feed** with wind (`WDIR`/`WSPD`):

```bash
curl -s "https://www.ndbc.noaa.gov/data/realtime2/45170.txt" | sed -n '1p;3p'
```

- Row present with real `WDIR WSPD` numbers → usable → set `buoyStation`.
- `404` (e.g. some CO-OPS stations like `SJOM4`) → pick another (an offshore `45xxx`
  buoy, or the nearest GLERL met station like `MCYI3`).
- No waves in the buoy (`WVHT = MM`) is fine — waves come from `waveGrid`.
- **No usable buoy at all?** Some regions (e.g. Green Bay / the Bays de Noc) have only
  GLOS stations that lack a `realtime2` feed (they 404), and the nearest real buoy is
  far away in a different water body. In that case omit `buoyStation` and set
  **`windFromGrid: true`** — live wind then comes from the harbor's own NWS gridpoint
  model (the same source as the wind forecast). Waves still come from `waveGrid`; water
  temp and the buoy wind-history graph are simply blank (no local observed source).
- The reverse also happens: a **wave-only** buoy (`WDIR`/`WSPD` always `MM`, `WVHT`
  present — e.g. `45186` Waukegan, `45187` Winthrop Harbor) can't drive wind, but if it
  sits right off the harbor, set it as **`waveBuoy: { station, km }`** so its observed
  wave is blended with the gridpoint model, while `buoyStation` handles wind. `km` is the
  buoy→harbor distance (haversine); it sets the blend weight — closer earns more (see
  `waveObsWeight`), so even a marginal 15–20 km buoy can contribute at reduced weight.
  The same station can be both `buoyStation` and `waveBuoy` if it reports wind **and**
  waves and is the closest option (e.g. South Haven's `45168`).

⚠️ **Use the station id in UPPERCASE.** `realtime2` filenames are uppercase, but the
station table lists non-numeric ids in lowercase — copy one straight out and you get a
404 that looks like "this station has no feed". `KWNW3` returns data; `kwnw3` 404s. Six
Great Lakes stations were written off this way before the case was spotted:

```bash
for s in KWNW3 MNMM4 SYWW3; do printf "%s " $s; curl -s -o /dev/null -w "%{http_code}\n" \
  "https://www.ndbc.noaa.gov/data/realtime2/$s.txt"; done
```

(`lib/ndbc.ts` upper-cases the id, so the config itself is case-insensitive — this only
bites during research.) There is no alternate endpoint to try: `latest_obs/`, `5day2/`
and `.spec` are not populated for these stations, so an uppercase 404 is a real gap.

⚠️ **Validate a station against a neighbour over ~24 h before trusting it — proximity
is not accuracy.** A sheltered station reads LOW, which makes conditions look safer than
they are. Measured ratios (station ÷ offshore buoy, 24 h means):

| Station | Ratio | Verdict |
|---|---|---|
| `KWNW3` Kewaunee (pier tide-gauge) | **0.51** | rejected — half the true wind |
| `MNMM4` Menominee (same class!) | 0.97 | fine, in use |
| `SVNM4` South Haven (C-MAN light) | 1.09 | fine — an earlier spot-check wrongly condemned it |

So this is **site-specific, not station-class**, and a single instantaneous sample
misleads in *both* directions. Compare the 24 h means before wiring a station:

```bash
curl -s "https://www.ndbc.noaa.gov/data/realtime2/KWNW3.txt" | awk 'NR>2 && $7!="MM"{s+=$7;n++} END{print "mean m/s:",s/n," n:",n}'
```

The same trap applies to any land/shore sensor: GLOS's Chicago park "tower" platforms
sit 0.2–4 km from the harbors and read ~12 kt below the offshore buoys.

⚠️ **Verify the station's actual coordinates, not its name.** A station's label can be
misleading — `45170` is the "Michigan City Buoy" ~78 km from South Haven, so it's a poor
wind source there despite being easy to find. Confirm the lat/lon and pick the genuinely
nearest offshore buoy:

```bash
curl -s "https://www.ndbc.noaa.gov/data/stations/station_table.txt" | grep -Ei '^(45026|45029|45161)\b'
```

## Step 3 — set the fetch orientation (`openWaterBearing`) ⚠️ the important one

The exposure model has a base fetch *shape* calibrated for **Chicago's west shore**
(westerlies = offshore/calm; the long fetch is from the NE/E). For a harbor on a
different shore, set `openWaterBearing` to the compass bearing toward **open water /
the longest fetch**, and the shape is rotated to match:

- West shore (Chicago): leave `openWaterBearing` **unset**.
- East shore (e.g. St. Joseph): open water is to the **W/NW** → `openWaterBearing ≈ 290`.
- South-east corner (e.g. New Buffalo): longest fetch is **up-lake to the N/NW** → `≈ 330`.

Getting this wrong flips the ratings (a wind would read offshore/calm when it's
actually the big onshore wave-maker), so it's the field to double-check.

## Step 4 — radar / discussion office / webcam

- `discussionOffice` = the `office` from step 1 (verify an AFD exists:
  `api.weather.gov/products/types/AFD/locations/<OFFICE>`).
- `radarStation` = nearest NWS RIDGE radar covering the shoreline; confirm the loop:
  `curl -sI https://radar.weather.gov/ridge/standard/<KXXX>_loop.gif`.
- `webcamUrl` = a nearby GLERL cam (`glerl.noaa.gov/metdata/<site>/<site>01.jpg`) or
  `""` to hide the panel.

## Step 5 — add the config, seed the rest, test

Add the object to `HARBORS`, and add its `id` to `REGION_MEMBERS` (its group in the
board's region filter — `lib/harbors.test.ts` fails if a harbor has no region). Seed
`exposureScale`, `entranceBearing`, `exposed/shelteredDirs`, and `notes` from the chart
+ local knowledge (all tunable later — they're a living dataset). Then:

```bash
npx tsc --noEmit && npm test          # add/extend a fetch-orientation test in lib/harbors.test.ts
npm run dev                           # open /harbor/<id>, check conditions + intelligence render
```

Nothing needs doing for the **thunderstorm outlook**: harbors are grouped into ~0.5°
storm cells automatically (`stormCellKey`), and each cell is queried once at the centroid
of its harbors, so a new harbor lands in the right cell (or opens its own) with no config.

## Step 6 — validate the station you chose

```bash
npm run validate:stations
```

Compares each harbor's configured wind source against the nearest live GLOS **moored
buoy** over 24 h and fails if anything reads below 0.7× — the direction that makes
conditions look safer than they are. It is asymmetric on purpose: reading high is merely
conservative (expected when the reference buoy is further offshore). It hits the network,
so it is opt-in and never runs in `npm test`.

It has already caught two shipped mistakes: `KWNW3` at Kewaunee (0.51×) and `CMTI2` at
the three south-side Chicago harbors (0.65× — a gauge inside sheltered Calumet Harbor).

## Optional — a GLOS wave source

Some harbors have no NDBC buoy that reports waves at all (45161 serves Grand Haven,
Muskegon and Whitehall with `WVHT=MM`). Where a Sofar Spotter sits nearby, set
`waveBuoy.glos` instead of `waveBuoy.station` and it supplies observed waves, period,
direction and water temperature into the same distance-weighted blend.

**Only ever use GLOS for waves/temp, never for wind.** Its closest platforms to our
harbors are often shore `tower`s: the Chicago park towers sit 0.2–4 km out and read
~12 kt below the offshore buoys. Filter to `platform_type == "moored_buoy"`.

`/obs` returns opaque `parameter_id`s with no names and no units, and the id→name map is
~3.4 MB, so resolve the ids **once** and store them in the harbor config:

```bash
# 1. find the platform (moored_buoy, has wind/waves) near your harbor
curl -s "https://seagull-api.glos.org/api/v1/obs-datasets.geojson" > /tmp/glos.json
# 2. see which parameter_ids that platform is currently serving
curl -s "https://seagull-api.glos.org/api/v1/obs?obsDatasetId=671&startDate=$(date -u +%F)"
# 3. resolve those ids to names (grep the big map)
curl -s "https://seagull-api.glos.org/api/v1/parameters" > /tmp/params.json
```

Units are **null** for every parameter; CF names imply SI and the values confirm it —
metres for wave height and **Kelvin** for water temperature. Pick the shallowest
`depth` for temperature. Spotters are **seasonal**: they go dark each winter, so the
blend must (and does) fall back to the gridpoint model.

## Known limitations to generalize when scaling further

- **Wind-history graph** uses only the harbor's own buoy; a good fallback would be
  the harbor's gridpoint wind (model) rather than any cross-region buoy.
- **Exposure numbers are seed values** — the whole point is to refine them with real
  local sailor input over time.
- **Marine advisories** come from the harbor's own `marineZone`, but the sail-window
  wave estimate still leans on `estimateWaveFt()` where the gridpoint has no wave data.
