import * as zoneInteraction from "../src/domain/zone-interaction";
import * as languageModule from "../src/domain/language";
import * as selectionCamera from "../src/domain/map-selection-camera";
import { createLayerCache } from "../src/domain/layer-cache";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import type { ParkingMapProps } from "../src/components/mapTypes";
import { SKOPJE } from "../src/domain/parking";
import { translate } from "../src/domain/language";

function compile(path: string) {
  return ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
}

test("map keyboard dismissal reaches Android's native guard even when RN no longer tracks an input", async () => {
  for (const platform of ["android", "ios"]) {
    const calls: string[] = [];
    const exports: { dismissMapKeyboard?: () => Promise<boolean> } = {};
    vm.runInNewContext(compile("modules/parkino-map-keyboard/index.ts"), { exports, require(name: string) {
      if (name === "react-native") return { Platform: { OS: platform }, Keyboard: { dismiss: () => calls.push("RN-no-focused-input") } };
      if (name === "expo") return { requireOptionalNativeModule(name: string) {
        assert.equal(name, "ParkinoMapKeyboard");
        return { dismissForMap: async () => { calls.push("native-map-focus-check"); throw new Error("activity destroyed"); } };
      } };
      throw new Error(name);
    } });
    const accepted = await exports.dismissMapKeyboard!();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(calls, platform === "android" ? ["native-map-focus-check"] : ["RN-no-focused-input"]);
    assert.equal(accepted, platform !== "android");
  }
});

test("current Leaflet taps wait for native acceptance but pan intent is immediate and independent of keyboard focus", async () => {
  type Element = { type: string; props: Record<string, any>; children: Element[] };
  const calls: string[] = [];
  const pending: ((accepted: boolean) => void)[] = [];
  let currentInteraction = true;
  const react = {
    createElement: (type: string, props: Record<string, unknown>, ...children: Element[]) => ({ type, props, children }),
    useRef: (value: unknown) => ({ current: value }), useState: (value: unknown) => [value, () => {}],
    useMemo: (fn: () => unknown) => fn(), useEffect() {}, useLayoutEffect: (fn: () => unknown) => fn(),
  };
  const exports: { default?: (props: ParkingMapProps) => Element } = {};
  vm.runInNewContext(compile("src/components/OpenStreetParkingMap.tsx"), { exports, require(name: string) {
    if (name === "react") return { ...react, default: react, __esModule: true };
    if (name === "../domain/language") return languageModule;
    if (name === "../hooks/usePriceCheck") return { usePriceCheck: () => () => true };
    if (name === "react-native") return { StyleSheet: { create: (value: unknown) => value }, View: "View", Text: "Text" };
    if (name === "react-native-webview") return { WebView: "WebView" };
    if (name.endsWith("parking")) return { SKOPJE };
    if (name.endsWith("layer-cache")) return { createLayerCache };
    if (name.endsWith("zone-interaction")) return zoneInteraction;
    if (name.endsWith("map-selection-camera")) return selectionCamera;
    if (name.endsWith("clusters")) return { groupParking: () => [] };
    if (name.endsWith("marker-appearance")) return {};
    if (name.endsWith("offlineMapHtml")) return { mapHtml: "map" };
    if (name.endsWith("parkino-map-keyboard")) return { dismissMapKeyboard: () => { calls.push("dismiss"); return new Promise<boolean>(resolve => pending.push(resolve)); } };
    throw new Error(name);
  } });
  const props = { places: [{ id: "p", coordinate: SKOPJE }], now: 0, destination: SKOPJE, userLocation: null, picking: true, drawing: true, draftCoordinates: [SKOPJE], showZones: false, language: "en", isInteractionCurrent: () => currentInteraction, onSelect: () => calls.push("select"), onPick: () => calls.push("pick"), onMoveVertex: () => calls.push("vertex"), onPan: () => calls.push("pan"), onBlankPress: () => calls.push("blank") } as unknown as ParkingMapProps;
  const tree = exports.default!(props), web = tree.children.find(child => child?.type === "WebView")!;
  const send = (data: object) => web.props.onMessage({ nativeEvent: { data: JSON.stringify({ sentAt: 100, ...data }) } });
  send({ type: "ready" }); send({ type: "center", latitude: 42, longitude: 21 }); send({ type: "zoom", zoom: 16 });
  send({ type: "position", point: { x: 1, y: 2 } }); send({ type: "select", id: "missing" });
  send({ type: "pick", latitude: 200, longitude: 21 });
  assert.deepEqual(calls, []);
  send({ type: "blank" }); send({ type: "select", id: "p" });
  send({ type: "pick", latitude: 42, longitude: 21 }); send({ type: "vertex", index: 0, latitude: 42, longitude: 21 });
  assert.deepEqual(calls, ["dismiss", "dismiss", "dismiss", "dismiss"], "tap callbacks wait for the native focus guard");
  pending.splice(0).forEach(resolve => resolve(true)); await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(calls.slice(4), ["blank", "select", "pick", "vertex"]);
  calls.length = 0;
  send({ type: "blank" }); pending.shift()!(false); await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["dismiss"], "native text field/modal focus rejection never reaches parent blur");
  calls.length = 0;
  send({ type: "pan" });
  assert.deepEqual(calls, ["pan"], "a legitimate drag records camera intent even when RN search retains focus and native dismissal would reject");
  assert.equal(pending.length, 0, "pan must not wait for native focus acceptance or issue a keyboard mutation");
  calls.length = 0;
  send({ type: "blank" }); currentInteraction = false; pending.shift()!(true); await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["dismiss"], "search refocus or a new sheet during native dispatch cancels parent callback");
  calls.length = 0; send({ type: "blank" }); send({ type: "pan" });
  assert.deepEqual(calls, [], "stale taps and drags remain blocked after new focus or a sheet opens");
  assert.equal(web.props.onStartShouldSetResponderCapture, undefined, "keyboard handling must not capture WebView gestures");
  currentInteraction = true; props.picking = false; props.drawing = false;
  props.places.push({ ...props.places[0], id: "poc:zone:1:0", kind: "zone", operator: "poc", zoneCode: "POC 1" });
  send({ type: "zoom", zoom: 15 }); send({ type: "select", id: "poc:zone:1:0" });
  send({ type: "zoom", zoom: 16 }); pending.shift()!(true);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["dismiss", "select"], "tiny tariff areas remain selectable after zoom and native guard acceptance");
});

