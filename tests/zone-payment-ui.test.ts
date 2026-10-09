import test from "node:test";
import * as paymentHours from "../src/domain/payment-hours";
import * as languageModule from "../src/domain/language";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { isOfficialProtocol, isVerifiedSmsPayment } from "../src/domain/sms-payment";
import * as skopjeRules from "../src/domain/skopje-rules";
import * as zonePayment from "../src/domain/zone-payment";
import { parkingPrice } from "../src/domain/parking";
import { paymentZone, verified } from "./fixtures/zone-payment";
import type { ParkingPlace } from "../src/domain/types";

type Element = { type: string; props: Record<string, any>; children: unknown[] };
const nodes = (value: unknown): Element[] => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object" && "children" in value ? [value as Element, ...(value as Element).children.flatMap(nodes)] : [];
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const now = Date.parse("2026-10-05T10:00:00Z");
function harness(stop = false, manual = false) {
  const state: any[] = [], effects: (() => void)[] = [], layout: (() => void)[] = [], calls: { recipient: string; body: string; guard: () => boolean }[] = [], stored: unknown[] = [], reminders: unknown[][] = [];
  let cursor = 0, valid = true, closed = 0, invalidated = 0, result = "opened", place: ParkingPlace | null = paymentZone;
  let account = { accountId: "account", ready: true, savedPlate: "SK1234FF", pendingStop: { zoneId: "gradski:zone:D8", zoneName: "Zone D8", recipient: "144144", stopMessage: "S", photoId: "official:gradski", protocolExpiresAt: verified.expiresAt, openedAt: 0, plate: "SK1234FF" }, setPendingStop: async (value: unknown) => { stored.push(value); }, clearPendingStop: async () => { stored.push("cleared"); } };
  const requests: { resolve: (value: { place: ParkingPlace; protocol: typeof verified }) => void; reject: (reason: unknown) => void }[] = [];
  const translate = (en: string) => en, latestCatalog = async () => ({ places: place ? [place] : [] });
  const effect = (queue: (() => void)[], fn: () => void, deps?: unknown[]) => { const index = cursor++, previous = state[index]; if (!previous || !deps || deps.some((value, i) => value !== previous.deps[i])) queue.push(() => { previous?.cleanup?.(); state[index] = { deps, cleanup: fn() }; }); };
  const react = { Fragment: "Fragment", createElement: (type: string, props: Record<string, any>, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }), useRef(value: unknown) { const index = cursor++; return state[index] ?? (state[index] = { current: value }); }, useState(value: unknown) { const index = cursor++; if (!(index in state)) state[index] = typeof value === "function" ? value(state[index]) : value; return [state[index], (value: unknown) => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; }, useEffect: (fn: () => void, deps?: unknown[]) => effect(effects, fn, deps), useLayoutEffect: (fn: () => void, deps?: unknown[]) => effect(layout, fn, deps), useMemo: (fn: () => unknown) => fn() };
  const context = { exports: {} as { default: (props: any) => Element; ParkingSmsStopSheet: (props: any) => Element }, Date: class extends Date { static now() { return Date.parse("2026-10-05T10:00:00Z"); } }, require(name: string) {
    if (name === "react") return { ...react, default: react, __esModule: true };
    if (name === "../domain/language") return languageModule;
    if (name === "../hooks/usePriceCheck") return { usePriceCheck: () => () => true };
    if (name === "react-native") return { AppState: { currentState: "active" }, Image: "Image", Text: "Text", View: "View", Pressable: "Pressable", Linking: { openURL: async () => {} } };
    if (name === "../state/LicensePlateContext") return { useLicensePlate: () => account };
    if (name === "../state/ParkingContext") return { useParking: () => ({ t: translate, now, latestCatalog }) };
    if (name === "../state/ThemeContext") return { useTheme: () => ({ colors: { ink: "black", green: "green" } }) };
    if (name === "./ui") return { Sheet: "Sheet", Button: "Button", Note: "Note", Icon: "Icon" };
    if (name === "./LicensePlateEditor") return { default: "LicensePlateEditor", __esModule: true };
    if (name === "../domain/sms-payment") return { isOfficialProtocol, isVerifiedSmsPayment: (value: typeof verified) => isVerifiedSmsPayment(value, now) };
    if (name === "../domain/skopje-rules") return skopjeRules;
    if (name === "../domain/zone-payment") return zonePayment;
    if (name === "../services/parkingReminder") return { scheduleParkingLimitReminder: async (...args: unknown[]) => { reminders.push(args); return true; }, cancelParkingLimitReminder: async () => { reminders.push(["cancel"]); } };
    if (name === "../domain/parking") return { parkingPrice };
    if (name === "../domain/payment-hours") return paymentHours;
    if (name === "../services/api") return { api: { smsPayment: () => new Promise((resolve, reject) => requests.push({ resolve, reject })) } };
    if (name === "../services/smsComposer") return { openSmsComposer: async (recipient: string, body: string, guard: () => boolean) => { calls.push({ recipient, body, guard }); return guard() ? result : "cancelled"; } };
    throw new Error(name);
  } };
  vm.runInNewContext(ts.transpileModule(readFileSync("src/components/ZonePaymentSheet.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, context);
  const validate = () => valid ? place : null, onClose = () => { closed++; valid = false; };
  const onInvalidated = () => { invalidated++; valid = false; };
  const render = () => { cursor = 0; const tree = stop ? context.exports.ParkingSmsStopSheet({ visible: true, onClose }) : context.exports.default({ place, validate, onClose, onInvalidated, manual }); layout.splice(0).forEach(fn => fn()); effects.splice(0).forEach(fn => fn()); return tree; };
  /** The driver ticks "the sign at my car shows zone ..." before Open SMS is enabled. */
  const confirmSign = () => { nodes(render()).find(node => node.type === "Pressable" && node.props.accessibilityRole === "checkbox")!.props.onPress(); return render(); };
  return { render, confirmSign, reminders, calls, stored, requests, setPlate: (value: string | null) => { account = { ...account, savedPlate: value as string }; }, closed: () => closed, invalidated: () => invalidated, hide: () => { place = null; }, invalidate: () => { valid = false; }, changePlate: () => { account = { ...account, savedPlate: "SK9999FF" }; }, protocol: (next: typeof verified) => { place = { ...paymentZone, smsPayment: next }; }, respond: async (protocol = place!.smsPayment!) => { requests.shift()!.resolve({ place: place!, protocol }); await flush(); }, fail: async () => { requests.shift()!.reject(new Error("Network unavailable")); await flush(); }, unsupported: () => { result = "unsupported"; } };
}

test("the actual initial map render without a payment place stays hidden and never reads null choice/proof", () => {
  const view = harness(); view.hide(); const tree = view.render();
  assert.equal(tree.props.visible, false); assert.equal(tree.props.footer.props.disabled, true);
  assert.equal(view.requests.length, 0); assert.equal(view.calls.length, 0);
});

test("payment exposes no recipient/message until fresh proof, then opens only the displayed SMS and retains stop draft", async () => {
  const view = harness(); let tree = view.render();
  assert.equal(nodes(tree).some(node => node.type === "Image"), false);
  assert.equal(tree.props.footer.props.disabled, true);
  await view.respond(); tree = view.render();
  assert.equal(tree.props.footer.props.disabled, true, "the driver must compare the zone with the sign first");
  tree = view.confirmSign();
  assert.equal(tree.props.footer.props.disabled, false);
  assert.ok(nodes(tree).some(node => node.type === "Button" && node.props.title === "Operator website"), "official rules link to the operator");
  tree.props.footer.props.onPress(); await view.respond(); tree = view.render();
  assert.equal(view.calls.length, 1); assert.equal(view.calls[0].recipient, "144144"); assert.equal(view.calls[0].body, "D8 SK1234FF");
  assert.equal((view.stored[0] as any).stopMessage, "S"); assert.equal(view.closed(), 1);
});

test("stale leave/close before fresh send validation cannot open SMS", async () => {
  const view = harness(); view.render(); await view.respond(); const tree = view.confirmSign();
  tree.props.footer.props.onPress(); view.invalidate(); await view.respond();
  assert.equal(view.calls.length, 0); assert.equal(view.stored.length, 0);
});

test("fixed-hours choices are explicit and do not carry across a changed protocol", async () => {
  const fixed = { ...verified, destination: "141414", mode: "fixed-hours" as const, startTemplate: "{zone} {plate} {hours}", stopTemplate: null, allowedHours: [1, 2], evidence: { ...verified.evidence, destinationText: "141414", sampleHours: 1, startExample: "D8 SK1234FF 1", stopExample: null, stopInstructionText: null, durationText: "1, 2 hours" } };
  const view = harness(); view.protocol(fixed); view.render(); await view.respond(fixed); let tree = view.confirmSign();
  assert.equal(tree.props.footer.props.disabled, true);
  assert.ok(JSON.stringify(tree).includes("D8 SK1234FF …"), "the message shows zone and plate, not raw placeholders");
  nodes(tree).find(node => node.type === "Button" && node.props.title === "1 hour")!.props.onPress(); tree = view.render(); assert.equal(tree.props.footer.props.disabled, false);
  view.protocol({ ...fixed, allowedHours: [2, 3], evidence: { ...fixed.evidence, sampleHours: 2, startExample: "D8 SK1234FF 2", durationText: "2, 3 hours" } }); tree = view.render();
  assert.equal(tree.props.footer.props.disabled, true);
});

test("stop SMS uses the original parked plate after edits and retains reminder after composer open", async () => {
  const view = harness(true); view.changePlate(); const tree = view.render();
  tree.props.footer.props.onPress(); await view.respond();
  assert.equal(view.calls.length, 1); assert.equal(view.calls[0].body, "S"); assert.equal(view.stored.length, 0, "opening a composer does not claim parking stopped");
});

test("a failed payment check keeps the prompt open with retry instead of consuming its cooldown", async () => {
  const view = harness(); view.render(); await view.fail();
  const failed = view.render();
  assert.equal(failed.props.visible, true); assert.equal(failed.props.footer.props.disabled, true);
  assert.equal(view.closed(), 0); assert.equal(view.invalidated(), 0);
  nodes(failed).find(node => node.type === "Button" && node.props.title === "Retry")!.props.onPress();
  view.render(); await view.respond();
  assert.equal(view.confirmSign().props.footer.props.disabled, false);
});

test("fresh proof mismatch uses invalidation rather than deliberate payment dismissal", async () => {
  const view = harness(); view.render(); await view.respond({ ...verified, photoId: "new-proof" });
  assert.equal(view.invalidated(), 1); assert.equal(view.closed(), 0);
  assert.equal(view.calls.length, 0);
});

test("a payment rule changed before Open SMS refreshes the offer without opening stale SMS", async () => {
  const view = harness(); view.render(); await view.respond();
  view.confirmSign().props.footer.props.onPress();
  await view.respond({ ...verified, photoId: "replacement-proof" });
  assert.equal(view.invalidated(), 1); assert.equal(view.closed(), 0); assert.equal(view.calls.length, 0);
});

const gradskiA3 = skopjeRules.officialSmsPayment({ id: "gradski:zone:A3", kind: "zone" })!;
test("official Gradski rules show the operator instead of a photo, need the sign check, and remind before the 2-hour limit", async () => {
  const view = harness(); view.protocol(gradskiA3); view.render(); await view.respond(gradskiA3);
  let tree = view.render();
  const text = JSON.stringify(tree);
  assert.equal(nodes(tree).some(node => node.type === "Image"), false);
  assert.ok(nodes(tree).some(node => node.type === "Button" && node.props.title === "Call operator"));
  assert.match(text, /Maximum stay/); assert.match(text, /The sign at my car shows zone/);
  assert.equal(tree.props.footer.props.disabled, true);
  tree = view.confirmSign(); tree.props.footer.props.onPress(); await view.respond(gradskiA3); await flush();
  assert.deepEqual(view.calls.map(call => [call.recipient, call.body]), [["144144", "A3 SK1234FF"]]);
  assert.equal((view.stored[0] as any).photoId, "official:gradski");
  assert.equal(view.reminders.length, 1);
  assert.equal(view.reminders[0][0], (view.stored[0] as any).openedAt + 105 * 60_000, "reminds 15 minutes before the limit");
});

test("manual payment without a saved plate asks for one on the device before any SMS", () => {
  const view = harness(false, true); view.setPlate(null); const tree = view.render();
  assert.equal(tree.props.visible, true); assert.equal(tree.props.footer, undefined);
  assert.ok(nodes(tree).some(node => node.type === "LicensePlateEditor"));
  assert.equal(view.calls.length, 0);
});
