import test from "node:test";
import assert from "node:assert/strict";
import { createNavigationPreferences, directionUrls, openDirections, type NavigationApp } from "../src/domain/navigation";
const point = { latitude: 41.997, longitude: 21.433 };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test("selected providers build driving routes and preserve their own web fallback", () => {
  assert.deepEqual(directionUrls("waze", "android", point), ["waze://?ll=41.997,21.433&navigate=yes", "https://waze.com/ul?ll=41.997,21.433&navigate=yes"]);
  assert.equal(directionUrls("google", "android", point)[0], "google.navigation:q=41.997,21.433&mode=d");
  assert.equal(directionUrls("google", "ios", point)[0], "comgooglemaps://?daddr=41.997,21.433&directionsmode=driving");
  assert.match(directionUrls("default", "ios", point)[0], /^https:\/\/maps.apple.com\/\?daddr=/);
  assert.equal(directionUrls("default", "android", point)[0], "geo:0,0?q=41.997,21.433");
  assert.equal(directionUrls("waze", "web", point).length, 1);
  assert.match(directionUrls("waze", "web", point)[0], /^https:/);
});
test("navigation opens synchronously from the press and falls back when the selected app is unavailable", async () => {
  const opened: string[] = [];
  const result = openDirections("waze", "android", point, url => { opened.push(url); return url.startsWith("waze:") ? Promise.reject(new Error("not installed")) : Promise.resolve(); });
  assert.deepEqual(opened, ["waze://?ll=41.997,21.433&navigate=yes"], "the first launch must not wait for storage or a timer");
  await result;
  assert.deepEqual(opened, directionUrls("waze", "android", point));
});
test("successful native navigation stops fallback and failures remain actionable", async () => {
  const opened: string[] = [];
  await openDirections("google", "ios", point, async url => { opened.push(url); });
  assert.equal(opened.length, 1);
  await assert.rejects(openDirections("google", "android", point, async () => { throw new Error("blocked"); }), /Could not open navigation/);
});
test("invalid or injected coordinates never reach any URL opener", async () => {
  for (const bad of [{ latitude: NaN, longitude: 21 }, { latitude: 91, longitude: 21 }, { latitude: 42, longitude: Infinity }, { latitude: 42, longitude: "21&evil=yes" as unknown as number }]) {
    await assert.rejects(openDirections("google", "web", bad, async () => assert.fail("invalid coordinate opened")), /location is invalid/);
  }
});
test("saved preference loads once and notifies consumers", async () => {
  let reads = 0, notifications = 0;
  const store = createNavigationPreferences({ getItem: async () => { reads++; return "waze"; }, setItem: async () => {} });
  const remove = store.subscribe(() => { notifications++; });
  await Promise.all([store.load(), store.load()]);
  await store.load();
  assert.equal(store.current(), "waze"); assert.equal(reads, 1); assert.equal(notifications, 1);
  remove(); await store.set("google"); assert.equal(notifications, 1);
});
test("a late initial read cannot overwrite a newly saved navigation preference", async () => {
  let release!: (value: string) => void;
  const store = createNavigationPreferences({ getItem: () => new Promise(resolve => { release = resolve; }), setItem: async () => {} });
  const loading = store.load();
  await store.set("google"); release("waze"); await loading;
  assert.equal(store.current(), "google");
});
test("a failed set overlapping hydration keeps the previously persisted preference", async () => {
  let release!: (value: string) => void;
  const store = createNavigationPreferences({ getItem: () => new Promise(resolve => { release = resolve; }), setItem: async () => { throw new Error("disk full"); } });
  const loading = store.load();
  await assert.rejects(store.set("google"), /disk full/);
  release("waze"); await loading;
  assert.equal(store.current(), "waze");
});
test("rapid preference changes serialize and a failed later write keeps the last successful choice", async () => {
  let release!: () => void;
  const stored: string[] = [];
  const store = createNavigationPreferences({ getItem: async () => "default", setItem: async (_key, value) => { stored.push(value); if (value === "google") await new Promise<void>(resolve => { release = resolve; }); else throw new Error("storage failed"); } });
  await store.load();
  const first = store.set("google"), last = store.set("waze");
  await flush(); assert.deepEqual(stored, ["google"]);
  release(); await first; await assert.rejects(last, /storage failed/);
  assert.deepEqual(stored, ["google", "waze"]); assert.equal(store.current(), "google");
});
test("unknown persisted preferences safely use default and cannot be written", async () => {
  const store = createNavigationPreferences({ getItem: async () => "javascript:alert(1)", setItem: async () => assert.fail("bad setting written") });
  await store.load(); assert.equal(store.current(), "default");
  await assert.rejects(store.set("javascript:alert(1)" as NavigationApp), /supported navigation app/);
});
