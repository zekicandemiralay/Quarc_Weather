// What the app hands the home-screen widget: which places, in which order, with what precision, and when it is
// (not) re-sent. Pure logic — no browser, no phone.
//
//   node --test tests/unit-widget.test.js        (Node 20+)

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'widgetPlaces.js')).href);

const berlin = { id: 'c_5252_1340', name: 'Berlin', latitude: 52.52, longitude: 13.405 };
const tokyo = { id: 'c_3568_13969', name: 'Tokyo', latitude: 35.6895, longitude: 139.6917 };
const here = { id: 'here', name: 'Cankurtaran', latitude: 41.00821234, longitude: 28.97841234 };

test('My Location comes first, then the saved cities in their order', async () => {
  const { placesForWidget } = await load();
  const places = placesForWidget({ cities: [berlin, tokyo], hereCity: here });
  assert.deepEqual(places.map((p) => p.id), ['here', 'c_5252_1340', 'c_3568_13969']);
  assert.equal(places[0].isPin, true);
  assert.equal(places[1].isPin, false);
});

test('without a location fix the list is just the saved cities', async () => {
  const { placesForWidget } = await load();
  assert.deepEqual(placesForWidget({ cities: [berlin], hereCity: null }).map((p) => p.id), ['c_5252_1340']);
  assert.deepEqual(placesForWidget({}), []);
});

test("My Location's coordinates are rounded to ~100 m so GPS wobble is not a new list every time", async () => {
  const { placesForWidget } = await load();
  const [p] = placesForWidget({ hereCity: here });
  assert.equal(p.latitude, 41.008);
  assert.equal(p.longitude, 28.978);
  const [q] = placesForWidget({ hereCity: { ...here, latitude: 41.00849, longitude: 28.97799 } });
  assert.deepEqual(p, q, 'two fixes metres apart must produce the identical entry');
});

test('a saved city keeps its exact coordinates', async () => {
  const { placesForWidget } = await load();
  const [p] = placesForWidget({ cities: [tokyo] });
  assert.equal(p.latitude, 35.6895);
  assert.equal(p.longitude, 139.6917);
});

test('anything without usable coordinates is left out, not sent as NaN', async () => {
  const { placesForWidget } = await load();
  const places = placesForWidget({
    cities: [berlin, { id: 'x', name: 'Broken', latitude: null, longitude: 1 }, { id: 'y', name: 'Broken2', latitude: 1, longitude: undefined }],
    hereCity: { id: 'here', name: 'No fix', latitude: NaN, longitude: NaN },
  });
  assert.deepEqual(places.map((p) => p.id), ['c_5252_1340']);
});

// --- the watcher ----------------------------------------------------------------------------

/** A fake clock + a hand-driven data source, so the debounce is tested without waiting. */
function rig() {
  const pushes = [];
  let emit;
  const timers = new Map();
  let nextId = 1;
  const clock = {
    setTimer: (fn) => { const id = nextId++; timers.set(id, fn); return id; },
    clearTimer: (id) => { timers.delete(id); },
    fire: () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
    pending: () => timers.size,
  };
  return { pushes, clock, setEmit: (fn) => { emit = fn; }, emit: (s) => emit(s) };
}

async function start(r) {
  const { watchWidgetPlaces } = await load();
  let unsubscribed = false;
  const stop = watchWidgetPlaces({
    subscribe: (onState) => { r.setEmit(onState); return () => { unsubscribed = true; }; },
    push: (p) => r.pushes.push(p),
    ...r.clock,
  });
  return { stop, wasUnsubscribed: () => unsubscribed };
}

test('the first state is pushed after the quiet period, not before', async () => {
  const r = rig();
  await start(r);
  r.emit({ cities: [berlin], hereCity: null, units: 'metric' });
  assert.equal(r.pushes.length, 0, 'pushed before the quiet period passed');
  r.clock.fire();
  assert.equal(r.pushes.length, 1);
  assert.deepEqual(r.pushes[0], { cities: [{ id: 'c_5252_1340', name: 'Berlin', latitude: 52.52, longitude: 13.405, isPin: false }], units: 'metric' });
});

test('a burst of changes collapses into one push carrying the latest list', async () => {
  const r = rig();
  await start(r);
  r.emit({ cities: [berlin], hereCity: null, units: 'metric' });
  r.emit({ cities: [berlin, tokyo], hereCity: null, units: 'metric' });
  r.emit({ cities: [berlin, tokyo], hereCity: here, units: 'metric' });
  assert.equal(r.clock.pending(), 1, 'every change must restart the single waiting timer');
  r.clock.fire();
  assert.equal(r.pushes.length, 1);
  assert.deepEqual(r.pushes[0].cities.map((c) => c.id), ['here', 'c_5252_1340', 'c_3568_13969']);
});

test('the same list again is not pushed again', async () => {
  const r = rig();
  await start(r);
  r.emit({ cities: [berlin], hereCity: null, units: 'metric' });
  r.clock.fire();
  r.emit({ cities: [berlin], hereCity: null, units: 'metric' }); // e.g. a GPS fix a few metres away
  assert.equal(r.clock.pending(), 0);
  r.clock.fire();
  assert.equal(r.pushes.length, 1);
});

test('changing a unit setting is a real change', async () => {
  const r = rig();
  await start(r);
  r.emit({ cities: [berlin], hereCity: null, units: 'metric' });
  r.clock.fire();
  r.emit({ cities: [berlin], hereCity: null, units: 'imperial' });
  r.clock.fire();
  assert.deepEqual(r.pushes.map((p) => p.units), ['metric', 'imperial']);
});

test('a change that is reverted before the quiet period ends sends nothing new', async () => {
  const r = rig();
  await start(r);
  r.emit({ cities: [berlin], hereCity: null, units: 'metric' });
  r.clock.fire(); // the native side now has [berlin]
  r.emit({ cities: [berlin, tokyo], hereCity: null, units: 'metric' }); // added...
  r.emit({ cities: [berlin], hereCity: null, units: 'metric' }); // ...and removed again
  r.clock.fire();
  assert.equal(r.pushes.length, 1);
});

test('an unknown unit falls back to metric', async () => {
  const r = rig();
  await start(r);
  r.emit({ cities: [berlin], hereCity: null, units: undefined });
  r.clock.fire();
  assert.equal(r.pushes[0].units, 'metric');
});

test('stopping cancels a push that is still waiting and lets go of the data source', async () => {
  const r = rig();
  const { stop, wasUnsubscribed } = await start(r);
  r.emit({ cities: [berlin], hereCity: null, units: 'metric' });
  stop();
  r.clock.fire();
  assert.equal(r.pushes.length, 0, 'pushed after being stopped (e.g. after sign-out)');
  assert.equal(wasUnsubscribed(), true);
});
