# Quarc Weather

A self-hosted weather app for your Quarc account. Saved city lists follow your
login across every device — the same account as Quarc Music and Quarc Notes.

**Features:**
- Apple-Weather-style city screens — full-bleed sky gradient that shifts with the
  conditions and time of day, from clear-blue afternoon to overcast night
- Animated weather backgrounds — falling rain/snow, twinkling stars, drifting fog
  and clouds, a soft sun glow, occasional lightning in storms; respects your
  system's reduced-motion setting
- Precipitation radar — a collapsible map (real animated radar frames, play/pause,
  scrubbable) centered on the city, free and keyless (RainViewer + Esri)
- Per-user city list, saved server-side so it's there on every device you log in from
- Heads-up card for the next 48 hours — thunderstorms, torrential rain, gales, ice,
  extreme heat/cold, extreme UV and dense fog, merged into time windows and marked
  advisory or warning. These are worked out from the forecast itself (Open-Meteo has no
  official warnings), so the card says "not official" and is hidden on offline copies
- 24-hour hourly strip with every sunrise/sunset in the window marked inline — after
  sunset that includes tomorrow's sunrise
- Pull down to refresh, and "Updated 3 min ago" on every forecast
- 10-day forecast with temperature range bars scaled across the whole period
- Detail tiles: UV index, wind and gusts, sunrise/sunset, feels-like, precipitation,
  visibility, pressure, daylight length, moon phase, and air quality with PM2.5/PM10/O₃
- Air quality on the European AQI scale, with pollen data available from the same source
- Metric/imperial, four wind units, mm/inch — all per-user, all synced to your account
- English and Turkish
- Offline support — the last successful forecast for each city is cached locally and
  shown with an "as of" timestamp when the network is gone, even on a cold start with
  no signal at all
- Android APK with in-app updates — download from [Releases](https://github.com/zekicandemiralay/Quarc_Weather/releases/latest)
- Android home-screen widget — refreshes itself in the background every ~45 min via
  a native WorkManager job, independent of the app being open; offered automatically
  the first time the app shows real weather, via Android's requestPinAppWidget prompt
  - **Resizes down to 2×1** and adapts to its size: a single row (icon, temperature,
    city/condition and a few hours if there's width), a compact two-line card, or the
    full card with the hourly strip. Layout can be left on Auto or pinned
  - **Your own look, per widget**: Sky (the app's gradient for the current weather),
    Dark, Light, Glass, any of 8 colours, or **Transparent** (straight onto the
    wallpaper, with a soft text shadow), plus an opacity slider, text colour
    (auto/light/dark) and which saved city it follows
  - The settings screen opens when you add the widget, from the widget's "reconfigure"
    action (Android 12+), and from **Settings → Home screen widget** in the app; its
    preview is drawn by the same code as the widget itself
- Android daily briefing notification — an optional "good morning" summary (temperature,
  condition, hi/lo, and a heads-up if rain's coming) at a time you pick in Settings,
  delivered independently of the app being open
- Desktop app — native installers for Windows, macOS, and Linux built with Tauri
- PWA — add to your home screen on iOS/Android

**Weather data:** [Open-Meteo](https://open-meteo.com) — free, no API key, no
account, no quota to manage. Nothing to configure.

---

## Part 1 — Server Setup

For the person who owns and runs the server.

### Requirements

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- A machine that stays on, running [Tailscale](https://tailscale.com)
- Tailscale HTTPS Certificates enabled in the admin console
- The shared `quarc-auth` service already running (it lives in the Quarc_Store repo
  under `auth/` — see that README). Every Quarc app depends on it for login.

---

### Step 1 — Clone the repository

```bash
git clone https://github.com/zekicandemiralay/Quarc_Weather.git
cd Quarc_Weather
```

---

### Step 2 — Configure your environment

```bash
cp .env.example .env
```

Open `.env` and set `JWT_SECRET` to **exactly the same value** already used by
`quarc-auth`, Quarc Music, and Quarc Notes. That shared secret is the whole
mechanism behind one-account-everywhere: this app never sees a password, it just
verifies the token `quarc-auth` issued.

Get the current value from the running auth container:

```bash
docker exec quarc-auth printenv JWT_SECRET
```

---

### Step 3 — Make sure the shared network exists

```bash
docker network create quarcnet-shared   # once per server; harmless if it already exists
```

Without it the frontend container can't resolve `quarc-auth` and every login fails.

---

### Step 4 — Start the server

```bash
bash deploy.sh
```

---

### Step 5 — Access the app

```
https://quarcnet0.tail84500c.ts.net:4002
```

Log in with your existing Quarc account. There's no separate registration and no
admin setup — if you can log into Quarc Music, you can log in here.

---

### Step 6 — Verify

```bash
bash check.sh
```

This checks containers, the shared network, that your `JWT_SECRET` actually
matches `quarc-auth`'s, the TLS certificate, the database, every API endpoint,
and live reachability to Open-Meteo.

---

### Updating

```bash
git pull
bash deploy.sh
```

The database is stored in a Docker volume and survives rebuilds.

---

### Backup and restore

```bash
bash backup.sh                      # creates ./backup_YYYYMMDD_HHMMSS/
bash restore.sh ./backup_2026...    # on the new server
```

Only city lists and preferences are backed up — forecasts are re-fetched from
Open-Meteo on demand, so there's nothing else worth preserving.

---

### Ports

| App | Frontend | Backend |
|---|---|---|
| Quarc Music | 4000 | 3001 |
| quarc-auth | — | 3002 |
| Quarc Notes | 4001 | 3003 |
| **Quarc Weather** | **4002** | **3004** |

---

### Configuration reference

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | *(insecure default)* | Must match `quarc-auth` exactly — this is what makes the shared login work |

That's the entire configuration. Open-Meteo needs no key, so there is nothing
else to set.

---

## Part 2 — User Setup

See **[README_Users.md](README_Users.md)**.

**Short version:** Users need Tailscale installed and connected, then either open
`https://quarcnet0.tail84500c.ts.net:4002` in a browser, install the Android APK,
or install the desktop app. They log in with the same account they already use
for Quarc Music.

---

## Tests

Every push and pull request runs the **Tests** workflow (`.github/workflows/tests.yml`):
pure-logic unit tests, the API suites against the real backend and Open-Meteo, and the
browser suites in headless Chrome. See **[tests/README.md](tests/README.md)** for what each
suite covers and how to run them locally. To let CI check out `Quarc_Store` (for the
shared login service) when that repository is private, add a read-only token as the
repository secret `QUARC_STORE_TOKEN`.

---

## Releasing new app builds

Tag a version and push it — the workflow builds and publishes everything:

```bash
git tag v1.0.1
git push origin v1.0.1
```

`.github/workflows/desktop-release.yml` builds the Windows/macOS/Linux installers
and the signed Android APK, then publishes them to a GitHub Release. The apps
check that release for updates and install in place.

Required repository secrets: `KEYSTORE_BASE64` and `KEYSTORE_PASSWORD` for APK
signing. Reuse the same keystore approach as Quarc Music and Quarc Notes — but
note the key alias here is `quarc-weather`.
