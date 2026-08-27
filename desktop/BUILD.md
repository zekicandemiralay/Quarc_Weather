# Building the Quarc Weather desktop app

## Prerequisites (one-time setup)

1. **Rust** — https://rustup.rs
   Run the installer, restart your terminal.

2. **Node.js** — https://nodejs.org (v18 or newer)

3. **WebView2** — already installed on Windows 10/11.
   If missing: https://developer.microsoft.com/en-us/microsoft-edge/webview2/

## Generate icons (one-time)

The repo ships `desktop/logo.png` (512×512). Tauri wants at least 1024×1024 for
the full icon set, so either supply a larger source or accept the upscale.
From the `desktop/` folder:

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

The desktop app is a thin Tauri shell pointing at
`https://quarcnet0.tail84500c.ts.net:4002` — the same server the browser and
the APK use. There's no bundled frontend, so a server-side `bash deploy.sh`
updates the desktop app's contents too; only shell-level changes (window size,
Tauri version, the updater) need a new installer.

The window defaults to 480×900 — a phone-shaped portrait window, which is what
the weather layout is designed around. It's resizable.

## Certificate requirement

Users must have Tailscale installed and connected. The Tailscale certificate is
trusted automatically, so unlike a self-signed setup there's nothing to install
by hand — the same cert covers every Quarc app on this host.
