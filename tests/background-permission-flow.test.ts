import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as backgroundDomain from "../src/domain/backgroundArrival";
import * as language from "../src/domain/language";
import { emptyReminderState } from "../src/domain/backgroundArrival";
import { startArrivalInForeground } from "../src/services/foregroundArrivalStart";
import * as presentation from "../src/services/notificationPresentation";

type Service = { enableBackgroundArrival(explain?: () => Promise<boolean>): Promise<void> };
type Handler = { handleNotification(notification: { request: { identifier: string; content: { data?: Record<string, unknown> } } }): Promise<{ shouldShowBanner: boolean; shouldPlaySound: boolean }> };
type Task = (body: { data: { locations: unknown[] }; error: null; executionInfo: { appState: string } }) => Promise<void>;
function load({ accuracy = "fine", explain = true, saved = "en" } = {}) {
  const steps: string[] = [], widget: unknown[][] = [];
  let task: Task | undefined, options: Record<string, any> | undefined, enabled = false, handler: Handler | undefined;
  const appState = { currentState: "active" };
  const Location = {
    Accuracy: { High: 4 },
    hasServicesEnabledAsync: async () => true,
    requestForegroundPermissionsAsync: async () => { steps.push("foreground"); return { granted: true, android: { accuracy } }; },
    getBackgroundPermissionsAsync: async () => ({ granted: false }),
    requestBackgroundPermissionsAsync: async () => { steps.push("background"); return { granted: true }; },
    hasStartedLocationUpdatesAsync: async () => true,
    startLocationUpdatesAsync: async (_name: string, value: Record<string, any>) => { steps.push("start"); options = value; },
  };
  const Notifications = {
    AndroidImportance: { DEFAULT: 3 }, IosAuthorizationStatus: { PROVISIONAL: 3 },
    setNotificationHandler: (value: Handler) => { handler = value; },
    setNotificationChannelAsync: async () => { steps.push("channel"); },
    requestPermissionsAsync: async () => { steps.push("notifications"); return { granted: true }; },
  };
  const modules: Record<string, unknown> = {
    "@react-native-async-storage/async-storage": { __esModule: true, default: { getItem: async () => saved } },
    "expo": { isRunningInExpoGo: () => false, requireOptionalNativeModule: () => ({}) },
    "expo-constants": { __esModule: true, default: { expoConfig: { extra: { backgroundLocation: true } } } },
    "expo-location": Location, "expo-notifications": Notifications,
    "expo-task-manager": { isTaskDefined: () => false, isAvailableAsync: async () => true, defineTask: (_name: string, body: Task) => { task = body; } },
    "react-native": { AppState: appState, Platform: { OS: "android" } },
    "../domain/backgroundArrival": backgroundDomain, "../domain/language": language,
    "./foregroundArrivalStart": { startArrivalInForeground },
    "./notificationPresentation": presentation,
    "./parkingWidget": { showWidgetZone: (...args: unknown[]) => widget.push(args) },
    "./arrivalStorage": {
      arrivalTransaction: (work: () => Promise<unknown>) => work(),
      backgroundArrivalEnabled: async () => enabled, saveBackgroundArrivalEnabled: async (value: boolean) => { enabled = value; },
      readArrivalCatalog: async () => [], readArrivalState: async () => emptyReminderState(), saveArrivalState: async () => {}, clearArrivalStorage: async () => {},
    },
  };
  const exports = {} as Service;
  vm.runInNewContext(ts.transpileModule(readFileSync("src/services/backgroundArrival.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: (name: string) => modules[name] ?? assert.fail(`unexpected import ${name}`) });
  return { service: exports, steps, widget, appState, handler: () => handler!, task: () => task!, options: () => options, enabled: () => enabled, explain: async () => { steps.push("explain"); return explain; } };
}

test("Android opt-in asks location, explains, then Allow all the time, then notifications, and survives swipe-away", async () => {
  const flow = load();
  await flow.service.enableBackgroundArrival(flow.explain);
  assert.deepEqual(flow.steps, ["foreground", "explain", "background", "channel", "notifications", "start"]);
  assert.equal(flow.enabled(), true);
  assert.equal(flow.options()!.foregroundService.killServiceOnDestroy, false);
  assert.equal(flow.options()!.foregroundService.notificationTitle, "Parking reminders are on");
});

test("declining the explanation stops before Android's settings page; approximate location is refused in the app's language", async () => {
  const declined = load({ explain: false });
  await declined.service.enableBackgroundArrival(declined.explain);
  assert.deepEqual(declined.steps, ["foreground", "explain"]);
  assert.equal(declined.enabled(), false);
  const coarse = load({ accuracy: "coarse", saved: "mk" });
  await assert.rejects(coarse.service.enableBackgroundArrival(coarse.explain), { message: /^Вклучете Прецизна локација/ });
  assert.deepEqual(coarse.steps, ["foreground"]);
});

test("the background location task keeps the widget on the newest fix", async () => {
  const flow = load();
  await flow.service.enableBackgroundArrival(flow.explain);
  flow.appState.currentState = "background";
  const location = (timestamp: number, latitude: number) => ({ coords: { latitude, longitude: 21, accuracy: 5, speed: 0 }, timestamp });
  await flow.task()({ data: { locations: [location(2000, 42.002), location(1000, 42.001)] }, error: null, executionInfo: { appState: "background" } });
  assert.deepEqual(JSON.parse(JSON.stringify(flow.widget)), [[{ latitude: 42.002, longitude: 21, accuracy: 5, speed: 0, timestamp: 2000 }, [], "en"]]);
});

test("whichever module installs the notification handler, the time-limit reminder and place pushes show over the open app", async () => {
  const flow = load();
  let placeHandler: Handler | undefined;
  const modules: Record<string, unknown> = {
    "expo-constants": { __esModule: true, default: { expoConfig: { extra: { androidPush: true } } } },
    "expo": { isRunningInExpoGo: () => false, requireOptionalNativeModule: () => ({}) },
    "react-native": { AppState: flow.appState, Platform: { OS: "android" } },
    "expo-notifications": { setNotificationHandler: (value: Handler) => { placeHandler = value; }, getLastNotificationResponse: () => null, addNotificationResponseReceivedListener: () => ({ remove() {} }) },
    "./notificationPresentation": presentation,
  };
  const exports = {} as { listenForPlaceNotifications(open: (id: string) => void): () => void };
  vm.runInNewContext(ts.transpileModule(readFileSync("src/services/placeNotifications.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: (name: string) => modules[name] ?? assert.fail(`unexpected import ${name}`) });
  exports.listenForPlaceNotifications(() => {});
  const show = async (handler: Handler, identifier: string, data?: Record<string, unknown>) => {
    const behavior = await handler.handleNotification({ request: { identifier, content: { data } } });
    return [behavior.shouldShowBanner, behavior.shouldPlaySound];
  };
  for (const handler of [flow.handler(), placeHandler!]) {
    flow.appState.currentState = "active";
    assert.deepEqual(await show(handler, "parking-sms-limit"), [true, false], "the parking time-limit reminder");
    assert.deepEqual(await show(handler, "push", { kind: "parking-spot-opening", placeId: "a" }), [true, true]);
    assert.deepEqual(await show(handler, "push", { kind: "parking-destination-full", placeId: "a" }), [true, true]);
    assert.deepEqual(await show(handler, "arrival", { kind: "parking-arrival" }), [false, false], "the arrival question is already on screen");
    flow.appState.currentState = "background";
    assert.deepEqual(await show(handler, "arrival", { kind: "parking-arrival" }), [true, false]);
  }
});
