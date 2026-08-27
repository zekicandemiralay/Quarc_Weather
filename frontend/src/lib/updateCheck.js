// In-app update checking — mirrors Quarc Music's and Quarc Notes' exact
// mechanism (same GitHub-releases-based check, same per-platform install
// behavior), just pointed at this repo. Native platforms only
// (Capacitor/Tauri); plain web has no "installed version" concept, so it only
// ever links out.

const REPO = 'zekicandemiralay/Quarc_Weather';

export function semverGt(a, b) {
  const pa = (a || '0').split('.').map(Number);
  const pb = (b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

export function getPlatform() {
  if (window?.Capacitor?.isNativePlatform?.()) return 'android';
  if (window?.__TAURI__) return 'desktop';
  return 'web';
}

export async function getCurrentVersion(platform) {
  try {
    if (platform === 'android') return (await window.Capacitor.Plugins.App.getInfo()).version;
    if (platform === 'desktop') return await window.__TAURI__.app.getVersion();
  } catch {
    /* native API unavailable — treat as unknown */
  }
  return null;
}

export async function fetchLatestRelease() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return res.json();
}

export function getDownloadUrl(release, platform) {
  if (!release) return null;
  if (platform === 'android') return release.assets?.find((a) => a.name.endsWith('.apk'))?.browser_download_url;
  if (platform === 'desktop') {
    return release.assets?.find((a) => a.name.includes('x64-setup.exe'))?.browser_download_url ?? release.html_url;
  }
  return release.html_url;
}

export function installUpdate(platform, url, version) {
  if (platform === 'android') {
    window?.Capacitor?.Plugins?.Updater?.downloadUpdate({ url, version });
  } else if (platform === 'desktop') {
    // The NSIS installer updates in place.
    window.__TAURI__.shell.open(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/**
 * One-shot check used by the Settings screen and the startup banner.
 * Resolves to null when already current or when the check can't run.
 */
export async function checkForUpdate() {
  const platform = getPlatform();
  if (platform === 'web') return null;

  const current = await getCurrentVersion(platform);
  if (!current) return null;

  const release = await fetchLatestRelease();
  const latest = (release.tag_name || '').replace(/^v/, '');
  if (!semverGt(latest, current)) return null;

  return { platform, current, latest, url: getDownloadUrl(release, platform), notes: release.body };
}
