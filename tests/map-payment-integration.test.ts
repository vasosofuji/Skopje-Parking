import test from "node:test";
import * as languageModule from "../src/domain/language";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as filters from "../src/domain/parking-filters";
import * as parking from "../src/domain/parking";
import * as arrival from "../src/domain/arrival";
import * as geometry from "../src/domain/geometry";
import * as location from "../src/domain/location";
import * as locationIssue from "../src/domain/locationIssue";
import * as mapCamera from "../src/domain/map-selection-camera";
import * as zonePayment from "../src/domain/zone-payment";
import * as smsPayment from "../src/domain/sms-payment";
import { defaultMapNavigationState } from "../src/domain/mapNavigationState";
import * as feedback from "../src/domain/report-feedback";
import { MARKER_COLORS } from "../src/domain/marker-appearance";
import { paymentFix, paymentNow, paymentZone } from "./fixtures/zone-payment";
import type { ParkingPlace } from "../src/domain/types";

type Element = { type: string; props: Record<string, any>; children: unknown[] };
const nodes = (value: unknown): Element[] => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object" && "children" in value ? [value as Element, ...(value as Element).children.flatMap(nodes)] : [];
function harness(zoneOnly = false, restored = false) {
  const priced: ParkingPlace = { ...paymentZone, tariff: { firstHour: 25, nextHour: 25, maxStayMinutes: null, evidence: "official", source: paymentZone.source } };
  const facility: ParkingPlace = { ...priced, id: "facility", kind: "surface", name: "Parking" };
  const backHandlers: (() => boolean)[] = [];
  const state: unknown[] = [], effects: (() => void)[] = [], timers: (() => void)[] = [], payments: any[] = [], reports: string[] = [];
  let cursor = 0, focused = true, offerPlate = false, accountId = "account";
  let resetNavigation: ((value: unknown) => void) | undefined;
  const savedPoint = { latitude: 42.01, longitude: 21.41 };
  const gps = { location: paymentFix() as ReturnType<typeof paymentFix> | null, initialLocation: null as { latitude: number; longitude: number } | null, accuracy: 5, status: "ready", issue: null, arrival: (zoneOnly ? priced : facility) as ParkingPlace | null, arrivalFromNotification: false, reported: async () => {}, dismiss() { gps.arrival = null; }, retry() {} };
  const react = { Fragment: "Fragment", createElement: (type: string, props: Record<string, any>, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }), useState(value: unknown) { const index = cursor++; if (!(index in state)) state[index] = typeof value === "function" ? value() : value; return [state[index], (next: any) => { state[index] = typeof next === "function" ? next(state[index]) : next; }]; }, useRef(value: unknown) { const index = cursor++; return state[index] ?? (state[index] = { current: value }); }, useEffect(fn: () => void) { effects.push(fn); }, useLayoutEffect(fn: () => void) { effects.push(fn); }, useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn };
  const context = { exports: {} as { default: () => Element }, setTimeout: (fn: () => void) => { timers.push(fn); return 0; }, clearTimeout() {}, require(name: string) {
    if (name === "react") return { ...react, default: react, __esModule: true };
    if (name === "../domain/language") return languageModule;
    if (name === "../hooks/usePriceCheck") return { usePriceCheck: () => () => true };
    if (name === "react-native") return { BackHandler: { addEventListener: (_event: string, handler: () => boolean) => { backHandlers.push(handler); return { remove() { backHandlers.splice(backHandlers.indexOf(handler), 1); } }; } }, Keyboard: { dismiss() {} }, Platform: { OS: "web" }, Pressable: "Pressable", Text: "Text", TextInput: "TextInput", View: "View", StyleSheet: { create: (value: unknown) => value, absoluteFill: {} } };
    if (name === "react-native-safe-area-context") return { SafeAreaView: "SafeAreaView" };
    if (name === "expo-router") return { router: { push() {} }, useIsFocused: () => focused };
    if (name === "../state/ParkingContext") return { useParking: () => ({ catalog: { places: [priced, facility], destinations: [] }, connected: true, now: paymentNow, language: "en", t: (en: string) => en, refresh: async () => {}, latestCatalog: async () => ({ places: [priced, facility] }) }) };
    if (name === "../state/ThemeContext") return { useTheme: () => ({ colors: {}, dark: false }) };
    if (name === "../state/ContributionFeedback") return { useContributionFeedback: () => ({ thankYou() {} }) };
    if (name === "../state/SettingsLocationContext") return { useMapSettingsLocation() {} };
    if (name === "../state/LicensePlateContext") return { useLicensePlate: () => ({ savedPlate: "SK1234FF", accountId, ready: true, offerPlate, pendingStop: null }) };
    if (name === "../hooks/useArrival") return { useArrival: () => gps };
    if (name === "../hooks/useMapNavigationState") return { useMapNavigationState: () => {
      const [value, update] = react.useState({ ...defaultMapNavigationState(), ...(restored ? { viewport: savedPoint } : {}) }) as [ReturnType<typeof defaultMapNavigationState>, (value: unknown) => void];
      resetNavigation = update;
      const setter = (field: string) => (next: unknown) => update((previous: Record<string, unknown>) => ({ ...previous, [field]: typeof next === "function" ? next(previous[field]) : next }));
      return { ...value, center: value.viewport, ready: true, restored, setCenter: setter("viewport"), rememberViewport: setter("viewport"), setDestination: setter("destination"), setSelected: setter("selected"), setAnchor: setter("anchor"), setSort: setter("sort"), setParkingFilters: setter("parkingFilters") };
    } };
    if (name === "../hooks/usePocCards") return { usePocCards: () => ({ record() {}, zone: null, dismiss() {} }) };
    if (name === "../hooks/useZonePayment") return { useZonePayment: (input: unknown) => { payments.push(input); return { place: null, validate() {}, dismiss() {} }; } };
    if (name === "../domain/parking-filters") return filters;
    if (name === "../domain/parking") return parking;
    if (name === "../domain/arrival") return arrival;
    if (name === "../domain/geometry") return geometry;
    if (name === "../domain/location") return location;
    if (name === "../domain/locationIssue") return locationIssue;
    if (name === "../domain/map-selection-camera") return mapCamera;
    if (name === "../domain/zone-payment") return zonePayment;
    if (name === "../domain/sms-payment") return smsPayment;
    if (name === "../domain/report-feedback") return feedback;
    if (name === "../domain/marker-appearance") return { MARKER_COLORS };
    if (name === "../services/api") return { api: { report: async (_id: string, status: string) => { reports.push(status); } } };
    if (name === "../components/ui") return { Button: "Button", Sheet: "Sheet", Note: "Note", Icon: "Icon", IconButton: "IconButton", RevealSection: "RevealSection" };
    if (name === "../components/ZonePaymentSheet") return { default: "ZonePaymentSheet", ParkingSmsStopSheet: "ParkingSmsStopSheet", PayParkingChooser: "PayParkingChooser", __esModule: true };
    if (name.startsWith("../components/")) return { default: name, __esModule: true };
    throw new Error(name);
  } };
  vm.runInNewContext(ts.transpileModule(readFileSync("src/screens/MapScreen.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, context);
  const render = () => { cursor = 0; effects.length = 0; return context.exports.default(); };
  return { render, gps, savedPoint, back: () => backHandlers.at(-1)?.() ?? false, switchAccount: () => { accountId = "second"; restored = false; resetNavigation?.(defaultMapNavigationState()); }, payment: () => payments.at(-1), reports, runEffects: () => { effects.splice(0).forEach(fn => fn()); timers.splice(0).forEach(fn => fn()); }, plateOffer: () => { offerPlate = true; }, blur: () => { focused = false; } };
}

test("actual MapScreen queues SMS while availability is open and releases it after a successful Yes report", async () => {
  const view = harness(); const tree = view.render();
  assert.equal(view.payment().blocked, true);
  const sheet = nodes(tree).find(node => node.type === "Sheet" && node.props.title === "Any free spaces here?")!;
  assert.equal(sheet.props.visible, true);
  nodes(sheet).find(node => node.type === "Button" && node.props.title === "Yes")!.props.onPress();
  await new Promise<void>(resolve => setImmediate(resolve)); view.render();
  assert.deepEqual(view.reports, ["spaces"]); assert.equal(view.payment().blocked, false);
});

test("a known-price zone never asks availability (the API rejects it) or holds SMS back; plate setup and route blur still block", () => {
  const view = harness(true); view.render(); assert.equal(view.payment().blocked, true);
  view.runEffects(); view.render();
  assert.equal(view.gps.arrival, null, "the unanswerable zone question is dismissed");
  assert.equal(view.payment().blocked, false);
  view.plateOffer(); const tree = view.render(); assert.equal(view.payment().blocked, true);
  assert.equal(nodes(tree).find(node => node.type === "Sheet" && node.props.title === "Any free spaces here?")!.props.visible, false);
  view.blur(); view.render(); assert.equal(view.payment().focused, false);
});

test("restored camera survives startup, then Near me can wait for GPS and recenter", () => {
  const view = harness(false, true);
  view.gps.location = null; view.gps.arrival = null;
  const map = (tree: Element) => nodes(tree).find(node => node.type === "../components/ParkingMap")!;
  view.render(); view.runEffects();
  const restored = view.render();
  assert.deepEqual(map(restored).props.destination, view.savedPoint);
  nodes(restored).find(node => node.type === "IconButton" && node.props.label === "Parking near me")!.props.onPress();
  view.render(); view.runEffects();
  const fresh = { latitude: 42.02, longitude: 21.44 };
  view.gps.initialLocation = { latitude: 42.1, longitude: 21.1 };
  view.render(); view.runEffects();
  assert.deepEqual(map(view.render()).props.destination, view.savedPoint, "a retained startup position cannot fulfill a new GPS request");
  view.gps.initialLocation = fresh;
  view.gps.location = { ...paymentFix(), ...fresh, timestamp: Date.now() };
  view.render(); view.runEffects();
  assert.deepEqual({ ...map(view.render()).props.destination }, fresh);
  assert.equal(map(view.render()).props.cameraZoom, 18);
});

test("Near me centers the latest usable fix at the same close zoom on repeated taps", () => {
  const view = harness(false, true);
  view.gps.arrival = null;
  const latest = { latitude: 42.025, longitude: 21.445 };
  view.gps.location = { ...paymentFix(), ...latest, timestamp: Date.now() };
  view.gps.initialLocation = { latitude: 42.01, longitude: 21.41 };
  view.render(); view.runEffects();
  let tree = view.render();
  const nearMe = () => nodes(tree).find(node => node.type === "IconButton" && node.props.label === "Parking near me")!.props.onPress();
  const map = () => nodes(tree).find(node => node.type === "../components/ParkingMap")!;
  nearMe(); tree = view.render();
  assert.deepEqual({ ...map().props.destination }, latest);
  assert.equal(map().props.cameraZoom, 18);
  const revision = map().props.cameraRevision;
  nearMe(); tree = view.render();
  assert.equal(map().props.cameraZoom, 18);
  assert.equal(map().props.cameraRevision, revision + 1, "a second tap recenters even if coordinates are unchanged");
});

test("starting destination picking or drawing cancels a pending Near me GPS request", () => {
  for (const action of ["onDestination", "onDraw"]) {
    const view = harness(false, true);
    view.gps.location = null; view.gps.arrival = null;
    view.render(); view.runEffects();
    let tree = view.render();
    nodes(tree).find(node => node.type === "IconButton" && node.props.label === "Parking near me")!.props.onPress();
    tree = view.render(); view.runEffects();
    nodes(tree).find(node => node.type === "../components/MapDrawer")!.props[action]();
    view.gps.location = { ...paymentFix(), latitude: 42.025, longitude: 21.445, timestamp: Date.now() };
    view.render(); view.runEffects(); tree = view.render();
    const map = nodes(tree).find(node => node.type === "../components/ParkingMap")!;
    assert.deepEqual(map.props.destination, view.savedPoint);
    assert.equal(map.props.cameraZoom, 15);
    assert.equal(map.props.selectionEnabled, false);
    assert.equal(map.props.picking, action === "onDraw");
  }
});

test("switching directly between accepted accounts resets prior camera intent", () => {
  const view = harness(false, true);
  view.render(); view.runEffects();
  const fresh = { latitude: 42.03, longitude: 21.45 };
  view.gps.initialLocation = fresh;
  view.switchAccount(); view.render(); view.runEffects();
  const map = nodes(view.render()).find(node => node.type === "../components/ParkingMap")!;
  assert.deepEqual(map.props.destination, fresh);
});

test("Android Back closes the parking popup or leaves drawing before it can leave the app", () => {
  const view = harness(false, true);
  view.gps.arrival = null;
  const map = (tree: Element) => nodes(tree).find(node => node.type === "../components/ParkingMap")!;
  let tree = view.render(); view.runEffects();
  assert.equal(view.back(), false, "nothing open: Android handles Back");
  map(tree).props.onSelect(map(tree).props.places.find((place: ParkingPlace) => place.kind !== "zone"));
  tree = view.render(); view.runEffects();
  assert.ok(map(tree).props.selectedId);
  assert.equal(view.back(), true);
  tree = view.render(); view.runEffects();
  assert.equal(map(tree).props.selectedId, null);
  nodes(tree).find(node => node.type === "../components/MapDrawer")!.props.onDraw();
  tree = view.render(); view.runEffects();
  assert.equal(map(tree).props.drawing, true);
  assert.equal(view.back(), true);
  assert.equal(map(view.render()).props.drawing, false);
});
