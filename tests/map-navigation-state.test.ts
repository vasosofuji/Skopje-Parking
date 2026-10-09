import test from "node:test";
import assert from "node:assert/strict";
import { createMapNavigationStore, defaultMapNavigationState, MAP_STATE_MAX_AGE, parseMapNavigationState } from "../src/domain/mapNavigationState";

const destination = { id: "city-mall", name: "City Mall", coordinate: { latitude: 42.002, longitude: 21.392 } };
function storage() {
  const items = new Map<string, string>();
  return { items, getItem: async (key: string) => items.get(key) ?? null, setItem: async (key: string, value: string) => { items.set(key, value); } };
}

test("reopening restores destination, viewport, selected parking, filters and sort for that account", async () => {
  const disk = storage(), first = createMapNavigationStore(disk, "driver/one");
  await first.load();
  first.update("destination", destination);
  first.update("viewport", destination.coordinate);
  first.update("selected", "parking-1");
  first.update("anchor", destination.coordinate);
  first.update("sort", "cheapest");
  first.update("parkingFilters", ["garage", "spaces"]);
  await first.flush();
  const reopened = createMapNavigationStore(disk, "driver/one");
  await reopened.load();
  assert.equal(reopened.getSnapshot().restored, true);
  assert.deepEqual(reopened.getSnapshot().state, first.getSnapshot().state);
  const other = createMapNavigationStore(disk, "driver/two");
  await other.load();
  assert.equal(other.getSnapshot().restored, false);
  assert.deepEqual(other.getSnapshot().state, defaultMapNavigationState());
});

test("clearing a destination persists and stale hydration cannot overwrite a newer interaction", async () => {
  let resolve!: (value: string) => void;
  const disk = storage();
  const state = createMapNavigationStore({ ...disk, getItem: () => new Promise<string>(yes => { resolve = yes; }) }, "driver");
  const loading = state.load();
  state.update("destination", destination);
  resolve(JSON.stringify({ version: 1, savedAt: Date.now(), state: { ...defaultMapNavigationState(), destination: { ...destination, id: "old" } } }));
  await loading;
  assert.deepEqual(state.getSnapshot().state.destination, destination);
  state.update("destination", null);
  await state.flush();
  const reopened = createMapNavigationStore(disk, "driver");
  await reopened.load();
  assert.equal(reopened.getSnapshot().state.destination, null);
});

test("map state rejects expired/corrupt values and sanitizes coordinates and filters", () => {
  const now = Date.now();
  const encode = (state: unknown, savedAt = now) => JSON.stringify({ version: 1, state, savedAt });
  for (const raw of [null, "{", "null", encode({}, now - MAP_STATE_MAX_AGE - 1), encode({}, now + 60001)]) assert.equal(parseMapNavigationState(raw, now), null);
  assert.deepEqual(parseMapNavigationState(encode({ viewport: { latitude: 999, longitude: 1 }, destination: { ...destination, coordinate: null }, selected: null, anchor: destination.coordinate, parkingFilters: ["garage", "garage", "invented"], sort: "unknown" }), now), { ...defaultMapNavigationState(), parkingFilters: ["garage"] });
});

test("failed storage releases hydration and serialized writes preserve the newest selection", async () => {
  const disk = storage();
  let release!: () => void, writes = 0;
  const state = createMapNavigationStore({ getItem: async () => { throw Error("unavailable"); }, setItem: async (key, value) => { if (++writes === 1) await new Promise<void>(yes => { release = yes; }); await disk.setItem(key, value); } }, "driver");
  await state.load();
  assert.equal(state.getSnapshot().ready, true);
  state.update("selected", "old"); const first = state.flush();
  await new Promise<void>(yes => setImmediate(yes));
  state.update("selected", "new"); const next = state.flush();
  release(); await Promise.all([first, next]);
  const reopened = createMapNavigationStore(disk, "driver"); await reopened.load();
  assert.equal(reopened.getSnapshot().state.selected, "new");
});
