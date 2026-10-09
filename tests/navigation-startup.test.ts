import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as navigationDomain from "../src/domain/navigation";

const transpile = (source: string) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
type Element = { type: unknown; props: Record<string, unknown>; children: unknown[] };

function startup() {
  let ready = false, mounted = false, cleanup: (() => void) | undefined;
  let effect: (() => (() => void) | undefined) | undefined;
  let resolve!: (value: string | null) => void, reject!: (reason: Error) => void;
  let reads = 0, stateWrites = 0;
  const opened: string[] = [], notifications: boolean[] = [];
  const react = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    useState: () => [ready, (next: boolean) => { ready = next; stateWrites++; }],
    useEffect: (next: typeof effect) => { if (!mounted) effect = next; },
  };
  const service = { exports: {} as { useNavigationReady: () => boolean; openParkingDirections: (point: { latitude: number; longitude: number }) => Promise<void> }, require(name: string) {
    if (name === "react") return react;
    if (name === "react-native") return { Platform: { OS: "android" } };
    if (name === "@react-native-async-storage/async-storage") return { __esModule: true, default: { getItem: () => { reads++; return new Promise<string | null>((yes, no) => { resolve = yes; reject = no; }); }, setItem: async () => {} } };
    if (name === "expo-linking") return { openURL: async (url: string) => { opened.push(url); } };
    if (name === "../domain/navigation") return navigationDomain;
    throw new Error(`Unexpected navigation dependency: ${name}`);
  } };
  vm.runInNewContext(transpile(readFileSync("src/services/navigation.ts", "utf8")), service);
  const layout = { exports: {} as { Navigator: () => Element }, require(name: string) {
    if (name === "react") return { ...react, default: react, __esModule: true };
    if (name === "react-native") return { View: "View" };
    if (name === "expo-router") return { Stack: { Protected: "Protected", Screen: "Screen" } };
    if (name === "expo-status-bar") return { StatusBar: "StatusBar" };
    if (name === "../state/AccountContext") return { AccountProvider: "AccountProvider", useAccount: () => ({ profile: { id: "one" }, ready: true }) };
    if (name === "../state/ThemeContext") return { ThemeProvider: "ThemeProvider", useTheme: () => ({ dark: false, colors: { paper: "white" } }) };
    if (name === "../state/ParkingContext") return { ParkingProvider: "ParkingProvider" };
    if (name === "../state/ContributionFeedback") return { ContributionFeedbackProvider: "ContributionFeedbackProvider" };
    if (name === "../state/SettingsLocationContext") return { SettingsLocationProvider: "SettingsLocationProvider" };
    if (name === "../state/LicensePlateContext") return { LicensePlateProvider: "LicensePlateProvider" };
    if (name === "../components/LicensePlatePrompt") return { default: "LicensePlatePrompt", __esModule: true };
    if (name === "../components/ModalBackdrop") return { ModalBackgroundProvider: "ModalBackgroundProvider" };
    if (name === "../components/LoadingIndicator" || name === "../components/AppStyles") return { default: name, __esModule: true };
    if (name === "../domain/onboarding") return { hasCurrentTerms: () => true };
    if (name === "../hooks/useArrivalNotifications") return { useArrivalNotifications: (enabled: boolean) => notifications.push(enabled) };
    if (name === "../services/navigation") return service.exports;
    throw new Error(`Unexpected layout dependency: ${name}`);
  } };
  vm.runInNewContext(transpile(readFileSync("src/app/_layout.tsx", "utf8") + "\nexport { Navigator };"), layout);
  return {
    render() { const tree = layout.exports.Navigator(); if (!mounted) { mounted = true; cleanup = effect?.(); } return tree; },
    resolve: (value: string | null) => resolve(value), reject: () => reject(new Error("storage unavailable")),
    go: () => service.exports.openParkingDirections({ latitude: 42, longitude: 21 }), opened, notifications,
    counts: () => ({ reads, stateWrites }), unmount: () => cleanup?.(),
  };
}

test("startup with an already-ready account waits for persisted route preference before exposing the map", async () => {
  const app = startup();
  assert.equal(app.render().type, "View");
  assert.equal(app.notifications.at(-1), false, "notification handoff also waits for the navigator");
  assert.equal(app.render().type, "View");
  app.resolve("waze"); await flush();
  assert.equal(app.render().type, "ParkingProvider");
  assert.equal(app.notifications.at(-1), true);
  const opened = app.go();
  assert.equal(app.opened[0], "waze://?ll=42,21&navigate=yes", "the first Go launches the saved app synchronously");
  await opened;
  assert.equal(app.counts().reads, 1);
  app.unmount();
});

test("failed preference hydration releases startup using the phone default", async () => {
  const app = startup(); app.render(); app.reject(); await flush();
  assert.equal(app.render().type, "ParkingProvider");
  await app.go(); assert.equal(app.opened[0], "geo:0,0?q=42,21");
  app.unmount();
});

test("preference hydration does not update an unmounted startup gate", async () => {
  const app = startup(); app.render(); app.unmount(); app.resolve("google"); await flush();
  assert.equal(app.counts().stateWrites, 0);
});
