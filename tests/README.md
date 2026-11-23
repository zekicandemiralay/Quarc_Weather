# Tests

The app is **offline-first**: every device keeps its cities and settings in a database of its own, fetches
weather, city search and place names straight from the providers (Open-Meteo, OpenStreetMap), and syncs with
the Quarc server in the background. The server only holds accounts' cities and settings and merges them. The
tests are built around that:

* **Unit suites** (no network, no browser) cover the logic — alerts, the weather-provider client, the local
  database, the sync engine against the *real* server code with several simulated devices, the one-time
  migration of the old server database, the widget's hand-over, the service worker.
* **The sync API suite** talks HTTP to the real backend.
* **Browser suites** drive the *built* frontend in headless Chrome against the real stack — real `quarc-auth`,
  real backend, real Open-Meteo — because the interesting failures live in the seams between them. None use
  mocks, except live GPS (Puppeteer mocks at the browser level — no honest way to fake being in a real place)
  and `window.Capacitor` (there is no real Android WebView here, so the widget/update suites inject a fake
  native bridge).
* **Android** has JVM tests for everything that is plain Java, and Gradle compiles the rest.

"Offline" in these tests means **the Quarc server is unreachable but the internet is not** — what Tailscale being
off looks like. `tests/helpers/app.js` simulates exactly that (it fails every `/api/*` request on the app's own
origin while the weather providers keep answering), and it can also take the *weather provider* away, or alter
the real forecast on its way in.

Where a suite *injects* data into a real response (the alerts card, the sunrise placement, the sky moods) it's
because real weather is whatever it is today — the injected value is the only way to prove a rare case renders
correctly. The test fetches the real forecast itself, changes one thing, and hands it to the page, so the screen
still renders genuine data.

CI's browser suites call the live Open-Meteo API from a runner whose IP is shared with many other projects (its
free tier is rate-limited per IP, and one CI run did fail with "Forecast unavailable" while the app code was
unchanged). So a failed browser suite is retried once after a 30 s pause: passing only on the retry is reported
as a warning annotation (visible, never silent), and failing twice is a real failure.

CI (`.github/workflows/tests.yml`) runs on every push to `main` (and to the `offline-sync` branch) and on pull
requests:

* `unit` — `unit`, `unit-provider`, `unit-widget`, `unit-sw`, `local-services`, `migration`, `sync-sim`
* `android` — Gradle build + the JVM widget tests
* `api` — `sync-api`
* `browser` — `ui`, `timezone`, `weather-screen`, `widget-settings`, `weather-effects`, `daily-briefing`,
  `offline-sync-ui`. `radar`, `update-banner` and `location-ui` also run there but only *report*: `radar` and
  `update-banner` depend on third parties (the tile servers, the rate-limited GitHub API) that can misbehave
  without the code being wrong; `location-ui` uses live geocoding and timing and fails at its "save Berlin" step
  on the CI runner for a reason that is still being narrowed down (its failure message includes the geocode
  status codes and the page text). Run all of them locally before a release.

## Unit suites (`node --test`)

