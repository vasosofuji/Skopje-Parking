import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { formRevealOffset } from "../src/domain/form-reveal";
import { LANGUAGES, translate, type Language } from "../src/domain/language";

type Element = { type: unknown; props: Record<string, unknown>; children: unknown[] };
type Component = (props: Record<string, unknown>) => Element;
const transpile = (path: string) => ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const palette = { ink: "ink", muted: "muted", green: "accent", accentText: "accentText", mint: "mint", paper: "paper", line: "line", red: "red", input: "input", success: "success", amber: "amber" };

function hooks() {
  const values: unknown[] = [], effects: { deps?: unknown[]; cleanup?: () => void }[] = [];
  let cursor = 0, effectCursor = 0;
  let pending: (() => void)[] = [];
  const useEffect = (effect: () => (() => void) | undefined, deps?: unknown[]) => {
    const index = effectCursor++, previous = effects[index];
    if (!previous || !deps || deps.some((value, i) => value !== previous.deps?.[i])) pending.push(() => { previous?.cleanup?.(); effects[index] = { deps, cleanup: effect() }; });
  };
  const react = {
    createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element { return { type, props: { ...props, children: children.length === 1 ? children[0] : children }, children }; },
    createContext: () => ({ Provider: "Provider" }), useContext: () => null,
    useState(initial: unknown) { const index = cursor++; if (!(index in values)) values[index] = typeof initial === "function" ? (initial as () => unknown)() : initial; return [values[index], (next: unknown) => { values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(values[index]) : next; }]; },
    useRef(initial: unknown) { const index = cursor++; return values[index] ?? (values[index] = { current: initial }); },
    useEffect, useLayoutEffect: useEffect,
    useMemo(create: () => unknown, deps: unknown[]) { const index = cursor++, previous = values[index] as { deps: unknown[]; value: unknown } | undefined; if (!previous || deps.some((value, i) => value !== previous.deps[i])) values[index] = { deps, value: create() }; return (values[index] as { value: unknown }).value; },
    useCallback: (callback: unknown) => callback,
  };
  return { react, start: () => { cursor = 0; effectCursor = 0; }, finish: () => { const queued = pending; pending = []; queued.forEach(effect => effect()); } };
}
function elements(tree: unknown, expand = false): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(value => elements(value, expand));
  if (!tree || typeof tree !== "object" || !("children" in tree)) return [];
  const element = tree as Element;
  const rendered = expand && typeof element.type === "function" ? [(element.type as Component)(element.props)] : element.children;
  return [element, ...rendered.flatMap(value => elements(value, expand))];
}
function invoke(element: Element, action = "onPress") { assert.equal(typeof element.props[action], "function"); (element.props[action] as () => void)(); }
const flattenStyle = (value: unknown): Record<string, unknown> => Array.isArray(value) ? Object.assign({}, ...value.map(flattenStyle)) : value && typeof value === "object" ? value as Record<string, unknown> : {};
function find(tree: Element, type: string): Element { const value = elements(tree).find(element => element.type === type); assert.ok(value, `Missing ${type}`); return value; }

function sheet() {
  const runtime = hooks(), exports = {} as { Sheet: Component; IconButton: Component };
  vm.runInNewContext(transpile("src/components/ui.tsx"), { exports, require(name: string) {
    if (name === "react") return { ...runtime.react, default: runtime.react, __esModule: true };
    if (name === "react-native") return { ...Object.fromEntries(["Pressable", "Text", "View", "Modal", "ScrollView", "KeyboardAvoidingView"].map(value => [value, value])), Platform: { OS: "android" }, useWindowDimensions: () => ({ height: 844, width: 390, fontScale: 1.8 }), StyleSheet: { create: (value: unknown) => value, absoluteFill: {} } };
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 48, bottom: 34, left: 24, right: 12 }) };
    if (name === "@expo/vector-icons") return { Feather: "Feather" };
    if (name === "../state/ThemeContext") return { useTheme: () => ({ colors: palette }), lightColors: palette };
    if (name === "../domain/form-reveal") return { formRevealOffset };
    if (name === "../state/ContributionFeedback") return { ContributionNotice: "ContributionNotice" };
    if (name === "./ModalBackdrop") return { __esModule: true, default: "ModalBackdrop" };
    if (name === "../state/ParkingContext") return { useTranslate: () => (en: string) => en };
    throw new Error(`Unexpected Sheet dependency: ${name}`);
  } });
  return { render(props: Record<string, unknown>) { runtime.start(); const tree = exports.Sheet({ visible: true, title: "Settings", children: null, ...props }); runtime.finish(); return tree; }, icon: exports.IconButton };
}

