# Quarc Weather — User Guide

Weather for your Quarc account. Your city list is saved to your account, so it's
the same on your phone, your laptop, and any browser you log into.

---

## Before anything else: Tailscale

Quarc Weather's server is private, not on the public internet. You need
[Tailscale](https://tailscale.com/download) installed and connected, signed in
with the account you were invited on, for **two** things: signing in, and syncing
your cities and settings between your devices.

**The weather itself does not need Tailscale.** The Android app, the Android widget
and the Windows app get the weather, city search and place names straight from the
internet, and keep your cities on the device. So once you're signed in they keep
working with Tailscale off — you just need normal internet. Anything you change in the
meantime (a city you add, a setting you switch) waits in a queue and is sent when
Tailscale is back on; a small badge shows how many changes are waiting.

The browser version, the iPhone/iPad home-screen app and the macOS and Linux apps load
from the server, so they need Tailscale to open.

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
Tap it to open the full app. You can pick a specific city in the widget's own
settings.

**How fresh is it:** it refreshes itself roughly every 45 minutes in the
background — no need to have the app open, and no need for Tailscale: it asks the
weather provider directly. It also refreshes right away whenever the app changes
your list of cities, and when you place the widget for the first time.

**If it shows "Open Quarc Weather to sign in"** — the app hasn't told the widget
which cities to show yet (this happens once after updating the app, and after you log
out). Open the app and the widget picks up your cities within a few seconds. After the
update from version 1.0.x, a widget that was set to one specific city shows the first city
in your list until you choose the city again in the widget's settings.

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

## Daily briefing notification (Android only)

An optional "good morning" notification — today's temperature, condition,
high/low, and a heads-up if rain's expected soon — at whatever time you pick.

**Turning it on:** Settings → **Daily briefing** → switch **Morning
notification** to **On** → pick a time. Android will ask for notification
permission the first time you do this — allow it, or the briefing has
nothing to actually notify you with.

**How precise is the timing:** within about 15–30 minutes of the time you
set, not to the exact minute — it's checked on the same kind of periodic
background job the widget uses, not a real-time alarm.

**Turning it off:** switch it back to **Off** in the same screen. Stops the
background check entirely — no battery cost for a notification you're not
getting.

This one setting belongs to the **device** — unlike units and language, which
follow your account. A phone wants a morning notification and a tablet may not,
so turning it on here does nothing on your other devices (and each device needs
to grant its own notification permission). It fetches the weather itself, so it
arrives even with Tailscale off.

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

**Windows** carries the whole app inside the installer, so — like Android — it opens
and shows the weather without Tailscale; sign in and sync need it. The first time it
asks for your location, Windows shows a permission prompt; until you answer, the app
shows its logo for a few seconds and then opens on your last city. A new version means
a new installer (the app tells you, like on Android); a server update alone does not
change it. **macOS and Linux** open the server's web app in a window, so they need
Tailscale to load.

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
arrows to move it, or **✕** to remove it. Adding a city on two devices at the same
time never creates a duplicate: the same place is one city, and everything you did on
either device is kept when they sync.

**My Location** — the first card on the list when you've allowed location. It belongs
to that one device: your phone's position is never sent to the server or shown on your
other devices.

**City details** — tap any card for the full screen: hourly, 10-day, all the
detail tiles, and a **Precipitation radar** card near the bottom — tap it to
expand a live, animated radar map centered on the city (free, no setup).

**Units and language** — **Settings** (⚙). Switch °C/°F, wind units, mm/inch,
theme, and English/Turkish. Units and language save to your account, so they apply
on every device you use (change units on one device and the language on another and
both stick). The **theme** is per device.

---

## Without Tailscale (and without a connection)

**Tailscale off, internet on** (Android and Windows apps, and the widget): everything
works — your cities and settings are on the device, and the weather, search and place
names come straight from the internet. You can add, remove and reorder cities and change
settings; a note at the top says how many changes are waiting to sync, and they go through on
their own when Tailscale is back. Two devices that were both changed meanwhile merge
without losing anything.

**No internet at all:** the app still opens and shows the last forecast it fetched for
each city, labelled with how long ago that was. It refreshes automatically as soon as
you're back online, and whenever you bring the app back to the foreground. (Adding a city
needs internet, because the search does.)

---

## Troubleshooting

**The list is empty on a new device, or my changes don't show up on my other
devices** — they sync through the server, which needs Tailscale. Connect it and give the
app a few seconds (or reopen it). The badge at the top shows how many changes are still
waiting; it disappears when they're all sent.

**A city shows `--` instead of a temperature** — that city's forecast failed to
load. Pull the app to the foreground again, or check your internet connection. The rest of
your list is unaffected.

**The browser version or the macOS/Linux app won't open** — those load from the server,
so check Tailscale is connected and try `https://quarcnet0.tail84500c.ts.net:4002` in a
browser. If the browser works but the app doesn't, reinstall the app.

**"Update required"** — your app is older than the server understands. Update it from
Quarc Store (or the Releases page) and it works again.

**Search finds nothing** — you need at least 2 characters. Try the local-language
spelling too; the search understands both (e.g. both "Istanbul" and "İstanbul").

**Widget wasn't offered / I dismissed the prompt by accident** — it only asks
once automatically, but you can always add it manually: long-press your home
screen → **Widgets** → **Quarc Weather**.

**Widget is stuck on old data** — it refreshes itself every ~45 minutes and needs
an internet connection (not Tailscale). Open the app once to refresh it right away, or
long-press the widget → remove it → add it again.
