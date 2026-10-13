import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as backgroundDomain from "../src/domain/backgroundArrival";
import * as language from "../src/domain/language";
import { emptyReminderState } from "../src/domain/backgroundArrival";
import { startArrivalInForeground } from "../src/services/foregroundArrivalStart";

type Service = { enableBackgroundArrival(explain?: () => Promise<boolean>): Promise<void> };
type Task = (body: { data: { locations: unknown[] }; error: null; executionInfo: { appState: string } }) => Promise<void>;
function load({ accuracy = "fine", explain = true, saved = "en" } = {}) {
  const steps: string[] = [], widget: unknown[][] = [];
  let task: Task | undefined, options: Record<string, any> | undefined, enabled = false;
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
    setNotificationHandler() {},
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
    "./parkingReminder": { PARKING_LIMIT_REMINDER: "parking-sms-limit" },
    "./arrivalStorage": {
      arrivalTransaction: (work: () => Promise<unknown>) => work(),
      backgroundArrivalEnabled: async () => enabled, saveBackgroundArrivalEnabled: async (value: boolean) => { enabled = value; },
      readArrivalCatalog: async () => [], readArrivalState: async () => emptyReminderState(), saveArrivalState: async () => {}, clearArrivalStorage: async () => {},
    },
  };
  const exports = {} as Service;
  vm.runInNewContext(ts.transpileModule(readFileSync("src/services/backgroundArrival.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: (name: string) => modules[name] ?? assert.fail(`unexpected import ${name}`) });
  return { service: exports, steps, widget, appState, task: () => task!, options: () => options, enabled: () => enabled, explain: async () => { steps.push("explain"); return explain; } };
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

