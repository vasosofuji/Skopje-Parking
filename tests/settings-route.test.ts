import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import type { Fix } from "../src/domain/arrival";
import type { LocationIssue } from "../src/domain/locationWatch";

type Element = { type: unknown; props: Record<string, any>; children: unknown[] };
const transpile = (path: string) => ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const fix: Fix = { latitude: 42, longitude: 21, accuracy: 8, timestamp: Date.now(), speed: null };
function nodes(value: unknown): Element[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("children" in value)) return []; const node = value as Element; return [node, ...node.children.flatMap(nodes)]; }

function route(bridged = false) {
  const state: unknown[] = []; let cursor = 0, cleanup: (() => void) | undefined;
  const calls: string[] = [], watchers: { fix: (fix: Fix) => void; issue: (issue: LocationIssue) => void; resolve: (stop: () => void) => void }[] = [];
  let canBack = true, focused = true;
  const react = {
    Fragment: "Fragment", createElement: (type: unknown, props: Record<string, any>, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    useState(initial: unknown) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], (value: unknown) => { state[index] = value; }]; },
    useRef(initial: unknown) { const index = cursor++; return state[index] ?? (state[index] = { current: initial }); },
    useEffect(callback: () => (() => void)) { if (!cleanup) cleanup = callback(); },
  };
  const context = { exports: {} as { default: () => Element }, require(name: string) {
    if (name === "react") return { ...react, default: react, __esModule: true };
    if (name === "expo-router") return { useIsFocused: () => focused, useLocalSearchParams: () => ({}), router: { canGoBack: () => canBack, back: () => calls.push("back"), replace: (path: string) => calls.push(`replace:${path}`) } };
    if (name === "../components/SettingsSheet" || name === "../components/LocationHelp") return { default: name, __esModule: true };
    if (name === "../state/SettingsLocationContext") return { useSettingsLocation: () => bridged ? { locationStatus: "Map GPS ready", issue: null, onRefreshLocation: () => calls.push("map-refresh") } : null };
    if (name === "../state/ParkingContext") return { useParking: () => ({ t: (en: string) => en }) };
    if (name === "../services/location") return { watchLocation: (fix: (fix: Fix) => void, issue: (issue: LocationIssue) => void) => new Promise<() => void>(resolve => watchers.push({ fix, issue, resolve })) };
    throw new Error(name);
  } };
  vm.runInNewContext(transpile("src/app/settings.tsx"), context);
  const render = () => { cursor = 0; return context.exports.default(); };
  const settings = (tree: Element) => nodes(tree).find(node => node.type === "../components/SettingsSheet")!;
  const permissions = (tree: Element) => nodes(tree).find(node => node.type === "../components/LocationHelp")!;
  return { render, settings, permissions, calls, watchers, direct: () => { canBack = false; }, focus: (value: boolean) => { focused = value; }, unmount: () => cleanup?.() };
}

test("settings is its own screen and keeps permissions above it while reusing the map's GPS", () => {
  const view = route(true); let tree = view.render();
  assert.equal(view.settings(tree).props.locationStatus, "Map GPS ready");
  view.settings(tree).props.onRefreshLocation(); assert.deepEqual(view.calls, ["map-refresh"]); assert.equal(view.watchers.length, 0);
  view.settings(tree).props.onPermissions(); tree = view.render();
  assert.equal(view.permissions(tree).props.visible, true); assert.equal(view.permissions(tree).props.permissions, true);
  assert.equal(view.settings(tree).props.visible, true, "permission UI retains its settings background");
  view.focus(false); tree = view.render(); assert.equal(view.permissions(tree).props.visible, false, "a child route or arrival notification cannot leave settings permissions over the new screen");
  view.focus(true); tree = view.render(); assert.equal(view.permissions(tree).props.visible, true);
  view.permissions(tree).props.onClose(); tree = view.render(); assert.equal(view.permissions(tree).props.visible, false);
  view.settings(tree).props.onClose(); assert.equal(view.calls.at(-1), "back");
  view.direct(); view.settings(tree).props.onClose(); assert.equal(view.calls.at(-1), "replace:/");
});

test("direct settings links can refresh GPS without a continuous watcher or stale updates", async () => {
  const view = route(); let tree = view.render();
  assert.equal(view.watchers.length, 0, "opening Settings never requests new location permission");
  view.settings(tree).props.onRefreshLocation(); tree = view.render(); assert.equal(view.settings(tree).props.locationStatus, "Finding your location…");
  view.watchers[0].fix(fix); let stops = 0; view.watchers[0].resolve(() => stops++); await flush();
  tree = view.render(); assert.equal(view.settings(tree).props.locationStatus, "Location active"); assert.equal(stops, 1);
  view.settings(tree).props.onRefreshLocation(); view.settings(tree).props.onRefreshLocation();
  view.watchers[1].fix(fix); view.watchers[1].resolve(() => stops++); await flush();
  tree = view.render(); assert.equal(view.settings(tree).props.locationStatus, "Finding your location…");
  view.watchers[2].issue({ code: "denied" }); view.watchers[2].resolve(() => stops++); await flush();
  tree = view.render(); assert.equal(view.settings(tree).props.locationStatus, "Location access is off"); assert.equal(stops, 3);
  view.settings(tree).props.onRefreshLocation(); view.unmount();
  view.watchers[3].fix(fix); view.watchers[3].resolve(() => stops++); await flush();
  assert.equal(stops, 4); assert.equal(view.settings(view.render()).props.locationStatus, "Finding your location…");
});

test("the opaque Settings frame uses Android Back only while focused, without a Modal", () => {
  let handler: (() => boolean) | null = null, cleanup: (() => void) | undefined, focused = true, backs = 0;
  const context = { exports: {} as { default: (props: unknown) => Element }, require(name: string) {
    if (name === "react") { const react = { createElement: (type: unknown, props: Record<string, any>, ...children: unknown[]) => ({ type, props: props ?? {}, children }), useCallback: (callback: unknown) => callback }; return { ...react, default: react, __esModule: true }; }
    if (name === "react-native") return { BackHandler: { addEventListener: (_name: string, next: () => boolean) => { handler = next; return { remove: () => { handler = null; } }; } }, KeyboardAvoidingView: "KeyboardAvoidingView", Platform: { OS: "android" }, Text: "Text", View: "View" };
    if (name === "expo-router") return { useFocusEffect: (callback: () => (() => void)) => { cleanup?.(); cleanup = focused ? callback() : undefined; } };
    if (name === "react-native-safe-area-context") return { SafeAreaView: "SafeAreaView" };
    if (name === "../state/ThemeContext") return { useTheme: () => ({ colors: { paper: "opaque-paper" } }) };
    if (name === "../state/ParkingContext") return { useParking: () => ({ t: (en: string) => en }) };
    if (name === "./ui") return { FormScrollView: "FormScrollView", IconButton: "IconButton" };
    throw new Error(name);
  } };
  vm.runInNewContext(transpile("src/components/SettingsFrame.tsx"), context);
  const render = () => context.exports.default({ title: "Settings", backLabel: "Back", onBack: () => backs++, onClose() {}, children: null });
  const tree = render(); assert.equal(tree.type, "SafeAreaView"); assert.equal(tree.props.style.backgroundColor, "opaque-paper");
  assert.ok(!nodes(tree).some(node => node.type === "Modal"));
  assert.equal(handler!(), true); assert.equal(backs, 1);
  focused = false; render(); assert.equal(handler, null, "a settings child route receives hardware Back normally");
  focused = true; render(); assert.equal(handler!(), true); assert.equal(backs, 2);
  cleanup?.(); assert.equal(handler, null);
});
