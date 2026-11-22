// A saved city's identity is derived from WHERE it is, not generated randomly.
//
// That is what lets two devices that each add "Istanbul" while out of touch with
// each other end up with the same city after they sync, instead of two copies:
// both compute the same id from the same coordinates. Deleting and re-adding the
// same place is the same row too, so a re-add simply un-deletes it.
//
// Coordinates are rounded to 2 decimals (~1.1 km) — the same granularity the app
// has always used to refuse saving a city twice.
//
// backend/src/services/cityKey.js is a byte-for-byte equivalent (the server
// validates ids with it); tests/unit.test.js checks the two agree.

export function cityKey(latitude, longitude) {
  // `${-0}` is "0", so a tiny negative coordinate never produces "-0".
  return `c_${Math.round(latitude * 100)}_${Math.round(longitude * 100)}`;
}