function settings(guest = false, platform = "android") {
  const runtime = hooks(), exports = {} as { default: Component };
  let pathname = "/settings";
  let visible = true, mode = "system", language = "en", navigation = "default", closes = 0, refreshes = 0, gps = 0, permissions = 0;
  const preferenceCalls: string[][] = [], routeEvents: string[] = [];
  const navigationWrites: { value: string; resolve: () => void; reject: () => void }[] = [];
  const refresh = async () => { refreshes++; };
  vm.runInNewContext(transpile("src/components/SettingsSheet.tsx"), { exports, require(name: string) {
    if (name === "react") return { ...runtime.react, default: runtime.react, __esModule: true };
    if (name === "react-native") return { Pressable: "Pressable", Text: "Text", View: "View", Platform: { OS: platform }, Linking: { openSettings: async () => {}, openURL: async () => {} }, TextInput: "TextInput", StyleSheet: { create: (value: unknown) => value } };
    if (name === "expo-router") return { usePathname: () => pathname, router: { push(path: string) { pathname = path; routeEvents.push(path); } } };
    if (name === "../state/ThemeContext") return { useTheme: () => ({ colors: palette, mode, setMode(value: string) { preferenceCalls.push(["theme", value]); mode = value; } }) };
    if (name === "../state/ParkingContext") return { useParking: () => ({ language, t: (en: string, mk: string) => translate(language as Language, en, mk), setLanguage(value: string) { preferenceCalls.push(["language", value]); language = value; } }) };
    if (name === "../state/AccountContext") return { useAccount: () => ({ profile: { id: "profile-one", username: "driver", points: 125, guest, secured: true }, refresh }) };
    if (name === "../state/LicensePlateContext") return { useLicensePlate: () => ({ savedPlate: null, ready: true }) };
    if (name === "./LicensePlateEditor") return { default: "LicensePlateEditor", __esModule: true };
    if (name === "../services/signReader") return { useSignReader: () => null, readingFailure: () => null, noteReadingFailure() {}, rememberSignImage() {}, readSignOnDevice: async () => { throw new Error("no key"); }, signImage: async () => ({ base64: "", mimeType: "image/jpeg" }), signReaderState: { current: async () => null, save: async () => {} }, guessProvider: () => null, validSignReader: () => false, testSignReader: async () => "ok", SIGN_READER_KEY_PAGES: { gemini: "", groq: "" } };
    if (name === "./ui") return { Button: "Button", Icon: "Icon", Sheet: "Sheet", RevealSection: "RevealSection" };
    if (name === "./SettingsFrame") return { __esModule: true, default: "SettingsFrame" };
    if (name === "./BackgroundArrivalSettings") return { __esModule: true, default: "BackgroundArrivalSettings" };
    if (name === "../services/backgroundArrival") return { backgroundLocationBuild: true };
    if (name === "../domain/language") return { LANGUAGES };
    if (name === "./LanguagePicker") {
      const picker = { default: undefined as unknown as Component };
      vm.runInNewContext(transpile("src/components/LanguagePicker.tsx"), { exports: picker, require(dependency: string) {
        if (dependency === "react") return { ...runtime.react, default: runtime.react, __esModule: true };
        if (dependency === "react-native") return { Pressable: "Pressable", Image: "Image", Text: "Text", View: "View" };
        if (dependency === "../domain/language") return { LANGUAGES };
        if (dependency === "../state/ParkingContext") return { useParking: () => ({ language, t: (en: string, mk: string) => translate(language as Language, en, mk), setLanguage(value: string) { preferenceCalls.push(["language", value]); language = value; } }) };
        if (dependency === "../state/ThemeContext") return { useTheme: () => ({ colors: palette }) };
        if (dependency === "./ui") return { Icon: "Icon" };
        if (dependency.endsWith(".png")) return dependency;
        throw new Error(`Unexpected picker dependency: ${dependency}`);
      } });
      return { __esModule: true, default: picker.default };
    }
    if (name === "../domain/navigation") return { NAVIGATION_APPS: ["default", "google", "waze"] };
    if (name === "../services/navigation") return { useNavigationPreference: () => navigation, setNavigationPreference: (value: string) => { preferenceCalls.push(["navigation", value]); return new Promise<void>((resolve, reject) => navigationWrites.push({ value, resolve() { navigation = value; resolve(); }, reject() { reject(new Error("storage unavailable")); } })); } };
    throw new Error(`Unexpected settings dependency: ${name}`);
  } });
  const render = () => { runtime.start(); const tree = exports.default({ visible, onClose() { closes++; visible = false; routeEvents.push("close"); }, locationStatus: "GPS active", onRefreshLocation() { gps++; }, onPermissions() { permissions++; } }); runtime.finish(); return tree; };
  const actionable = (tree: Element, label: string) => {
    const value = elements(tree, true).find(element => (element.type === "Pressable" || element.type === "Button") && [element.props.accessibilityLabel, element.props.title].some(text => typeof text === "string" && (text === label || text.startsWith(label + ","))));
    assert.ok(value, `Missing settings action: ${label}`); return value;
  };
  return { render, actionable, tap(tree: Element, label: string) { const node = actionable(tree, label); assert.notEqual(node.props.disabled, true, `${label} disabled`); invoke(node); }, preferenceCalls, navigationWrites, routeEvents, returnToSettings: () => { pathname = "/settings"; }, reopen: () => { visible = true; }, stats: () => ({ closes, refreshes, gps, permissions }) };
}