| Suite | Checks | What it covers |
|---|---|---|
| `unit.test.js` | 27 | The forecast-based alerts (merging into windows, the 2-hour gap rule, 48-hour horizon, "now" in the *city's* timezone, wind/rain/temperature/visibility thresholds in every unit Open-Meteo can send, severity ordering), the hourly strip's sunrise/sunset placement (including tomorrow's sunrise after sunset — the original bug), alert time-window wording, visibility formatting (km vs miles). Runs the frontend's own modules (`frontend/src/lib/forecast/*`) |
| `unit-provider.test.js` | 8 | The direct weather-provider client with a fake `fetch`: the forecast request carries the user's units and no custom headers (a custom header would force a CORS pre-flight), a "bundle" has everything the screens read (forecast, air quality, moon, alerts, freshness), a storm becomes an alert, missing air quality never fails the forecast but a failed forecast does, city search ignores 1-character input, reverse geocoding prefers the neighbourhood and returns null when it can't name a place. And that the **server and the app derive the same city id from the same coordinates** (a sweep of the globe plus rounding boundaries) |
| `local-services.test.js` | 17 | The forecast cache (fresh for 10 minutes, a forced refresh at most every 30 s, stale copy when the provider is down, unit changes invalidate it) and the per-device **My Location** record (name lookup only on first use / after moving more than 3 km / on a language change; offline after a long move shows coordinates, never a wrong name), against an in-memory IndexedDB with fake providers and a fake clock |
| `sync-sim.test.js` | 18 | Several simulated devices — each with its own local database, clock and connection — syncing through the **real server code** on a real SQLite database: whatever the devices did while out of touch, once they can talk they all end up identical. Targeted scenarios (offline edits, deletes vs edits, the same city added on two devices, a device with a clock minutes ahead, an account switch wiping the old data) plus a randomised run over 25 fixed seeds (a failure prints its seed). **Server restored from an older backup / rebuilt empty:** the data goes back in time and the epoch is renewed (what `restore.sh` does) — the devices re-send what they hold, nothing they added, removed or changed is lost, a deletion made before the restore is not resurrected, and a brand-new device then gets the true current state from the repaired server (these three fail without the epoch logic) |
| `migration.test.js` | 7 | The one-time conversion of the **old** server database (uuid city ids, a "My Location" pin per user, settings in `prefs`) to the synced schema, tested against a faithfully rebuilt legacy database: cities keep their data but get coordinate-derived ids, the pin is dropped, every migrated row is immediately visible to a first sync, account settings carry over while per-device ones (theme, briefing) are not copied, a full copy of the old database is written first, running it twice changes nothing and writes no second backup, and a brand-new database just gets the schema |
| `unit-widget.test.js` | 12 | What the app hands the home-screen widget: My Location first, rounded to ~100 m so GPS wobble is not a new list every time, usable coordinates only, the unit; a burst of edits collapses into one hand-over and an unchanged list is never sent twice; stopping cancels a pending hand-over |
| `unit-sw.test.js` | 7 | The service worker against a fake worker environment: when a new version replaces an older one the open page is reloaded **once** (otherwise the first launch after an update runs the previous version against a changed server), never on a normal start; forecasts, city search and API calls are never answered or cached by the worker |

## Sync API suite

| Suite | Checks | What it covers |
|---|---|---|
| `sync-api.test.js` | 26 | The server's whole API over HTTP with several "devices" taking turns: the auth gate (anonymous and wrongly-signed tokens refused) and the old per-server endpoints being gone; every pull carrying the server's epoch (stable, the same for every account); adding a city, a retried push (lost response) being harmless, invalid mutations refused individually without blocking valid ones; the same place on two devices being one city; stale edits answered with the server's row, tombstones, a newer edit beating an older delete and a re-add beating a delete; concurrent reorders of different cities both surviving, exact fractional sort orders; far-future timestamps capped; the pull cursor and paging (1,200 cities, no row skipped or repeated); settings merging per field, older values not overwriting newer ones, invalid values and unknown fields (theme, briefing) ignored; one account never seeing another's data |

Destructive to the test users' data — point `DB_PATH` at a scratch database.

## Browser suites

| Suite | Checks | What it covers |
|---|---|---|
| `offline-sync-ui.test.js` | 12 | The headline: two real browsers signed in as the same account. The phone opens on My Location with a forecast fetched straight from the provider; a city added while the server is unreachable saves locally and the badge says so; the app **cold-starts with the server unreachable** and shows the saved list with live forecasts; a city can still be opened with the server down; when the server returns the offline change reaches it and the badge clears; My Location never reaches the server; a second device downloads the list and has its own My Location (Berlin vs Istanbul); both devices edit while apart and merge (a delete on one and a reorder on the other both survive); units follow the account while the theme stays on each device |
| `ui.test.js` | 14 | Login, add city, forecast render, Settings (units, language), logging out and back in restores the list from the device; the forecast comes from the provider, never through the Quarc server; console/exception capture |
| `weather-screen.test.js` | 17 | The city screen: opening a city is exactly one forecast + one air-quality request to the provider and nothing to the Quarc server; a second open within 10 minutes is served from the device; the heads-up card (alerts are computed on the device — a storm, heavy rain and a gale injected into the real forecast come out correctly worded and in severity order, Turkish, absent when calm); a sunrise outside "today's" slot still lands in the strip; pull-to-refresh refetches only for a long pull from the top on an old forecast; with the provider unreachable the last good forecast is shown, flagged offline; miles vs km follows the unit the provider actually sent (feet when precipitation is in inches); the moon mirrors in the southern hemisphere |
| `location-ui.test.js` | 11 | The landing priority end to end: a granted location wins and shows a real place name, denied location falls back to the last-opened city, nothing available falls back to the list; the in-app back button never re-triggers the redirect, a reload always does; My Location never reaches the server; **with the server unreachable** the app still lands on My Location / the last city from local data |
| `timezone.test.js` | 4 | The browser's timezone is emulated to `America/New_York` while showing Istanbul (a ~7–9 h gap that can't coincidentally cancel out): the city card, the hourly strip's "Now" cell and the sunrise are all computed in the *city's* timezone |
| `weather-effects.test.js` | 10 | The animated background particle layer: the real forecast is altered to each of the 8 sky moods in turn, asserting the right particles render and no others; `prefers-reduced-motion` clamps every animation to ~0 |
| `radar.test.js` | 5 | The precipitation radar card against the real RainViewer + Esri tile services: collapsed by default with zero map/tile requests until tapped, expanding mounts Leaflet and loads real tiles, frames load and play/pause works, collapsing and re-expanding tears down and remounts without leaking errors |
| `daily-briefing.test.js` | 8 | The Settings UI for the daily briefing as a **per-device** setting: the time picker starts disabled, enabling/changing/disabling is remembered on the device and survives a reload, it **never reaches the account**, and a second device on the same account has its own separate setting. No console errors from the native bridge on a platform without it |
| `widget-settings.test.js` | 16 | Settings → Home screen widget, with a fake Android bridge injected before the app loads: absent on the plain web app; "Add" / "Customize" / "Add another" and the exact native calls they make; a launcher that can't pin gets manual instructions; Turkish strings. **And the hand-over to the widget:** saved cities (with coordinates and the unit) are sent, a unit change is sent, a burst of edits is not a burst of hand-overs, My Location arrives first/rounded/flagged, signing out clears it |
| `update-banner.test.js` | 7 | The startup "a new version is available" banner against the real GitHub Releases API: appears automatically after login, shows on every screen, dismiss persists, the Settings check works independently |

## Android (JVM tests, no emulator)

**The native Android code has no emulator or device test** (none exists in the dev environment), so it is verified
in layers instead:

1. **The decision logic is plain Java with no `android.*` types** and is unit-tested on the JVM (`mobile/android/app/src/test`):
   * `WidgetLogicTest` (28) — which layout a given size gets (including Minimal for a single cell), how many hour
     columns fit, text size bounds, sky mood per weather code (mirrors the web app), text colour per background,
     opacity → alpha, the settings rules.
   * `WidgetForecastTest` (15) — what the widget does with an Open-Meteo response, checked against a **real**
     Istanbul response (`src/test/resources/open-meteo-istanbul.json`): the strip starts at the *city's* current
     hour (taken from the response's own clock — never the phone's zone), runs past midnight, today's high/low,
     units, the request it builds (never a locale decimal comma), and that the result reads back through the
     existing `WidgetData` parser.
   * `WidgetCitiesTest` (6) — the list of places the app hands over: tolerant parsing, stable stored form.
2. **Gradle compiles it and links every resource** — Java, all layouts, the generated sky drawables, both languages'
   strings, the manifest. CI's `android` job runs `:app:testDebugUnitTest :app:assembleDebug` on every push.
   Locally (Windows, Android Studio's JDK 21 needs a newer Gradle than the wrapper's 8.2.1 — use a cached 8.5):
   `gradle --offline :app:testDebugUnitTest :app:assembleDebug` from `mobile/android`.
3. **`:app:lintRelease`** catches the rest (translations, locale bugs, RemoteViews-unsafe attributes). It has two
   long-standing errors outside the widget (`DailyBriefingWorker` notification permission, `UpdaterPlugin` receiver
   flag); the release gate (`lintVitalRelease`) passes.
4. **What can't be checked without a device:** how the widget actually *looks* on a launcher, the native settings
   screen's touch behaviour, and the widget's own refresh running in the background. `widget-settings.test.js` covers the web half
   (the exact native calls the app makes), `WidgetForecastTest` the data half.

## The Windows desktop app

The Windows installer bundles the frontend (see `desktop/BUILD.md`). It was verified once by hand in the real
build (WebView2, origin `http://tauri.localhost`) against a local server running with the production cookie
settings (`Secure; SameSite=None`): sign-in, city search and forecast straight from the providers, sync, a cold start
with the server stopped, adding a city while it was down, and the queued change reaching the server afterwards.
There is no automated test for it: it needs a compiled Tauri build and a desktop session.

Requires Node 20+ (tested on 24). An internet connection is required — the forecast assertions hit Open-Meteo for real.

---

## Running them

### 0. Unit suites (no setup beyond `npm install`)

```bash
npm install --prefix backend
npm install --prefix frontend
node --test tests/unit.test.js tests/unit-provider.test.js tests/unit-widget.test.js tests/unit-sw.test.js \
  tests/local-services.test.js tests/migration.test.js tests/sync-sim.test.js
```

Everything below needs the full stack.

### 1. Start the shared auth service

`quarc-auth` lives in the Quarc_Store repo. From there:

```bash
cd ../Quarc_Store/auth
npm install
JWT_SECRET=testsecret PORT=3902 SECURE_COOKIE=false \
  ADMIN_USERNAME=zeki ADMIN_PASSWORD=testpass123 \
  DB_PATH=./data/auth.db node src/index.js
```

`SECURE_COOKIE=false` matters: the cookie is `Secure; SameSite=None` otherwise, and plain-HTTP localhost may
silently drop it.

### 2. Start this backend

```bash
cd backend
npm install
JWT_SECRET=testsecret PORT=3904 DB_PATH=./data/weather.db node src/index.js
```

### 3. Sync API suite

```bash
JWT_SECRET=testsecret NODE_PATH=backend/node_modules node tests/sync-api.test.js
```

It mints its own JWT with that secret, standing in for what `quarc-auth` issues, so it exercises the backend
without needing a browser.

### 4. Browser suites

Build and serve the frontend — `vite preview` reuses the same `/api/auth` → 3902 and `/api` → 3904 proxy split
that nginx does in production. **Rebuild after every frontend change: `preview` serves the built files, not the source.**

```bash
cd frontend
npm install
npm run build
node node_modules/vite/bin/vite.js preview --port 4173 --host 127.0.0.1
```

Puppeteer is not a dependency of the repo; install it somewhere and point `NODE_PATH` at it (and at the backend's
`node_modules`, for the JWT library the helper uses):

```bash
npm install --prefix /tmp/pptr puppeteer
export NODE_PATH=/tmp/pptr/node_modules:$PWD/backend/node_modules JWT_SECRET=testsecret   # on Windows separate with ';'
cd tests
for s in ui weather-screen weather-effects radar timezone location-ui daily-briefing widget-settings update-banner offline-sync-ui; do
  node $s.test.js
done
```

Screenshots land in `tests/shots*/` (the sky gradients, the heads-up card in English and Turkish, one image per
sky mood for the effects) — useful for eyeballing what no assertion can meaningfully check. All `tests/shots*/`
folders are git-ignored.

---

## Notes

* **The test account is shared state.** Its language and units follow the account to every device that signs in,
  so a suite that ends in Turkish would poison the next. Suites that sign in through `helpers/app.js`
  (`freshSession`) reset the account and wait until the device has the reset; the ones that build their own browser
  context (to inject a fake native bridge) call `cleanAccount` first. Cleanup lives in `finally` blocks for the
  same reason.
* **City search is replayed, not asked live every time.** Nearly every suite starts by adding a city, and from a
  shared CI runner Open-Meteo's geocoder was seen to give no answer for a while — the first attempt of several suites
  timed out waiting for search results while the retry 30 s later passed. The suites aren't about search, so
  `helpers/app.js` answers a search with the **real** Open-Meteo response, fetched from the live geocoder once per distinct
  query (with up to 5 tries and backoff), kept for a day in `quarc-weather-test-geocode-cache.json` in the temp
  directory, and replayed. Delete that file to force fresh answers, or set `device.liveGeocoder = true` in a suite to
  ask the live service directly. `update-banner` builds its own page and still searches live (it is informational for
  that reason). CI's geocoder probe step records what the runner actually gets from it.
* **`sync-api.test.js` and the browser suites are destructive** to the test user's cities. Point `DB_PATH` at a
  scratch database, never at production data.
* **`vite preview` is not production's nginx for cross-origin requests.** It answers CORS pre-flights itself
  without `Allow-Credentials`. That is irrelevant to these suites (same origin) but matters if you ever point a
  *bundled* app (Android/Windows) at it — use a plain pass-through proxy instead.
* On Windows, `npm` may skip native postinstall steps with an `allow-scripts` warning. If `better-sqlite3` or
  Puppeteer's Chromium is missing, run the install script directly, e.g. `node node_modules/puppeteer/install.mjs`.
* The "today is the second daily entry / first daily entry" checks compare against the date **in the city's
  timezone**, not the machine's. Those differ for much of the day in Istanbul, and asserting on local machine time
  would fail nightly.
