import test from "node:test";
import * as languageModule from "../src/domain/language";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as entry from "../src/domain/progressive-entry";
import * as geometryDomain from "../src/domain/geometry";
import { availabilityIsFresh } from "../src/domain/entry-drafts";
import type { EntryDraft } from "../src/domain/entry-drafts";
import type { EntrySnapshot } from "../src/domain/progressive-entry";
import type { Geometry, ParkingPlace } from "../src/domain/types";

type Element = { type: unknown; props: Record<string, any>; children: unknown[] };
const source = ts.transpileModule(readFileSync("src/components/ManualParkingWizard.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText + "\nexports.body = WizardBody;";
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function wizard(initial: Record<string, unknown> = {}) {
  const values: unknown[] = [], effects: { deps: unknown[]; cleanup?: () => void }[] = [], calls: unknown[][] = [];
  let cursor = 0, effectCursor = 0, cleared = 0, done = 0, capacityAttempts = 0, back: { onPress: () => void };
  let pending: (() => void)[] = [];
  const react = {
    createElement: (type: unknown, props: Record<string, unknown>, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    useState(value: unknown) { const index = cursor++; if (!(index in values)) values[index] = typeof value === "function" ? (value as () => unknown)() : value; return [values[index], (next: unknown) => { values[index] = next; }]; },
    useRef(value: unknown) { const index = cursor++; if (!(index in values)) values[index] = { current: value }; return values[index]; },
    useCallback: (callback: unknown) => callback,
    useEffect(effect: () => (() => void) | undefined, deps: unknown[]) { const index = effectCursor++, previous = effects[index]; if (!previous || deps.some((value, i) => value !== previous.deps[i])) pending.push(() => { previous?.cleanup?.(); effects[index] = { deps, cleanup: effect() }; }); },
  };
  const context = { exports: {} as { body: (props: Record<string, unknown>) => Element }, require(name: string) {
    if (name === "react") return { ...react, default: react, __esModule: true };
    if (name === "../domain/language") return languageModule;
    if (name === "../hooks/usePriceCheck") return { usePriceCheck: () => () => true };
    if (name === "react-native") return { Keyboard: { dismiss() {} }, Pressable: "Pressable", Text: "Text", TextInput: "TextInput", View: "View", StyleSheet: { create: (value: unknown) => value } };
    if (name === "expo-crypto") return { randomUUID: () => "fixed-request" };
    if (name === "./ui") return { Button: "Button", Icon: "Icon", Note: "Note", useSheetReveal: () => ({}), useSheetBack: (action: typeof back) => { back = action; }, useSheetContinue: () => false };
    if (name === "./PaymentScheduleFields") return { default: "PaymentScheduleFields" };
    if (name === "./LoadingIndicator") return { default: "LoadingIndicator" };
    if (name === "../state/ParkingContext") return { useParking: () => ({ t: (en: string) => en, refresh: async () => {} }) };
    if (name === "../state/AccountContext") return { useAccount: () => ({ profile: { id: "account-a" } }) };
    if (name === "../state/ContributionFeedback") return { useContributionFeedback: () => ({ thankYou: () => calls.push(["thankYou"]) }) };
    if (name === "../state/ThemeContext") return { useTheme: () => ({ colors: {} }) };
    if (name === "../domain/parking") return { normalizeZoneCode: (value: string) => value.trim().toUpperCase(), parkingPrice: () => null };
    if (name === "../domain/progressive-entry") return entry;
    if (name === "../domain/geometry") return geometryDomain;
    if (name === "../services/entryDrafts") return { availabilityIsFresh, createEntryDraftStore: () => ({ update: async (patch: unknown) => { calls.push(["draft", patch]); }, clear: async () => { cleared++; } }) };
    if (name === "../services/api") return { api: { progressiveWriter: async () => ({ contribute: async () => { calls.push(["create"]); return { id: "park-1", zoneCode: null, capacity: null } as ParkingPlace; }, ...Object.fromEntries(["label", "price", "paymentSchedule", "capacity", "report", "boundary"].map(method => [method, async (...args: unknown[]) => { calls.push([method, ...args]); if (method === "capacity" && initial.failCapacityOnce && ++capacityAttempts === 1) throw new Error("offline"); }])) }) } };
    throw new Error(`Unexpected wizard dependency: ${name}`);
  } };
  vm.runInNewContext(source, context);
  const props = { coordinate: { latitude: 42, longitude: 21.43 }, restored: null, draftKey: "account-a:coordinate", accountId: "account-a", onDone: () => { done++; }, ...initial };
  function render() { cursor = 0; effectCursor = 0; const tree = context.exports.body(props); const queued = pending; pending = []; queued.forEach(effect => effect()); return tree; }
  function nodes(tree: unknown): Element[] { if (Array.isArray(tree)) return tree.flatMap(nodes); if (!tree || typeof tree !== "object" || !("children" in tree)) return []; const element = tree as Element; if (typeof element.type === "function") return nodes(element.type({ ...element.props, children: element.children })); return [element, ...element.children.flatMap(nodes)]; }
  return { render, nodes, calls, back: () => back.onPress(), stats: () => ({ cleared, done }), tap(tree: Element, label: string) { const node = nodes(tree).find(item => item.props.title === label || item.props.accessibilityLabel === label); assert.ok(node, `Missing ${label}`); node.props.onPress(); }, input(tree: Element, label: string, value: string) { const node = nodes(tree).find(item => item.type === "TextInput" && item.props.accessibilityLabel === label); assert.ok(node, `Missing ${label}`); node.props.onChangeText(value); } };
}

test("simple manual flow only exposes zone Skip and requires paid or free pricing", async () => {
  const form = wizard(); let tree = form.render(); form.tap(tree, "Simple entry"); tree = form.render();
  form.tap(tree, "Skip"); await flush(); tree = form.render();
  assert.ok(!form.nodes(tree).some(item => item.props.title === "Skip"));
  assert.ok(form.nodes(tree).some(item => item.props.title === "Back"));
  form.tap(tree, "Next"); await flush(); tree = form.render();
  assert.equal(form.calls.filter(call => call[0] === "price").length, 0);
  form.tap(tree, "It's free"); await flush(); tree = form.render();
  assert.deepEqual(form.calls.find(call => call[0] === "price"), ["price", "park-1", 0, 0]);
  form.tap(tree, "Done"); await flush(); assert.deepEqual(form.stats(), { cleared: 1, done: 1 });
});
test("detailed entry directly opens optional sections and saves only entered values", async () => {
  const form = wizard(); let tree = form.render(); form.tap(tree, "Detailed entry"); tree = form.render();
  assert.ok(!form.nodes(tree).some(item => item.props.title === "Skip" || item.props.title === "Next"));
  form.tap(tree, "Total parking spaces"); tree = form.render();
  assert.ok(!form.nodes(tree).some(item => item.props.accessibilityLabel === "Free right now"));
  form.input(tree, "Total parking spaces", "20"); tree = form.render();
  form.tap(tree, "Price"); tree = form.render(); form.tap(tree, "It's free"); tree = form.render();
  form.tap(tree, "Done"); await flush();
  assert.deepEqual(form.calls.filter(call => ["capacity", "price", "report", "boundary"].includes(String(call[0]))), [["price", "park-1", 0, 0], ["capacity", "park-1", 20]]);
  assert.deepEqual(form.stats(), { cleared: 1, done: 1 });
  assert.equal(form.calls.filter(call => call[0] === "thankYou").length, 1);
});

test("detailed entry validates entered sections before creating or saving any values", async () => {
  const form = wizard(); let tree = form.render(); form.tap(tree, "Detailed entry"); tree = form.render();
  form.tap(tree, "Price"); tree = form.render(); form.input(tree, "MKD / first hour", "30"); tree = form.render();
  form.tap(tree, "Total parking spaces"); tree = form.render(); form.input(tree, "Total parking spaces", "1.5"); tree = form.render();
  form.tap(tree, "Done"); await flush(); tree = form.render();
  assert.equal(form.calls.filter(call => call[0] === "price").length, 0);
  assert.equal(form.calls.filter(call => call[0] === "create").length, 0);
  assert.deepEqual(form.stats(), { cleared: 0, done: 0 });
  form.input(tree, "Total parking spaces", "12"); tree = form.render(); form.tap(tree, "Done"); await flush();
  assert.deepEqual(form.stats(), { cleared: 1, done: 1 });
});

test("detailed entry can finish with all optional fields blank and back collapses a section", async () => {
  const form = wizard(); let tree = form.render(); form.tap(tree, "Detailed entry"); tree = form.render();
  form.tap(tree, "Zone label"); tree = form.render();
  assert.ok(form.nodes(tree).some(item => item.type === "TextInput"));
  form.back(); tree = form.render(); assert.ok(!form.nodes(tree).some(item => item.type === "TextInput"));
  form.tap(tree, "Done"); await flush();
  assert.deepEqual(form.stats(), { cleared: 1, done: 1 });
  assert.equal(form.calls.filter(call => ["price", "capacity", "paymentSchedule"].includes(String(call[0]))).length, 0);
  assert.equal(form.calls.filter(call => call[0] === "thankYou").length, 0);
});

test("expanded zone and capacity sections have a single visible heading", () => {
  const form = wizard(); let tree = form.render(); form.tap(tree, "Detailed entry"); tree = form.render();
  for (const title of ["Zone label", "Total parking spaces"]) {
    form.tap(tree, title); tree = form.render();
    assert.equal(form.nodes(tree).filter(item => item.type === "Text" && item.children.includes(title)).length, 1);
    assert.equal(form.nodes(tree).filter(item => item.type === "TextInput" && item.props.accessibilityLabel === title).length, 1);
  }
});

test("retrying detailed entry preserves successful fields without duplicating the pin", async () => {
  const form = wizard({ failCapacityOnce: true }); let tree = form.render(); form.tap(tree, "Detailed entry"); tree = form.render();
  form.tap(tree, "Price"); tree = form.render(); form.input(tree, "MKD / first hour", "30"); tree = form.render();
  form.tap(tree, "Total parking spaces"); tree = form.render(); form.input(tree, "Total parking spaces", "12"); tree = form.render();
  form.tap(tree, "Done"); await flush(); tree = form.render();
  assert.deepEqual(form.stats(), { cleared: 0, done: 0 });
  form.tap(tree, "Retry saving"); await flush();
  assert.deepEqual(form.stats(), { cleared: 1, done: 1 });
  assert.equal(form.calls.filter(call => call[0] === "create").length, 1);
  assert.equal(form.calls.filter(call => call[0] === "price").length, 1);
  assert.equal(form.calls.filter(call => call[0] === "capacity").length, 2);
});
test("a boundary returned after Android Modal remount overrides the draft and saves immediately", async () => {
  const oldGeometry: Geometry = { type: "Polygon", coordinates: [[[21.43, 42], [21.431, 42], [21.431, 42.001], [21.43, 42]]] };
  const geometry: Geometry = { type: "Polygon", coordinates: [[[21.43, 42], [21.432, 42], [21.432, 42.001], [21.43, 42]]] };
  const snapshot: EntrySnapshot = { id: "park-1", code: null, price: "0:0", total: 20, free: 0, boundary: JSON.stringify(oldGeometry) };
  const restored: EntryDraft = { version: 1, requestId: "fixed-request", updatedAt: Date.now(), step: "perimeter", detailed: true, code: "", first: "0", next: "0", capacity: "20", freeSpaces: "0", freeObservedAt: Date.now(), geometry: oldGeometry, snapshot, pending: null };
  const form = wizard({ restored, geometry: oldGeometry, returnedGeometry: geometry }); form.render(); await flush(); const tree = form.render();
  assert.equal(form.calls.filter(call => call[0] === "boundary").length, 1);
  assert.equal(JSON.stringify(form.calls.find(call => call[0] === "boundary")?.[2]), JSON.stringify(geometry));
  form.tap(tree, "Done"); await flush(); assert.deepEqual(form.stats(), { cleared: 1, done: 1 });
});