test("full-page Sheet applies every safe edge and Android Back honors its current action/disabled state", () => {
  const view = sheet(); let backs = 0, closes = 0;
  let tree = view.render({ fullPage: true, onBack: () => { backs++; }, backLabel: "Back", onClose: () => { closes++; } });
  const overlay = flattenStyle(find(tree, "KeyboardAvoidingView").props.style);
  assert.equal(overlay.paddingTop, 48); assert.equal(overlay.paddingBottom, 34); assert.equal(overlay.paddingLeft, 24); assert.equal(overlay.paddingRight, 12);
  assert.ok(!elements(tree).some(node => node.props.accessibilityLabel === "Close dialog" || node.type === "ModalBackdrop"));
  assert.equal(flattenStyle(find(tree, "ScrollView").props.style).flex, 1);
  invoke(find(tree, "Modal"), "onRequestClose"); assert.deepEqual([backs, closes], [1, 0]);
  tree = view.render({ fullPage: true, onBack: () => { backs++; }, backDisabled: true, onClose: () => { closes++; } });
  invoke(find(tree, "Modal"), "onRequestClose"); assert.deepEqual([backs, closes], [1, 0]);
  tree = view.render({ fullPage: true, onClose: () => { closes++; } });
  invoke(find(tree, "Modal"), "onRequestClose"); assert.deepEqual([backs, closes], [1, 1]);
});

test("ordinary Sheet keeps backdrop/Android close and compact header Back behavior", () => {
  const view = sheet(); let backs = 0, closes = 0, shows = 0, dismisses = 0;
  const tree = view.render({ onBack: () => { backs++; }, backLabel: "Go back", onClose: () => { closes++; }, onShow: () => { shows++; }, onDismiss: () => { dismisses++; } });
  assert.ok(elements(tree).some(node => node.type === "ModalBackdrop"));
  invoke(find(tree, "Modal"), "onRequestClose"); assert.deepEqual([backs, closes], [0, 1]);
  const backdrop = elements(tree).find(node => node.props.accessibilityLabel === "Close dialog")!;
  invoke(backdrop); assert.equal(closes, 2);
  const back = elements(tree).find(node => node.props.label === "Go back")!;
  assert.equal(back.props.compact, true); invoke(back); assert.equal(backs, 1);
  const close = elements(tree).find(node => node.props.name === "x")!;
  invoke(close); assert.equal(closes, 3);
  assert.equal(view.icon({ name: "arrow-left", compact: true, label: "Back", onPress() {} }).props.hitSlop, 6);
  invoke(find(tree, "Modal"), "onShow"); invoke(find(tree, "Modal"), "onDismiss");
  assert.deepEqual([shows, dismisses], [1, 1], "ordinary iOS source/review dismissal callbacks remain forwarded");
});

