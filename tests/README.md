# Tests

Seven suites. All run against a **real** stack — real `quarc-auth`, real backend,
real Open-Meteo, real GitHub Releases API — because the interesting failures
live in the seams between them, not inside any one module. None use mocks,
except live GPS (Puppeteer mocks at the browser level — no honest way to fake
being in a real place) and `window.Capacitor` (there's no real Android WebView
here, so the update-banner suite injects a fake native bridge and lets it hit
the real GitHub API from there).

| Suite | What it covers |
|---|---|
| `api.test.js` | 28 checks — auth gate, per-user isolation, city CRUD, prefs validation, forecast shape, unit switching, caching |
| `ui.test.js` | 18 checks — the built frontend in headless Chrome: login, add city, forecast render, settings, i18n, plus console/exception capture |
| `location-api.test.js` | 6 checks — the current-location pin is upserted in place rather than duplicated on every move, is always sorted first, and collapses cleanly if it ends up exactly where a saved city already is |
| `location-ui.test.js` | 10 checks — the app's landing priority end to end: granted location wins, denied location falls back to the last-opened city, nothing available falls back to the empty list; the in-app back button never re-triggers the redirect, a genuine reload always does |
| `update-banner.test.js` | 7 checks — the startup "a new version is available" banner (matches Quarc Music): appears automatically after login with no Settings visit, shows on every screen including the `h-screen` weather detail page, dismiss persists across navigation, the manual Settings check still works independently |
| `widget-api.test.js` | 6 checks — the exact HTTP shape the native Android widget's `HttpURLConnection` call sends (a bare `Cookie: token=X` header, no browser fetch semantics), confirmed to authenticate correctly and return 401 (not a crash) for a missing/garbage token; every JSON field `WeatherWidgetWorker.java` parses is confirmed present in a real response, including the `next_hours` array behind the widget's hourly strip; a dedicated Istanbul check proves `next_hours[0]` lands on the city's real current hour, not a server-timezone-shifted one |
| `timezone.test.js` | 4 checks — the app is viewed with the browser's timezone emulated to `America/New_York` while showing Istanbul (a ~7-9h gap that can't coincidentally cancel out), proving the hourly strip's "Now" cell, the following hour, and sunrise are all genuinely computed in the *city's* timezone rather than silently re-interpreted in the viewer's |

**The native widget code itself (`mobile/android/.../Weather Widget*.java`,
`WidgetBridgePlugin.java`) has no local test** — there's no Android emulator in
this environment, so it's verified by: (1) careful manual review, (2) every
`R.id`/`R.layout`/`R.string` reference cross-checked against the actual XML
declarations (a mismatch there is a real compile error a review can miss), and
(3) the CI `build-android` job's Gradle compile as the authoritative check.
`widget-api.test.js` above is what *can* be verified locally — the server-side
contract the native code depends on.

Requires Node 20+ (tested on 24). An internet connection is required — the
forecast assertions hit Open-Meteo for real.

---

## Running them

### 1. Start the shared auth service

`quarc-auth` lives in the Quarc_Notes repo. From there:

```bash
cd ../Quarc_Notes/auth
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
