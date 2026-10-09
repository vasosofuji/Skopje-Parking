import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as arrivals from "../src/domain/arrival";
import * as location from "../src/domain/location";
import * as issue from "../src/domain/locationIssue";
import type { ParkingPlace } from "../src/domain/types";
import type { useArrival } from "../src/hooks/useArrival";
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
test("switching A to B and back never resurrects an old unanswered A prompt", async () => {
  const slots: unknown[] = [], effects: (() => void)[] = []; let cursor = 0;
  let gps!: (fix: arrivals.Fix) => void;
  const lot = { id: "lot", kind: "surface", coordinate: { latitude: 42, longitude: 21.4 }, access: "public" } as ParkingPlace;
  const react = {
    useState(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial: unknown) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }); },
    useMemo(create: () => unknown, deps: unknown[]) { const index = cursor++, old = slots[index] as { deps: unknown[]; value: unknown } | undefined; if (!old || deps.some((v,i) => v !== old.deps[i])) slots[index] = { deps, value: create() }; return (slots[index] as { value: unknown }).value; },
    useEffect(work: () => (() => void) | void, deps: unknown[]) { const index = cursor++, old = slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined; if (!old || deps.some((v,i) => v !== old.deps[i])) effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: work() }; }); },
  };
  const module = { exports: {} as { useArrival: typeof useArrival }, __DEV__: false, setInterval: () => 1, clearInterval() {}, require(name: string) {
    if (name === "react") return react;
    if (name === "react-native") return { AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) } };
    if (name === "../domain/arrival") return arrivals;
    if (name === "../domain/location") return location;
    if (name === "../domain/locationIssue") return issue;
    if (name === "../services/location") return { watchLocation: async (callback: typeof gps) => { gps = callback; return () => {}; } };
    if (name === "../services/arrivalStorage") return { saveArrivalCatalog: async () => {} };
    if (name === "../services/backgroundArrival") return { consumePendingArrival: async () => null, observePendingArrival: () => () => {}, resetArrivalCandidate: async () => {}, recordForegroundArrival: async () => lot, markArrivalReported: async () => {} };
    throw Error(name);
  } };
  vm.runInNewContext(ts.transpileModule(readFileSync("src/hooks/useArrival.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, module);
  const render = (account: string) => { cursor = 0; const value = module.exports.useArrival([lot], account); effects.splice(0).forEach(effect => effect()); return value; };
  render("A"); await tick(); gps({ ...lot.coordinate, accuracy: 5, speed: 0, timestamp: Date.now() }); await tick();
  assert.equal(render("A").arrival?.id, lot.id);
  assert.equal(render("B").arrival, null);
  assert.equal(render("A").arrival, null);
});
