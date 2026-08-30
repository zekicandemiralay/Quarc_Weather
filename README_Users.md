# Quarc Weather — User Guide

Weather for your Quarc account. Your city list is saved to your account, so it's
the same on your phone, your laptop, and any browser you log into.

---

## Before anything else: Tailscale

Quarc Weather runs on a private server, not the public internet. You need
[Tailscale](https://tailscale.com/download) installed and connected, signed in
with the account you were invited on. Nothing below works without it.

---

## Choose how to use it

| Device | Best option |
|---|---|
| Android phone | Install the APK |
| iPhone / iPad | Open in Safari, Add to Home Screen |
| Windows / Mac / Linux | Install the desktop app, or just use a browser |
| Any browser | `https://quarcnet0.tail84500c.ts.net:4002` |

---

## Android

1. Download **Quarc-Weather-Android.apk** from
   [Releases](https://github.com/zekicandemiralay/Quarc_Weather/releases/latest)
2. Tap it. Android will ask you to allow installs from your browser or file
   manager — allow it, then tap Install.
3. Open the app and log in.

Updates: a banner appears automatically a few seconds after you open the app if
a new version is out — tap **Install**, no need to go looking in Settings. You
can also check manually any time from **Settings → Check for updates**.

The first time the app successfully shows you real weather, it'll ask if you
want to add the home-screen widget — see below.

---

## Home screen widget (Android only)

A small tile for your home screen showing your top city's current conditions,
refreshing itself in the background — you don't need to open the app for it to
stay current.

**This is Android-only.** iOS, Windows, macOS, and Linux don't have a public
widget system a self-hosted app like this can plug into — see the note at the
bottom of this section if you're curious why.

**Adding it:**

- **Automatic prompt** — the first time the app shows you real weather after
  installing or updating, Android will ask "Add Quarc Weather widget to home
  screen?". Tap **Add**. This only happens once.
- **Manually, any time** — long-press an empty spot on your home screen →
  **Widgets** → find **Quarc Weather** → drag it onto your home screen.

**What it shows:** your top city (current location if you have it enabled,
otherwise your first saved city), temperature, condition, and today's high/low.
Tap it to open the full app.

**How fresh is it:** it refreshes itself roughly every 45 minutes in the
background — no need to have the app open. It also refreshes immediately right
after you log in or place the widget for the first time.

**If it shows "Open Quarc Weather to sign in"** — the widget's stored session
has expired (sessions last 7 days) or you're not logged in. Open the app,
log in, and the widget picks the new session up automatically within a
few seconds.

**Removing it:** long-press the widget on your home screen → **Remove**. This
also stops its background refresh — it won't keep using battery for a widget
that isn't there.

*Why only Android:* a real home-screen widget needs the OS to provide a
public API for it — Android's has existed and been stable for years. iOS and
macOS widgets (WidgetKit) need a native app built and signed via Xcode on a
Mac, which is a much bigger undertaking than this self-hosted, PWA-friendly
app has ever needed for those platforms. Windows 11's Widgets Board has no
public API for third-party apps to register into at all.

---

## iPhone / iPad

There's no separate iOS app. Open
`https://quarcnet0.tail84500c.ts.net:4002` in **Safari**, tap the Share button,
then **Add to Home Screen**. It runs full-screen like a normal app.

---

## Windows / macOS / Linux

Download the installer for your platform from
[Releases](https://github.com/zekicandemiralay/Quarc_Weather/releases/latest):

| Platform | File |
|---|---|
| Windows | `*_x64-setup.exe` |
| macOS (M1/M2/M3) | `*_aarch64.dmg` |
| macOS (Intel) | `*_x64.dmg` |
| Linux | `*_amd64.deb` or `*_amd64.AppImage` |

**macOS:** the app isn't signed with an Apple developer certificate, so the first
launch needs a right-click → **Open** instead of a double-click.

Or skip the install entirely and use the URL in any browser — same app.

---

## Logging in

Use the **same username and password as Quarc Music and Quarc Notes**. It's one
account across all of them. If you've never had an account, tap **Sign up** on
the login screen.

---

## Using it

**Add a city** — tap **+** in the top right, type a city name, tap the result.
The search covers cities and airports worldwide, and shows the region and country
so you can tell apart the several places that share a name.

**Use your location** — tap **Use my location** on the add screen. Your browser or
phone will ask permission first.

**Reorder or remove** — hover (or tap) a city card on the main list and use the
arrows to move it, or **✕** to remove it.

**City details** — tap any card for the full screen: hourly, 10-day, all the
detail tiles, and a **Precipitation radar** card near the bottom — tap it to
expand a live, animated radar map centered on the city (free, no setup).

**Units and language** — **Settings** (⚙). Switch °C/°F, wind units, mm/inch,
theme, and English/Turkish. These save to your account, so they apply on every
device you use.

---

## Offline

If you open the app with no connection, it shows the last forecast it
successfully fetched for each city, labelled with how long ago that was. It
refreshes automatically as soon as you're back online, and whenever you bring
the app back to the foreground.

---

## Troubleshooting

**"Not authenticated" or it keeps bouncing to login** — check Tailscale is
connected. The session cookie is fine; the server just isn't reachable.

**A city shows `--` instead of a temperature** — that city's forecast failed to
load. Pull the app to the foreground again, or check your connection. The rest of
your list is unaffected.

**Nothing loads at all** — confirm Tailscale is connected and try
`https://quarcnet0.tail84500c.ts.net:4002` in a browser. If the browser works but
the app doesn't, reinstall the app.

**Search finds nothing** — you need at least 2 characters. Try the local-language
spelling too; the search understands both (e.g. both "Istanbul" and "İstanbul").

**Widget wasn't offered / I dismissed the prompt by accident** — it only asks
once automatically, but you can always add it manually: long-press your home
screen → **Widgets** → **Quarc Weather**.

**Widget is stuck on old data** — open the app once (this refreshes the
widget's stored session), or long-press the widget → remove it → add it again.
