// Regenerates the home-screen widget's "Sky" background drawables
// (mobile/android/app/src/main/res/drawable/widget_bg_sky_<mood>_<day|night>.xml)
// from the web app's own palette, so the widget and the app can never disagree
// about what a rainy evening looks like.
//
//   node mobile/scripts/widget-sky-drawables.mjs
//
// Run it after changing SKY in frontend/src/lib/weatherCodes.js.

import { pathToFileURL, fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { SKY } = await import(pathToFileURL(path.join(root, 'frontend/src/lib/weatherCodes.js')).href);
const out = path.join(root, 'mobile/android/app/src/main/res/drawable');
const argb = (hex) => '#' + hex.replace('#', '').toUpperCase();

let count = 0;
for (const [mood, tones] of Object.entries(SKY)) {
  for (const [tone, [a, b, c]] of Object.entries(tones)) {
    const name = `widget_bg_sky_${mood}_${tone}`;
    fs.writeFileSync(
      path.join(out, `${name}.xml`),
      `<?xml version="1.0" encoding="utf-8"?>
<!-- GENERATED from SKY.${mood}.${tone} in frontend/src/lib/weatherCodes.js — the same
     three stops the app paints behind a city screen. Edit the web palette and
     regenerate rather than changing the colours here. angle 270 = top to bottom. -->
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <corners android:radius="@dimen/widget_corner_radius" />
    <gradient
        android:angle="270"
        android:startColor="${argb(a)}"
        android:centerColor="${argb(b)}"
        android:endColor="${argb(c)}" />
</shape>
`
    );
    count++;
  }
}
console.log(`wrote ${count} drawables to ${path.relative(root, out)}`);
