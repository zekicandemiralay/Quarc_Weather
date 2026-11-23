# Building the Quarc Weather desktop app

## Prerequisites (one-time setup)

1. **Rust** — https://rustup.rs
   Run the installer, restart your terminal.

2. **Node.js** — https://nodejs.org (v18 or newer)

3. **WebView2** — already installed on Windows 10/11.
   If missing: https://developer.microsoft.com/en-us/microsoft-edge/webview2/

## Generate icons (one-time)

The repo ships `desktop/logo.png` (1024×1024, exported from the master
`QuarcNet/logos/weather.svg`). From the `desktop/` folder:

```
npx tauri icon logo.png
```

This writes all required files into `src-tauri/icons/`. The `bundle.icon` list
in `tauri.conf.json` already points at them.

**This step is required before the first build** — `src-tauri/icons/` is not
checked in, and the build fails without it.

## Build the installer

From the `desktop/` folder:

```
npm install
npm run build
```

The installer is written to:
```
src-tauri/target/release/bundle/nsis/Quarc Weather_1.0.0_x64-setup.exe
```

Hand this `.exe` to users. They run it once to install, then launch
"Quarc Weather" from their Start menu or desktop shortcut.

## How it works

There are two kinds of desktop build, chosen per platform by Tauri's config merging:

**Windows — a bundled app.** `src-tauri/tauri.windows.conf.json` replaces the window list from
`tauri.conf.json` with one that has no `url`, so the window loads the frontend that is built into the
installer (`desktop/dist`, served from `http://tauri.localhost`). The app opens and works without the Quarc
server: weather, city search and place names come straight from Open-Meteo / OpenStreetMap, and the cities and
settings live in a database on the machine. The server (`https://quarcnet0.tail84500c.ts.net:4002`, reachable
over Tailscale) is only used to sign in and to sync cities and settings between devices — changes made while it
is out of reach wait in a queue and go through on their own later.

Because the frontend is inside the installer, a server-side `bash deploy.sh` does **not** update it; a new
release (tag) rebuilds the installer. `desktop-release.yml` does this on the Windows job only: it builds the
frontend with `VITE_API_URL=https://quarcnet0.tail84500c.ts.net:4002` and copies it into `desktop/dist` before
Tauri builds. The `desktop/dist/index.html` committed to the repo is only a placeholder, so the build has
something to point at on every platform.

**macOS and Linux — a window onto the server.** The window's `url` is the server, exactly as before: the same
web app the browser opens, loaded over Tailscale. These need Tailscale to load at all (the app itself still
fetches weather directly and keeps a local database, but there is no copy of it on the machine). A server-side
`bash deploy.sh` updates what these show.

The window defaults to 480×900 — a phone-shaped portrait window, which is what the weather layout is designed
around. It's resizable.

### Trying the Windows build locally

From the repository root:

```
cd frontend
set VITE_API_URL=https://quarcnet0.tail84500c.ts.net:4002
npx vite build --outDir ../desktop/dist --emptyOutDir
cd ../desktop
npx tauri build --debug --no-bundle
```

Afterwards put the placeholder back with `git checkout desktop/dist` and delete the other files the build
wrote into `desktop/dist` — a built frontend must never be committed.

Location: the first time the app asks for the device's position, WebView2 shows its own permission prompt;
until it is answered the app shows its logo for up to 8 seconds and then opens on the last city.

## Certificate requirement

Signing in and syncing need Tailscale to be installed and connected. The Tailscale certificate is trusted
automatically, so unlike a self-signed setup there's nothing to install by hand — the same cert covers every
Quarc app on this host.
