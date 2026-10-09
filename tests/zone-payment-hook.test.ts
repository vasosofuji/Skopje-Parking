import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { ZonePaymentDwell } from "../src/domain/zone-payment";
import { paymentFix, paymentNow, paymentZone } from "./fixtures/zone-payment";
import type { ParkingPlace } from "../src/domain/types";

function harness() {
  type Input = { places: ParkingPlace[]; fix: ReturnType<typeof paymentFix> | null; plate: string | null; scope: string | null; focused: boolean; blocked: boolean };
  const state: any[] = [], layout: (() => void)[] = [], effects: (() => void)[] = [], events = new Map<string, (value?: string) => void>();
  const timers = new Map<number, { at: number; callback: () => void }>();
  let cursor = 0, clock = paymentNow, timerId = 0;
  const app = { currentState: "active", addEventListener: (name: string, callback: (value?: string) => void) => { events.set(name, callback); return { remove() { events.delete(name); } }; } };
  const effect = (queue: (() => void)[], callback: () => void, deps?: unknown[]) => {
    const index = cursor++, previous = state[index];
    if (!previous || !deps || deps.some((value, i) => value !== previous.deps[i])) queue.push(() => { previous?.cleanup?.(); state[index] = { deps, cleanup: callback() }; });
  };
  const react = {
    useRef(value: unknown) { const index = cursor++; return state[index] ?? (state[index] = { current: value }); },
    useState(value: unknown) { const index = cursor++; if (!(index in state)) state[index] = value; return [state[index], (next: any) => { state[index] = typeof next === "function" ? next(state[index]) : next; }]; },
    useEffect(callback: () => void, deps: unknown[]) { effect(effects, callback, deps); },
    useLayoutEffect(callback: () => void, deps: unknown[]) { effect(layout, callback, deps); },
    useMemo(callback: () => unknown, deps: unknown[]) { const index = cursor++, previous = state[index]; if (!previous || deps.some((value, i) => value !== previous.deps[i])) state[index] = { deps, value: callback() }; return state[index].value; },
    useCallback(callback: unknown, deps: unknown[]) { return react.useMemo(() => callback, deps); },
  };
  const context = { exports: {} as { useZonePayment: (input: Input) => { place: ParkingPlace | null; validate: (id: string) => ParkingPlace | null; dismiss: () => void } }, Date: { now: () => clock },
    setInterval: () => 0, clearInterval() {}, setTimeout(callback: () => void, delay: number) { const id = ++timerId; timers.set(id, { at: clock + delay, callback }); return id; }, clearTimeout(id: number) { timers.delete(id); },
    require(name: string) { if (name === "react") return react; if (name === "react-native") return { AppState: app, Platform: { OS: "android" } }; if (name === "../domain/zone-payment") return { ZonePaymentDwell }; throw new Error(name); } };
  vm.runInNewContext(ts.transpileModule(readFileSync("src/hooks/useZonePayment.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  let input: Input = { places: [paymentZone], fix: paymentFix(), plate: "SK1234FF", scope: "account", focused: true, blocked: true };
  const render = () => { let result!: ReturnType<typeof context.exports.useZonePayment>; for (let iteration = 0; iteration < 4; iteration++) { cursor = 0; result = context.exports.useZonePayment(input); layout.splice(0).forEach(fn => fn()); effects.splice(0).forEach(fn => fn()); } return result; };
  return { render, change: (next: Partial<Input>) => { input = { ...input, ...next }; return render(); }, advance: (offset: number, fix = true) => { clock = paymentNow + offset; if (fix) input = { ...input, fix: paymentFix(offset) }; for (const [id, timer] of timers) if (timer.at <= clock) { timers.delete(id); timer.callback(); } return render(); }, blur: () => events.get("blur")?.(), background: () => { app.currentState = "background"; events.get("change")?.("background"); } };
}

test("payment queues behind availability/followups and waits for their dismissal before showing", () => {
  const view = harness(); view.render();
  for (const offset of [5000, 10000, 15000]) assert.equal(view.advance(offset).place, null);
  assert.equal(view.change({ blocked: false }).place, null);
  const offer = view.advance(15400, false); assert.equal(offer.place?.id, "gradski:zone:D8");
  assert.equal(offer.validate("gradski:zone:D8")?.id, "gradski:zone:D8");
  view.change({ fix: { ...paymentFix(15500), latitude: 43 } });
  assert.equal(offer.validate("gradski:zone:D8"), null, "a stale button cannot open SMS after leaving");
});

test("known-price paths still prompt after dwell, X dismiss has cooldown, and account/Android blur invalidate immediately", () => {
  const view = harness(); view.change({ blocked: false }); view.advance(400, false);
  for (const offset of [5000, 10000, 15000]) view.advance(offset);
  const offer = view.render(); assert.equal(offer.place?.id, "gradski:zone:D8");
  view.blur(); assert.equal(offer.validate("gradski:zone:D8"), null, "Android notification drawer keeps AppState active but must invalidate SMS");
  const second = harness(); second.change({ blocked: false }); second.advance(400, false);
  for (const offset of [5000, 10000, 15000]) second.advance(offset);
  const opened = second.render(); opened.dismiss(); assert.equal(opened.validate("gradski:zone:D8"), null);
  assert.equal(second.advance(16000).place, null, "X does not immediately repeat");
  second.change({ scope: "different-account" }); assert.equal(opened.validate("gradski:zone:D8"), null);
});

test("an offered payment disappears on background and cannot survive expired evidence", () => {
  const view = harness(); view.change({ blocked: false }); view.advance(400, false);
  for (const offset of [5000, 10000, 15000]) view.advance(offset);
  const offer = view.render(); view.background(); assert.equal(offer.validate("gradski:zone:D8"), null);
  assert.equal(view.render().place, null);
});

test("an offer interrupted by availability or refreshed evidence is not consumed as a dismissal", () => {
  const view = harness(); view.change({ blocked: false }); view.advance(400, false);
  for (const offset of [5000, 10000, 15000]) view.advance(offset);
  assert.equal(view.render().place?.id, "gradski:zone:D8");
  assert.equal(view.change({ blocked: true }).place, null);
  view.advance(16000); view.change({ blocked: false });
  const resumed = view.advance(16400, false);
  assert.equal(resumed.place?.id, "gradski:zone:D8", "availability must release the pending SMS instead of starting an hour cooldown");
  (resumed.dismiss as (remember?: boolean) => void)(false);
  assert.equal(view.advance(17000).place?.id, "gradski:zone:D8", "automatic invalidation can recheck current proof");
});

test("normal ten-second GPS updates can complete stationary payment dwell", () => {
  const view = harness(); view.change({ blocked: false }); view.advance(400, false);
  view.advance(10000);
  assert.equal(view.advance(20000).place?.id, "gradski:zone:D8");
});