test("settings sections use header Back before closing the settings route", () => {
  const view = settings(); let tree = view.render();
  assert.equal(tree.type, "SettingsFrame"); assert.equal(tree.props.title, "Settings");
  view.tap(tree, "Appearance"); tree = view.render(); assert.equal(tree.props.title, "Appearance");
  assert.ok(!elements(tree, true).some(node => node.props.title === "Back to settings"));
  invoke(tree, "onBack"); tree = view.render();
  assert.equal(tree.props.title, "Settings"); assert.equal(view.stats().closes, 0);
  invoke(tree, "onBack"); tree = view.render();
  assert.equal(view.stats().closes, 1);
  view.reopen(); tree = view.render(); assert.equal(tree.props.title, "Settings");
});

test("license plate editing opens from settings and header Back returns to settings", () => {
  const view = settings(); view.tap(view.render(), "License plate");
  const tree = view.render(); assert.ok(elements(tree).some(node => node.type === "LicensePlateEditor"));
  invoke(find(tree, "SettingsFrame"), "onBack");
  assert.equal(find(view.render(), "SettingsFrame").props.title, "Settings"); assert.equal(view.stats().closes, 0);
});

test("appearance and language choices call existing setters and expose the selected radio", () => {
  const view = settings(); let tree = view.render(); view.tap(tree, "Appearance"); tree = view.render();
  view.tap(tree, "Dark"); tree = view.render();
  assert.equal(view.actionable(tree, "Dark").props.accessibilityRole, "radio");
  assert.equal((view.actionable(tree, "Dark").props.accessibilityState as { checked: boolean }).checked, true);
  invoke(tree, "onBack"); tree = view.render(); view.tap(tree, "Language"); tree = view.render();
  view.tap(tree, "Македонски"); tree = view.render(); assert.equal(tree.props.title, "Јазик");
  assert.equal((view.actionable(tree, "Македонски").props.accessibilityState as { checked: boolean }).checked, true);
  assert.deepEqual(view.preferenceCalls, [["theme", "dark"], ["language", "mk"]]);
});

test("Turkish and Albanian choices translate settings and retain the correct language summary", () => {
  const view = settings();
  for (const [name, code, title] of [["Türkçe", "tr", "Dil"], ["Shqip", "sq", "Gjuha"]] as const) {
    let tree = view.render();
    view.tap(tree, translate(code === "tr" ? "en" : "tr", "Language", "Јазик"));
    tree = view.render(); view.tap(tree, name); tree = view.render();
    assert.equal(tree.props.title, title);
    assert.equal((view.actionable(tree, name).props.accessibilityState as { checked: boolean }).checked, true);
    invoke(tree, "onBack"); tree = view.render();
    assert.ok(view.actionable(tree, title).props.accessibilityLabel?.toString().includes(name));
  }
  assert.deepEqual(view.preferenceCalls, [["language", "tr"], ["language", "sq"]]);
});

test("navigation waits for persistence, locks choices while saving and keeps a failed choice retryable", async () => {
  const view = settings(); let tree = view.render(); view.tap(tree, "Navigation app"); tree = view.render();
  view.tap(tree, "Waze"); tree = view.render(); assert.equal(view.actionable(tree, "Google Maps").props.disabled, true);
  assert.equal((view.actionable(tree, "Waze").props.accessibilityState as { checked: boolean }).checked, false);
  view.navigationWrites[0].resolve(); await flush(); tree = view.render();
  assert.equal((view.actionable(tree, "Waze").props.accessibilityState as { checked: boolean }).checked, true);
  assert.notEqual(view.actionable(tree, "Google Maps").props.disabled, true);
  view.tap(tree, "Google Maps"); view.navigationWrites[1].reject(); await flush(); tree = view.render();
  assert.equal((view.actionable(tree, "Waze").props.accessibilityState as { checked: boolean }).checked, true);
  assert.ok(elements(tree, true).some(node => node.props.accessibilityLiveRegion === "polite" && node.children.some(value => typeof value === "string" && value.includes("Could not save"))));
  assert.notEqual(view.actionable(tree, "Google Maps").props.disabled, true);
});

