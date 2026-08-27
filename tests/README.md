# Tests

Two suites. Both run against a **real** stack — real `quarc-auth`, real backend,
real Open-Meteo — because the interesting failures live in the seams between
them, not inside any one module. Neither uses mocks.

| Suite | What it covers |
|---|---|
| `api.test.js` | 28 checks — auth gate, per-user isolation, city CRUD, prefs validation, forecast shape, unit switching, caching |
| `ui.test.js` | 18 checks — the built frontend in headless Chrome: login, add city, forecast render, settings, i18n, plus console/exception capture |

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

---

## Notes

- **Both suites reset their own state.** `ui.test.js` deletes every saved city
  and restores default preferences after logging in, so a previous run leaving
  the UI in Turkish with cities saved won't cascade into false failures.
- **`api.test.js` is destructive** to the test user's city list. Point
  `DB_PATH` at a scratch database, never at production data.
- On Windows, `npm` may skip native postinstall steps with an `allow-scripts`
  warning. If `better-sqlite3` or Puppeteer's Chromium is missing, run the
  install script directly, e.g. `node node_modules/puppeteer/install.mjs`.
- The `daily[1] is today` check compares against the date **in the city's
  timezone**, not the machine's. Those differ for much of the day in Istanbul,
  and asserting on local machine time would fail nightly.
