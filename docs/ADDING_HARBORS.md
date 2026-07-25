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
| `buoyStation` | NDBC station for **live wind + temp** | nearest station with a `realtime2` feed (step 2) |
| `marineZone` | NWS nearshore zone (advisories, wave text) | from the point lookup (step 1) — e.g. `LMZ043` |
| `waveGrid` | NWS gridpoint `OFFICE/x,y` for **per-harbor waves + marine wind** | from the point lookup (step 1) — e.g. `IWX/19,82` |
| `openWaterBearing?` | bearing (°true) toward **open water / longest fetch** | **the key shore-aware field** (step 3). Unset ⇒ Chicago west-shore default |
| `entranceBearing` | heading you steer leaving the harbor | from the chart / satellite view |
| `exposureScale` | overall openness, 0 (tucked away) – 1 (wide open) | seed estimate, refine with local input |
| `exposedDirs?` / `shelteredDirs?` | dirs the breakwater funnels (×1.4) / blocks (×0.4) | seed estimate |
| `discussionOffice?` | NWS office for the Area Forecast Discussion | from the point lookup `office` (default `LOT`) |
| `radarStation?` | NWS RIDGE radar, e.g. `KGRR` | nearest radar covering the shoreline (default `KLOT`) |
| `webcamUrl?` | lakefront webcam image URL | a GLERL cam if one exists nearby; `""` hides the panel |
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

Add the object to `HARBORS`. Seed `exposureScale`, `entranceBearing`,
`exposed/shelteredDirs`, and `notes` from the chart + local knowledge (all tunable
later — they're a living dataset). Then:

```bash
npx tsc --noEmit && npm test          # add/extend a fetch-orientation test in lib/harbors.test.ts
npm run dev                           # open /harbor/<id>, check conditions + intelligence render
```

## Known limitations to generalize when scaling further

- **Wind-history graph** uses only the harbor's own buoy; a good fallback would be
  the harbor's gridpoint wind (model) rather than any cross-region buoy.
- **Exposure numbers are seed values** — the whole point is to refine them with real
  local sailor input over time.
- The **storm outlook** is one Chicago-metro HRRR point; for far-flung harbors it
  should query a point near each region.
