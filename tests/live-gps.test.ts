import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as locationIssue from "../src/domain/locationIssue";
import { containsParkingFix, type Fix } from "../src/domain/arrival";
import { preferFix, usableFix } from "../src/domain/location";
import type { ParkingPlace } from "../src/domain/types";
const source = ts.transpileModule(readFileSync("src/hooks/useArrival.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function harness(record: (fix: Fix) => Promise<ParkingPlace | null> = async () => null) {
  const states: unknown[] = [], cleanups: (() => void)[] = [], listeners: ((state: string) => void)[] = [];
  let callback!: (fix: Fix) => void, stopped = 0, catalogSaves = 0, now = Date.now();
  const appState = { currentState: "active", addEventListener: (_event: string, listener: (state: string) => void) => { listeners.push(listener); return { remove() {} }; } };
  const scope = {
    exports: {} as { useArrival: (places: ParkingPlace[], accountId: string) => unknown }, __DEV__: false,
    Date: class extends Date { static now() { return now; } }, setInterval: () => 1, clearInterval: () => {},
    fetch() { assert.fail("location updates must never make API requests"); },
    require(name: string) {
      if (name === "react") return {
        useMemo: (value: () => unknown) => value(),
        useState(initial: unknown) { const index = states.length; states.push(typeof initial === "function" ? (initial as () => unknown)() : initial); return [states[index], (value: unknown) => { states[index] = typeof value === "function" ? (value as (prior: unknown) => unknown)(states[index]) : value; }]; },
        useRef(initial: unknown) { return { current: initial }; },
        useEffect(effect: () => (() => void) | void) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); },
      };
      if (name === "react-native") return { AppState: appState };
      if (name === "../domain/arrival") return { containsParkingFix };
      if (name === "../domain/location") return { preferFix, usableFix: (fix: Fix) => usableFix(fix, now) };
      if (name === "../domain/locationIssue") return locationIssue;
      if (name === "../services/location") return { watchLocation: async (next: (fix: Fix) => void) => { callback = next; return () => { stopped++; }; } };
      if (name === "../services/arrivalStorage") return { saveArrivalCatalog: async () => { catalogSaves++; } };
      if (name === "../services/backgroundArrival") return { consumePendingArrival: async () => null, observePendingArrival: () => () => {}, resetArrivalCandidate: async () => {}, recordForegroundArrival: record };
      throw new Error(`Unexpected GPS dependency (location must stay local): ${name}`);
    },
  };
  vm.runInNewContext(source, scope);
  scope.exports.useArrival([], "driver-one");
  return {
    states,
    fix(value: Fix) { now = value.timestamp; callback(value); },
    state(value: string) { appState.currentState = value; listeners.forEach(listener => listener(value)); },
    stopped: () => stopped, catalogSaves: () => catalogSaves,
    close: () => cleanups.forEach(cleanup => cleanup()),
  };
}
test("one-second foreground positions update locally without catalog or API traffic", async () => {
  const app = harness(), start = Date.now(); await flush();
  for (let i = 0; i < 60; i++) app.fix({ latitude: 42, longitude: 21.43 + i * 0.0001, accuracy: i % 2 ? 180 : 10, speed: 12, timestamp: start + i * 1000 });
  assert.equal((app.states[0] as Fix).timestamp, start + 59_000);
  assert.equal(app.catalogSaves(), 1, "arrival catalog caching is independent of GPS frequency");
  app.state("inactive");
  assert.equal(app.stopped(), 1);
  app.fix({ latitude: 42, longitude: 21.45, accuracy: 8, speed: 0, timestamp: start + 60_000 });
  assert.equal(app.states[0], null, "inactive updates cannot revive foreground tracking");
  app.close();
});
test("an arrival persisted after a newer fix is still shown if the driver remains parked", async () => {
  let resolve!: (place: ParkingPlace) => void, count = 0;
  const pending = new Promise<ParkingPlace>(done => { resolve = done; });
  const app = harness(async () => ++count === 1 ? pending : null), start = Date.now();
  const place = { id: "park", kind: "surface", coordinate: { latitude: 42, longitude: 21.43 } } as ParkingPlace;
  await flush();
  app.fix({ ...place.coordinate, accuracy: 8, speed: 0, timestamp: start });
  app.fix({ ...place.coordinate, accuracy: 8, speed: 0, timestamp: start + 1000 });
  resolve(place); await flush();
  assert.equal(app.states[2], place);
  app.close();
});
