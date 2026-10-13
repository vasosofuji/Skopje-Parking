import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as presentation from "../src/services/notificationPresentation";

type Listener = (event: any) => void;
function worker(clients: { url: string; postMessage(message: unknown): void; focus(): Promise<void> }[] = []) {
  const listeners = new Map<string, Listener>(), shown: { title: string; options: any }[] = [], opened: string[] = [], pending: Promise<unknown>[] = [];
  const self = {
    location: { origin: "https://parking.test" },
    addEventListener: (name: string, listener: Listener) => listeners.set(name, listener),
    registration: { showNotification: async (title: string, options: any) => { shown.push({ title, options }); } },
    clients: { matchAll: async () => clients, openWindow: async (url: string) => { opened.push(url); } },
  };
  vm.runInNewContext(readFileSync("public/parking-sw.js", "utf8"), { self, URL });
  const waitUntil = (promise: Promise<unknown>) => { pending.push(promise); };
  return {
    shown, opened,
    push: async (message: unknown) => { listeners.get("push")!({ data: { json: () => message }, waitUntil }); await Promise.all(pending); },
    click: async (data: unknown) => { listeners.get("notificationclick")!({ notification: { data, close() {} }, waitUntil }); await Promise.all(pending); },
  };
}
const spot = { title: "A spot may open soon near Ramstore", body: "City Mall · Another driver is leaving now.", channelId: "parking-spots", data: { kind: "parking-spot-opening", placeId: "osm:1", destinationId: "osm:2", endsAt: 1 } };

test("the web push worker shows spot alerts and opens the map on their place", async () => {
  const sw = worker();
  await sw.push(spot);
  await sw.push({ ...spot, data: { kind: "parking-destination-full", placeId: "osm:2" } });
  await sw.push({ ...spot, data: { kind: "unknown", placeId: "osm:3" } });
  await sw.push({ ...spot, data: { kind: "parking-spot-opening", placeId: 7 } });
  assert.deepEqual(sw.shown.map(item => [item.title, item.options.tag]), [[spot.title, "parking-spot-opening:osm:1"], [spot.title, "parking-destination-full:osm:2"]]);
  await sw.click(spot.data);
  assert.deepEqual(sw.opened, ["/?placeId=osm%3A1"]);
});

test("an open page gets the tapped spot alert and opens its place", async () => {
  const messages: unknown[] = [];
  const sw = worker([{ url: "https://parking.test/", postMessage: message => messages.push(message), focus: async () => {} }]);
  await sw.click(spot.data);
  assert.deepEqual(sw.opened, []);
  const listeners = new Set<Listener>(), opened: string[] = [];
  const modules: Record<string, unknown> = {
    "expo-constants": { __esModule: true, default: { expoConfig: {} } },
    "expo": { isRunningInExpoGo: () => false, requireOptionalNativeModule: () => null },
    "react-native": { AppState: { currentState: "active" }, Platform: { OS: "web" } },
    "./notificationPresentation": presentation,
  };
  const exports = {} as { listenForPlaceNotifications(open: (id: string) => void): () => void };
  const navigator = { serviceWorker: { addEventListener: (_name: string, listener: Listener) => listeners.add(listener), removeEventListener: (_name: string, listener: Listener) => listeners.delete(listener) } };
  vm.runInNewContext(ts.transpileModule(readFileSync("src/services/placeNotifications.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, navigator, require: (name: string) => modules[name] ?? assert.fail(`unexpected import ${name}`) });
  const stop = exports.listenForPlaceNotifications(placeId => opened.push(placeId));
  for (const message of [...messages, { type: "parking-notification", data: { kind: "parking-arrival", placeId: "osm:9" } }]) listeners.forEach(listener => listener({ data: message }));
  assert.deepEqual(opened, ["osm:1"]);
  stop();
  assert.equal(listeners.size, 0);
});
