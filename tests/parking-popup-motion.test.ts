import test from "node:test";
import * as languageModule from "../src/domain/language";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as parkingDomain from "../src/domain/parking";
import * as feedbackDomain from "../src/domain/report-feedback";
import * as markerDomain from "../src/domain/marker-appearance";
import * as previewLayout from "../src/domain/preview-layout";
import type { ParkingPlace } from "../src/domain/types";

const transpile = (path: string) => ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
type Element = { type: unknown; props: Record<string, unknown>; children: unknown[] };
type PreviewProps = { place: ParkingPlace; point: { x: number; y: number } | null; mapHeight: number; drawerHeight: number; onClose: () => void; onUpdate: () => void };
const place: ParkingPlace = { id: "one", name: "Parking", kind: "surface", coordinate: { latitude: 42, longitude: 21 }, access: "public", verification: "osm", zoneCode: null, operator: null, tariff: null, capacity: null, openingHours: null, source: { label: "OSM", url: "", retrievedAt: "" } };

function popup(platform = "android") {
  const slots: unknown[] = [], effects: { deps: unknown[]; cleanup?: () => void }[] = [];
  let cursor = 0, effectCursor = 0, stateWrites = 0, removed = 0;
  let pending: (() => void)[] = [];
  let resolveMotion!: (value: boolean) => void, rejectMotion!: (error: Error) => void, motion!: (value: boolean) => void;
  const animations: { config: Record<string, unknown>; starts: number; stops: number }[] = [];
  class Value {
    value: number;
    constructor(value: number) { this.value = value; }
    setValue(value: number) { this.value = value; }
    stopAnimation() {}
    interpolate(config: object) { return { parent: this, config }; }
  }
  const react = {
    createElement: (type: unknown, props: Record<string, unknown>, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    useState(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial; return [slots[index], (next: unknown) => { stateWrites++; slots[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(slots[index]) : next; }]; },
    useRef(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useMemo(create: () => unknown, deps: unknown[]) { const index = cursor++, previous = slots[index] as { deps: unknown[]; value: unknown } | undefined; if (!previous || deps.some((value, i) => value !== previous.deps[i])) slots[index] = { deps, value: create() }; return (slots[index] as { value: unknown }).value; },
    useEffect(effect: () => (() => void) | undefined, deps: unknown[]) { const index = effectCursor++, previous = effects[index]; if (!previous || deps.some((value, i) => value !== previous.deps[i])) pending.push(() => { previous?.cleanup?.(); effects[index] = { deps, cleanup: effect() }; }); },
  };
  const native = {
    ScrollView: "ScrollView", Text: "Text", View: "View", useWindowDimensions: () => ({ width: 390 }),
    Platform: { OS: platform }, Easing: { cubic: "cubic", out: (value: unknown) => value },
    AccessibilityInfo: {
      isReduceMotionEnabled: () => new Promise<boolean>((resolve, reject) => { resolveMotion = resolve; rejectMotion = reject; }),
      addEventListener: (_name: string, listener: typeof motion) => { motion = listener; return { remove: () => { removed++; } }; },
    },
    Animated: { View: "AnimatedView", Value, timing: (_value: unknown, config: Record<string, unknown>) => { const record = { config, starts: 0, stops: 0 }; animations.push(record); return { start: () => { record.starts++; }, stop: () => { record.stops++; } }; } },
  };
  const hook = { exports: {} as { useParkingPopupMotion: (visible: boolean) => unknown }, require(name: string) { if (name === "react") return react; if (name === "react-native") return native; throw new Error(name); } };
  vm.runInNewContext(transpile("src/hooks/useParkingPopupMotion.ts"), hook);
  const component = { exports: {} as { default: (props: PreviewProps) => Element }, require(name: string) {
    if (name === "react") return { ...react, default: react, __esModule: true };
    if (name === "../domain/language") return languageModule;
    if (name === "../hooks/usePriceCheck") return { usePriceCheck: () => () => true };
    if (name === "react-native") return native;
    if (name === "../domain/report-feedback") return feedbackDomain;
    if (name === "./ui") return { Button: "Button", IconButton: "IconButton" };
    if (name === "../state/ThemeContext") return { useTheme: () => ({ colors: { paper: "white", line: "gray", ink: "black", muted: "gray" } }) };
    if (name === "../state/ParkingContext") return { useParking: () => ({ t: (en: string) => en, language: "en", now: Date.now() }) };
    if (name === "../domain/parking") return parkingDomain;
    if (name === "../domain/marker-appearance") return markerDomain;
    if (name === "../domain/preview-layout") return previewLayout;
    if (name === "../hooks/useParkingPopupMotion") return hook.exports;
    if (name === "../services/navigation") return { useNavigationPreference: () => "default" };
    if (name === "../services/parkingNavigation") return { navigateToParking: async () => "" };
    if (name === "./DigitalParkingSign") return { __esModule: true, default: "DigitalParkingSign" };
    throw new Error(`Unexpected popup dependency: ${name}`);
  } };
  vm.runInNewContext(transpile("src/components/ParkingPreview.tsx"), component);
  const render = (point: PreviewProps["point"] = { x: 195, y: 400 }) => {
    cursor = 0; effectCursor = 0;
    const tree = component.exports.default({ place, point, mapHeight: 700, drawerHeight: 94, onClose() {}, onUpdate() {} });
    const queue = pending; pending = []; queue.forEach(effect => effect());
    return tree;
  };
  return {
    render, animations,
    measure: (tree: Element, height = 240) => (tree.props.onLayout as (event: object) => void)({ nativeEvent: { layout: { height } } }),
    resolve: (value: boolean) => resolveMotion(value), reject: () => rejectMotion(new Error("unavailable")), motion: (value: boolean) => motion(value),
    unmount: () => effects.forEach(effect => effect.cleanup?.()), stats: () => ({ stateWrites, removed }),
  };
}
const style = (tree: Element) => Object.assign({}, ...(tree.props.style as object[]).filter(Boolean)) as { opacity: number | { value: number }; transform: unknown[] };
const progress = (tree: Element) => (tree.props.style as { opacity?: { value: number } }[])[1].opacity!.value;

test("popup appears after layout even while motion preference is pending, without replaying on projection updates", async () => {
  const view = popup();
  let tree = view.render();
  assert.equal(tree.props.pointerEvents, "none"); assert.equal(tree.props.accessibilityElementsHidden, true);
  view.measure(tree); tree = view.render();
  assert.equal(tree.props.pointerEvents, "auto"); assert.equal(progress(tree), 1); assert.equal(view.animations.length, 0);
  view.resolve(false); await flush(); tree = view.render();
  assert.equal(tree.type, "AnimatedView"); assert.equal(tree.props.pointerEvents, "auto"); assert.equal(view.animations.length, 0);
  view.render({ x: 180, y: 410 }); view.render({ x: 210, y: 420 });
  assert.equal(view.animations.length, 0);
  tree = view.render(null);
  assert.equal(tree.props.pointerEvents, "none"); assert.equal(tree.props.importantForAccessibility, "no-hide-descendants"); assert.equal(style(tree).opacity, 0);
  tree = view.render({ x: 205, y: 430 });
  assert.equal(view.animations.length, 0); assert.equal(progress(tree), 1); assert.equal(tree.props.pointerEvents, "auto");
  view.unmount(); assert.equal(view.stats().removed, 1);
});

test("an early accessibility result still waits for the first visible projection and measured card", async () => {
  const view = popup(); let tree = view.render(null);
  view.resolve(false); await flush(); tree = view.render(null); view.measure(tree); view.render(null);
  assert.equal(view.animations.length, 0);
  view.render(); assert.equal(view.animations.length, 1);
  assert.equal(view.animations[0].config.duration, 100); assert.equal(view.animations[0].config.useNativeDriver, true); assert.equal(view.animations[0].config.isInteraction, false);
  view.unmount(); assert.equal(view.animations[0].stops, 1);
});

test("Reduce Motion shows a still popup and cannot be overridden by a stale initial read", async () => {
  const view = popup(); let tree = view.render(); view.measure(tree);
  view.motion(true); view.resolve(false); await flush(); tree = view.render();
  assert.equal(view.animations.length, 0); assert.equal(progress(tree), 1); assert.equal(tree.props.pointerEvents, "auto");
  view.motion(false); view.render(); assert.equal(view.animations.length, 0, "changing preference cannot replay an already-visible popup");
  view.unmount();
});

test("enabling Reduce Motion during an entrance stops it and settles immediately", async () => {
  const view = popup(); const tree = view.render(); view.measure(tree); view.resolve(false); await flush(); view.render();
  view.motion(true); const settled = view.render();
  assert.equal(view.animations[0].stops, 1); assert.equal(progress(settled), 1);
  view.unmount();
});

test("rapid selection unmount cancels old work; lookup failure still reveals the next popup without motion", async () => {
  const first = popup(); first.render(); first.unmount(); const writes = first.stats().stateWrites;
  first.resolve(false); await flush(); assert.equal(first.stats().stateWrites, writes); assert.equal(first.animations.length, 0);
  const next = popup(); let tree = next.render(); next.measure(tree); next.reject(); await flush(); tree = next.render();
  assert.equal(next.animations.length, 0); assert.equal(progress(tree), 1); assert.equal(tree.props.pointerEvents, "auto");
  next.unmount();
});

test("web uses its supported animation driver and rapid replacement stops the native entrance", async () => {
  for (const platform of ["web", "android"]) {
    const view = popup(platform); const tree = view.render(); view.measure(tree); view.resolve(false); await flush(); view.render();
    assert.equal(view.animations[0].config.useNativeDriver, platform !== "web");
    view.unmount(); assert.equal(view.animations[0].stops, 1); assert.equal(view.stats().removed, 1);
  }
});
