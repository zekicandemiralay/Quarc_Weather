# Tests

Thirteen suites. Twelve run against a **real** stack — real `quarc-auth`, real
backend, real Open-Meteo, real GitHub Releases API — because the interesting
failures live in the seams between them, not inside any one module. None use
mocks, except live GPS (Puppeteer mocks at the browser level — no honest way to
fake being in a real place) and `window.Capacitor` (there's no real Android
WebView here, so the update-banner suite injects a fake native bridge and lets
it hit the real GitHub API from there). The twelfth, `unit.test.js`, is pure
logic with no network at all, and is the fastest way to know whether a change to
the alerts or the hourly strip is sound.

Where a suite *injects* data into a real response (the alerts card, the sunrise
placement, the sky moods) it's because real weather is whatever it is today —
the injected value is the only way to prove a rare case renders correctly.

CI (`.github/workflows/tests.yml`) runs them on every push and pull request:
`unit`, `android` (Gradle build + widget unit tests), `api` (api + location-api +
widget-api) and `browser` (ui, timezone, location-ui, weather-screen, widget-settings,
weather-effects, daily-briefing). `radar` and
`update-banner` also run there but only *report* — they depend on third-party
tile servers and the rate-limited GitHub API, which can be down without the code
being wrong.

| Suite | What it covers |
|---|---|
| `unit.test.js` | 27 checks, no server/network/browser — the forecast-based alerts (merging into windows, the 2-hour gap rule, 48-hour horizon, "now" in the *city's* timezone, wind/rain/temperature/visibility thresholds in every unit Open-Meteo can send, severity ordering), the hourly strip's sunrise/sunset placement (including tomorrow's sunrise after sunset — the original bug), alert time-window wording, and visibility formatting (km vs miles) |
| `widget-settings.test.js` | 11 checks — the Settings → Home screen widget section, with a fake Android bridge injected before the app loads (the fake state lives in `localStorage` because the init script re-runs on every navigation): absent on the plain web app; with no widget placed it offers only "Add" and says why; "Add" calls `requestPin` once, and a launcher that can't pin gets manual instructions; with widgets placed "Customize" appears, calls `openSettings` once and never tries to add one, and "Add" becomes "Add another"; a widget added while the page is open shows "Customize" on return without leaving; Turkish strings; no console errors or failed requests (the Quarc Store update-gate call is excluded — not part of this stack) |
| `weather-screen.test.js` | 17 checks — the city screen's data flow in a real browser: opening a city is exactly one `/api/weather` request and no city-list lookup; the heads-up card (wording, severity order, Turkish, absent when empty, hidden for offline copies); a sunrise outside "today's" slot still lands in the strip; pull-to-refresh requests a forced refresh only from the top and only for a long enough pull; a cold open with no network renders the whole screen from the cache; miles vs km follows the unit the API actually sent; the moon mirrors in the southern hemisphere |
| `api.test.js` | 35 checks — auth gate, per-user isolation, city CRUD, prefs validation, forecast shape, `?city=` resolution (404 for unknown and for another user's city), `fetched_at`, the `refresh=1` rate limit, unit switching, caching |
| `ui.test.js` | 18 checks — the built frontend in headless Chrome: login, add city, forecast render, settings, i18n, plus console/exception capture |
| `location-api.test.js` | 6 checks — the current-location pin is upserted in place rather than duplicated on every move, is always sorted first, and collapses cleanly if it ends up exactly where a saved city already is |
| `location-ui.test.js` | 10 checks — the app's landing priority end to end: granted location wins, denied location falls back to the last-opened city, nothing available falls back to the empty list; the in-app back button never re-triggers the redirect, a genuine reload always does |
| `update-banner.test.js` | 7 checks — the startup "a new version is available" banner (matches Quarc Music): appears automatically after login with no Settings visit, shows on every screen including the `h-screen` weather detail page, dismiss persists across navigation, the manual Settings check still works independently |
| `widget-api.test.js` | 6 checks — the exact HTTP shape the native Android widget's `HttpURLConnection` call sends (a bare `Cookie: token=X` header, no browser fetch semantics), confirmed to authenticate correctly and return 401 (not a crash) for a missing/garbage token; every JSON field `WeatherWidgetWorker.java` parses is confirmed present in a real response, including the `next_hours` array behind the widget's hourly strip; a dedicated Istanbul check proves `next_hours[0]` lands on the city's real current hour, not a server-timezone-shifted one |
| `timezone.test.js` | 4 checks — the app is viewed with the browser's timezone emulated to `America/New_York` while showing Istanbul (a ~7-9h gap that can't coincidentally cancel out), proving the hourly strip's "Now" cell, the following hour, and sunrise are all genuinely computed in the *city's* timezone rather than silently re-interpreted in the viewer's |
| `weather-effects.test.js` | 10 checks — the animated background particle layer (WeatherEffects.jsx). Intercepts the real `/api/weather` response and substitutes a synthetic `weather_code`/`is_day`/`temperature_2m` for each of the 8 sky moods in turn (real weather right now is whatever it is), asserting the right particles render and no others; also confirms `prefers-reduced-motion` clamps every particle's animation to ~0 |
| `radar.test.js` | 5 checks — the precipitation radar card (RadarMap.jsx) against the real RainViewer + Esri tile services, no mocks: collapsed by default with zero map/tile requests until tapped, expanding actually mounts Leaflet and loads real basemap tiles (all 200), radar frames load and the play/pause control works, collapsing and re-expanding tears down and remounts without leaking errors |
| `daily-briefing.test.js` | 7 checks — the Settings UI for the daily briefing notification: the time picker starts disabled while off, enabling it both enables the picker and persists to the server, changing the time persists the new hour/minute, a reload shows the persisted state, disabling it again persists, and no console errors from calling into the native bridge on a platform that doesn't have it (web has no `window.Capacitor`, so it must no-op cleanly). The native side (NotificationBridgePlugin, DailyBriefingWorker) has no WebView here to test against — verified the same way the widget is, see below |

**The native Android code has no emulator or device test** (none exists in the
dev environment), so it is verified in layers instead:

1. **The decision logic is plain Java with no `android.*` types**
   (`WidgetSettings`, `WidgetLayoutSpec`, `WidgetPalette`) and is unit-tested on the
   JVM by `WidgetLogicTest` (23 checks): which layout a given size gets, how many hour
   columns fit, text size bounds, sky mood per weather code (mirrors the web app),
   text colour per background, opacity → alpha, and the settings rules.
2. **Gradle compiles it and links every resource** — Java, all layouts, the generated
   sky drawables, both languages' strings, the manifest. CI's `android` job runs
   `:app:testDebugUnitTest :app:assembleDebug` on every push, so a broken layout or
   manifest fails there rather than on a release tag. Locally (Windows, Android Studio's
   JDK 21 needs a newer Gradle than the wrapper's 8.2.1 — use a cached 8.5):
   `gradle --offline :app:testDebugUnitTest :app:assembleDebug` from `mobile/android`.
3. **`:app:lintRelease`** catches the rest (translations, locale bugs, RemoteViews-unsafe
   attributes). It has two long-standing errors outside the widget (`DailyBriefingWorker`
   notification permission, `UpdaterPlugin` receiver flag); the release gate
   (`lintVitalRelease`) passes.
4. **What can't be checked without a device:** how the widget actually *looks* on a
   launcher, and the native settings screen's touch behaviour. `widget-api.test.js`,
   `daily-briefing.test.js` and `widget-settings.test.js` cover the server contract and the
   web half (the Settings section and the exact native calls it makes).

Requires Node 20+ (tested on 24). An internet connection is required — the
forecast assertions hit Open-Meteo for real.

---

## Running them

### 0. Unit tests (no setup)

```bash
node --test tests/unit.test.js
```

Needs only Node 20+. Everything below needs the full stack.

### 1. Start the shared auth service

`quarc-auth` lives in the Quarc_Store repo. From there:

```bash
cd ../Quarc_Store/auth
npm install
JWT_SECRET=testsecret PORT=3902 SECURE_COOKIE=false \
  ADMIN_USERNAME=zeki ADMIN_PASSWORD=testpass123 \
  DB_PATH=./data/auth.db node src/index.js
```

`SECURE_COOKIE=false` matters: the cookie is `Secure; SameSite=None` otherwise,
and plain-HTTP localhost will silently drop it.

### 2. Start this backend

```bash
cd backend
npm install
JWT_SECRET=testsecret PORT=3904 DB_PATH=./data/weather.db node src/index.js
```

### 3. API suite

```bash
cd tests
JWT_SECRET=testsecret node api.test.js
```

It mints its own JWT with that secret, standing in for what `quarc-auth` issues,
so it exercises the backend without needing a browser.

### 4. UI suite

Build and serve the frontend — `vite preview` reuses the same `/api/auth` → 3902
and `/api` → 3904 proxy split that nginx does in production:

```bash
cd frontend
npm install
npm run build
node node_modules/vite/bin/vite.js preview --port 4173 --host 127.0.0.1
```

Then, in another shell:

```bash
cd tests
npm install puppeteer
node ui.test.js
```

Screenshots land in `tests/shots/` — useful for eyeballing the sky gradients and
the night icons, which no assertion can meaningfully check.

### 5. Timezone suite

Same running frontend as the UI suite (port 4173) — no extra setup:

```bash
cd tests
node timezone.test.js
```

Screenshots land in `tests/shots-timezone/`.

### 6. Weather effects suite

Same running frontend as the UI suite — no extra setup:

```bash
cd tests
node weather-effects.test.js
```

Screenshots land in `tests/shots-effects/`, one per sky mood — useful for
actually looking at how the rain/snow/stars/fog/clouds/sun-glow/lightning
read against each gradient.

### 7. Radar suite

Same running frontend — no extra setup:

```bash
cd tests
node radar.test.js
```

Screenshots land in `tests/shots-radar/`.

### 8. Widget settings suite

Same running frontend — no extra setup:

```bash
cd tests
node widget-settings.test.js
```

Screenshots land in `tests/shots-widget-settings/`.

### 9. City screen suite

Same running frontend — no extra setup:

```bash
cd tests
node weather-screen.test.js
```

Screenshots land in `tests/shots-screen/` (the heads-up card in English and
Turkish, the hourly strip with a sunrise marker). All `tests/shots*/` folders are
git-ignored.

---

## Notes

- **Every UI suite resets its own state on entry** — cities, units, and
  language — so a previous run leaving the account in Turkish with cities
  saved won't cascade into false failures regardless of run order.
  `timezone.test.js` resets language/units itself too, specifically because
  its assertions match English strings ("Now", "HOURLY", "SUNRISE") and
  `ui.test.js`'s own Settings check deliberately leaves the account in
  Turkish when it finishes.
- **`api.test.js` is destructive** to the test user's city list. Point
  `DB_PATH` at a scratch database, never at production data.
- On Windows, `npm` may skip native postinstall steps with an `allow-scripts`
  warning. If `better-sqlite3` or Puppeteer's Chromium is missing, run the
  install script directly, e.g. `node node_modules/puppeteer/install.mjs`.
- The `daily[1] is today` check compares against the date **in the city's
  timezone**, not the machine's. Those differ for much of the day in Istanbul,
  and asserting on local machine time would fail nightly.
