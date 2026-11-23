# Quarc Weather

A self-hosted weather app for your Quarc account. Saved city lists follow your
login across every device — the same account as Quarc Music and Quarc Notes.

**Works without Tailscale.** Every device keeps its own copy of your cities and settings
and gets the weather, city search and place names **straight from the weather providers**
— the server is only used to sign in and to sync. So on Android and Windows the app (and
the Android widget) keeps working whenever the phone or PC has normal internet, with
Tailscale off; changes made in the meantime wait in a queue and merge into your account,
and into your other devices, the next time Tailscale is on. (macOS and Linux open the
server's web app, so they need Tailscale to load it.)

**Features:**
- Apple-Weather-style city screens — full-bleed sky gradient that shifts with the
  conditions and time of day, from clear-blue afternoon to overcast night
- Animated weather backgrounds — falling rain/snow, twinkling stars, drifting fog
  and clouds, a soft sun glow, occasional lightning in storms; respects your
  system's reduced-motion setting
- Precipitation radar — a collapsible map (real animated radar frames, play/pause,
  scrubbable) centered on the city, free and keyless (RainViewer + Esri)
- Per-user city list that **merges across devices**: add a city on your phone and one on
  your laptop while neither can reach the server, and you end up with both everywhere;
  the same place added twice is one city; a deletion on one device reaches the others
- **My Location** is per device — your phone's position is never sent to the server or
  shown on your other devices
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
- Metric/imperial, four wind units, mm/inch and the language follow your account to every
  device (merged setting by setting, so changing units on one and the language on another
  keeps both). The theme and the daily briefing are per device
- English and Turkish
- Offline support — the app opens from the device's own data even with no connection at all,
  and the last successful forecast for each city is cached locally and shown with an "as of"
  timestamp when the weather provider can't be reached, even on a cold start. A small badge
  says how many changes are waiting to sync
- Android APK with in-app updates — download from [Releases](https://github.com/zekicandemiralay/Quarc_Weather/releases/latest)
- Android home-screen widget — refreshes itself in the background every ~45 min via
  a native WorkManager job, independent of the app being open, fetching the weather
  itself (so it works with Tailscale off); offered automatically the first time the app
  shows real weather, via Android's requestPinAppWidget prompt
  - **Shrinks to a single cell** (starts as a 2×1) and adapts to its size: *Minimal*
    (just the icon over the temperature), a single row (icon, temperature, city/condition
    and a few hours if there's width), a compact two-line card, or the full card with the
    hourly strip. Layout can be left on Auto or pinned
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
- Desktop app — native installers for Windows, macOS, and Linux built with Tauri. The
  Windows app carries the whole app inside the installer and works like Android (no
  Tailscale needed once you're signed in); macOS and Linux are a window onto the server's
  web app
- PWA — add to your home screen on iOS/Android

**Weather data:** [Open-Meteo](https://open-meteo.com) (forecast, air quality, city search)
and OpenStreetMap's [Nominatim](https://nominatim.org) (the name of the place you're
standing in) — free, no API key, no account, no quota to manage. Nothing to configure.
Each device asks them itself, so **the provider sees that device's IP address and the
coordinates it asks about** — fine for a personal app, worth knowing. Open-Meteo allows
600 requests a minute per IP, far more than a person uses; it is free for non-commercial use.

**How it fits together:**

```
 phone / PC ──── forecast, search, place names ───▶  Open-Meteo, Nominatim   (direct, no server)
     │
     │ cities + 4 settings, merged per device ◀──▶  Quarc Weather server      (only reachable
     │   (a queue on the device when offline)        quarc-auth for login       over Tailscale)
     └─ local database (cities, settings, forecast cache, My Location)
```

The server keeps just two small tables — each account's cities and settings, with a
"tombstone" for every deletion so other devices learn of it. It stores no weather and no
location. Conflicts are settled by the time of the edit, city by city and setting by
setting, so two devices that were apart always end up identical.

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
matches `quarc-auth`'s, the TLS certificate, the database (how many cities, how
many accounts) and the API endpoints. (The server no longer talks to Open-Meteo —
devices do — so there is nothing to check about it from here.)

---

### Updating

```bash
git pull
bash deploy.sh
```

The database is stored in a Docker volume and survives rebuilds.

#### Upgrading from 1.0.x to 1.1.0 (offline + sync) — read this once

1.1.0 changes what the server is: it no longer serves weather or city search, it only
syncs each account's cities and settings. That is a one-way change, so:

1. **Back up first:** `bash backup.sh`. (The server also writes a full copy of the old
   database next to it, `weather.db.before-sync-<time>`, before converting it — but a
   backup you made yourself is the one to rely on.)
2. **Tag the app release and wait for it to publish** (see "Releasing" below), **then
   deploy the server straight away** with `git pull && bash deploy.sh`. On its first start
   the new backend converts the old database: cities keep their data but get new ids
   derived from their coordinates (so the same place added on two devices is one city),
   the old server-side "My Location" pins are dropped (that is per-device now), and the
   settings carry over except the theme and the daily briefing (per device now).
3. **Old apps stop working** the moment the server is updated — they call routes that no
   longer exist. So make the update **mandatory** straight after deploying: in Quarc
   Store → **Admin → Catalog**, set Quarc Weather's *minimum version* to the new release.
   Old apps then show "Update required" instead of failing mysteriously. (The gate fails
   open if the Store is unreachable.)
4. Each device needs Tailscale **once** after updating, so its first sync can download the
   account's cities and settings into the device (until then its list is empty — the
   cities live on the server, not yet on the device). After that, Android and Windows work
   without it.

Home-screen widgets: after the update the widget shows "Open Quarc Weather to sign in"
until the app has been opened once (that is when the app hands the widget its list of
cities). A widget that was set to follow one specific city falls back to the first city
in the list — pick the city again in the widget's settings.

---

### Backup and restore

```bash
bash backup.sh                      # creates ./backup_YYYYMMDD_HHMMSS/
bash restore.sh ./backup_2026...    # on the new server
```

Only city lists and preferences live on the server — forecasts come from the weather
provider straight to each device, so there's nothing else worth preserving.

Every device also keeps its own copy of its account's cities and settings, which makes a
restore forgiving: `restore.sh` renews the database's **epoch**, and a device that sees the
epoch change sends the server everything it holds the next time it connects (every city
with its own edit time, so the newest edit still wins and a city deleted after the backup
stays deleted). Anything that happened after the backup is therefore put back by the
devices themselves. If you restore by copying the database file some other way, run
`docker compose exec -T backend node src/scripts/new-epoch.js` afterwards for the same effect.

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

**Short version:** Users need Tailscale installed and connected to sign in and to sync,
then either open `https://quarcnet0.tail84500c.ts.net:4002` in a browser, install the
Android APK, or install the desktop app. They log in with the same account they already
use for Quarc Music. After signing in, the Android and Windows apps keep working with
Tailscale off.

---

## Tests

Every push and pull request runs the **Tests** workflow (`.github/workflows/tests.yml`):
pure-logic unit tests (including the sync engine against the real server code with several
simulated devices), the sync API suite against the real backend, the Android JVM tests, and
the browser suites in headless Chrome against the real stack and the real weather provider.
See **[tests/README.md](tests/README.md)** for what each suite covers and how to run them
locally. To let CI check out `Quarc_Store` (for the shared login service) when that
repository is private, add a read-only token as the repository secret `QUARC_STORE_TOKEN`.

---

## Releasing new app builds

Tag a version and push it — the workflow builds and publishes everything:

```bash
git tag v1.0.1
git push origin v1.0.1
```

`.github/workflows/desktop-release.yml` builds the Windows/macOS/Linux installers
and the signed Android APK, then publishes them to a GitHub Release. The apps
check that release for updates and install in place. The Windows job also builds the
frontend into the installer (the Windows app carries its own copy — see
[desktop/BUILD.md](desktop/BUILD.md)), which is why a server-side `deploy.sh` does not update
the Windows app but a new release does.

**A release that changes the server's API** (like 1.1.0) must go out in this order, because
the apps and the server only understand each other at the same version: tag and let the
release publish → `git pull && bash deploy.sh` on the server → raise the minimum version in
Quarc Store's admin catalog so old apps are told to update. Deploying the server before the
apps exist leaves everyone on a broken app; deploying it much later leaves new apps without
a server to sync with (they keep working locally in the meantime).

Required repository secrets: `KEYSTORE_BASE64` and `KEYSTORE_PASSWORD` for APK
signing. Reuse the same keystore approach as Quarc Music and Quarc Notes — but
note the key alias here is `quarc-weather`.