test("profile and legal routes retain the opaque settings screen while child routes are above it", () => {
  for (const [label, path] of [["Manage account", "/account"], ["Rewards & appearance", "/rewards"], ["Privacy & data", "/privacy"], ["Zones & sources", "/coverage"], ["Terms of service", "/terms"]]) {
    const view = settings(); let tree = view.render(); view.tap(tree, label); tree = view.render();
    assert.deepEqual(view.routeEvents, [path]); assert.equal(tree.type, "SettingsFrame");
    assert.equal(tree.props.title, "Settings");
    assert.ok(existsSync(`src/app${path}.tsx`));
    view.returnToSettings(); tree = view.render(); assert.equal(tree.props.title, "Settings");
    assert.equal(tree.type, "SettingsFrame"); assert.equal(view.stats().closes, 0);
  }
});

test("profile summary uses the real identity and points while guests retain account access", () => {
  for (const guest of [false, true]) {
    const view = settings(guest), tree = view.render();
    const text = elements(tree, true).filter(node => node.type === "Text").flatMap(node => node.children).filter(value => typeof value === "string" || typeof value === "number");
    assert.ok(text.includes(guest ? "Guest" : "@driver"));
    assert.ok(text.includes(125)); assert.ok(text.includes("points"));
    if (guest) assert.ok(!text.includes("@driver"));
    view.tap(tree, "Manage account"); assert.deepEqual(view.routeEvents, ["/account"]);
  }
});

test("location and notification permissions share a section without a reminder info page", () => {
  const view = settings(true); let tree = view.render(); view.tap(tree, "Location & notifications"); tree = view.render();
  view.tap(tree, "Refresh GPS"); view.tap(tree, "Location permissions"); view.tap(tree, "Notification permissions");
  assert.ok(!elements(tree, true).some(node => node.props.title === "About reminders"));
  const reminders = elements(tree).find(node => node.type === "BackgroundArrivalSettings")!;
  assert.equal(reminders.props.onInfo, undefined);
  invoke(tree, "onBack"); tree = view.render(); assert.equal(tree.props.title, "Settings");
  assert.deepEqual([view.stats().gps, view.stats().permissions, view.stats().closes], [1, 2, 0]);
});

test("web keeps notification permissions visibly unavailable without invoking a native settings action", () => {
  const view = settings(false, "web"); let tree = view.render();
  view.tap(tree, "Location & notifications"); tree = view.render();
  const notification = view.actionable(tree, "Notification permissions");
  assert.equal(notification.props.disabled, true);
  assert.equal(notification.props.accessibilityLabel, "Notification permissions, Phone app");
  view.tap(tree, "Location permissions");
  assert.equal(view.stats().permissions, 1);
});
test("Sheet reveals expanded fields but resize, collapse and manual scrolling preserve the reading position", () => {
  const tree = sheet().render({ onClose() {} });
  const scroller = find(tree, "ScrollView");
  const offsets: number[] = [];
  (scroller.props.ref as { current: unknown }).current = { scrollTo: ({ y }: { y: number }) => offsets.push(y) };
  const content = elements(tree).find(node => node.type === "View" && node.props.collapsable === false)!;
  (content.props.ref as { current: unknown }).current = {};
  const reveal = elements(tree).filter(node => node.type === "Provider")[2].props.value as (node: unknown, reason: string) => void;
  const layout = scroller.props.onLayout as (event: unknown) => void;
  const resize = scroller.props.onContentSizeChange as (width: number, height: number) => void;
  layout({ nativeEvent: { layout: { height: 500 } } }); resize(390, 1800);
  const section = { measureLayout(_parent: unknown, success: (x: number, top: number, width: number, height: number) => void) { success(0, 350, 300, 800); } };
  reveal(section, "open"); assert.deepEqual(offsets, [338]);
  (scroller.props.onScroll as (event: unknown) => void)({ nativeEvent: { contentOffset: { y: 600 } } });
  resize(390, 1900); assert.deepEqual(offsets, [338]);
  reveal(section, "close"); layout({ nativeEvent: { layout: { height: 450 } } }); assert.deepEqual(offsets, [338]);
  reveal(section, "open"); assert.deepEqual(offsets, [338, 338]);
  invoke(scroller, "onScrollBeginDrag"); resize(390, 2000); assert.deepEqual(offsets, [338, 338]);
});