test("Android module is scoped to the bundled map on the UI queue, before any keyboard mutation", () => {
  const base = "modules/parkino-map-keyboard/";
  const config = JSON.parse(readFileSync(base + "expo-module.config.json", "utf8"));
  assert.deepEqual(config.platforms, ["android"]);
  assert.deepEqual(config.android.modules, ["expo.modules.parkinomapkeyboard.ParkinoMapKeyboardModule"]);
  const source = readFileSync(base + "android/src/main/java/expo/modules/parkinomapkeyboard/ParkinoMapKeyboardModule.kt", "utf8");
  const viewGuard = source.indexOf("activity.currentFocus as? WebView ?: return@AsyncFunction false");
  const mapGuard = source.indexOf('if (map.title != "Parkino parking map") return@AsyncFunction false');
  const windowGuard = source.indexOf("if (!map.hasWindowFocus() || !activity.window.decorView.hasWindowFocus()) return@AsyncFunction false");
  const hide = source.indexOf("controller.hide(WindowInsets.Type.ime())");
  assert.ok(viewGuard >= 0 && mapGuard > viewGuard && windowGuard > mapGuard && hide > windowGuard);
  assert.ok(source.includes("}.runOnQueue(Queues.MAIN)"));
  assert.ok(source.includes("keyboard.hideSoftInputFromWindow(token, 0)"));
  assert.ok(!source.includes("requestFocus("), "never refocus an editor to force dismissal");
  assert.ok(readFileSync("src/components/offlineMapHtml.ts", "utf8").includes("<title>Parkino parking map</title>"));
});
