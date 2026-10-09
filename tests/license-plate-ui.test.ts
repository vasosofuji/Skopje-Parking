import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createDeviceVehicleStore } from "../src/domain/device-vehicle-store";
import * as plates from "../src/domain/license-plate";
type Element = { type: unknown; props: Record<string, unknown>; children: unknown[] };
const transpile = (file: string) => ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function elements(tree: unknown): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== "object" || !("children" in tree)) return [];
  const element = tree as Element; return [element, ...element.children.flatMap(elements)];
}
function stateHooks() {
  const values: unknown[] = []; let cursor = 0;
  const react = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    createContext: () => ({ Provider: "Provider" }), useEffect() {}, useCallback: (callback: unknown) => callback,
    useState(initial: unknown) { const index = cursor++; if (!(index in values)) values[index] = initial; return [values[index], (value: unknown) => { values[index] = value; }]; },
    useRef(initial: unknown) { const index = cursor++; return values[index] ?? (values[index] = { current: initial }); },
  };
  return { react, start: () => { cursor = 0; } };
}

test("optional plate setup is empty by default, requires the city/digits/letters format and saves compact uppercase text", async () => {
  const hooks = stateHooks(), saved: string[] = []; let skipped = 0, completed = 0;
  const module = { exports: {} as { default(props: { optional?: boolean; onDone: () => void }): Element }, require(name: string) {
    if (name === "react") return { ...hooks.react, default: hooks.react, __esModule: true };
    if (name === "react-native") return { Keyboard: { dismiss() {} }, Pressable: "Pressable", Text: "Text", TextInput: "TextInput", View: "View" };
    if (name === "../state/LicensePlateContext") return { useLicensePlate: () => ({ savedPlate: null, savePlate: async (value: string) => { saved.push(value); }, dismissPrompt: async () => { skipped++; } }) };
    if (name === "../state/ParkingContext") return { useParking: () => ({ t: (en: string) => en }) };
    if (name === "../state/ThemeContext") return { useTheme: () => ({ colors: {} }) };
    if (name === "../domain/license-plate") return plates;
    if (name === "./StepActions") return { __esModule: true, default: "StepActions" };
    throw new Error(`Unexpected plate dependency: ${name}`);
  } };
  runInNewContext(transpile("src/components/LicensePlateEditor.tsx"), module);
  const render = () => { hooks.start(); return elements(module.exports.default({ optional: true, onDone: () => { completed++; } })); };
  const input = () => render().find(node => node.type === "TextInput")!;
  const actions = () => render().find(node => node.type === "StepActions")!;
  assert.equal(input().props.value, ""); assert.equal(actions().props.disabled, false);
  (input().props.onChangeText as (value: string) => void)("ЅК1234АВ");
  assert.equal(actions().props.disabled, true); assert.ok(render().some(node => node.children.includes("Use 2 city letters, 3-4 numbers and 2 letters (SK1234FF).")));
  const skip = render().find(node => node.type === "Pressable")!; (skip.props.onPress as () => void)(); await flush();
  assert.equal(skipped, 1); assert.equal(saved.length, 0);
  (input().props.onChangeText as (value: string) => void)("sk 1234-ab");
  assert.equal(actions().props.disabled, false); assert.equal(input().props.value, "SK1234AB");
  for (const invalid of ["AB12CDE", "SK12FF", "SK12345FF", "SK1234F", "SK1234FFF"]) {
    (input().props.onChangeText as (value: string) => void)(invalid);
    assert.equal(actions().props.disabled, true, invalid);
  }
  (input().props.onChangeText as (value: string) => void)("sk1234ff");
  assert.equal(input().props.value, "SK1234FF");
  (actions().props.onContinue as () => void)(); await flush(); assert.deepEqual(saved, ["SK1234FF"]); assert.equal(completed, 2);
});

for (const mode of ["register", "guest"] as const) test(`${mode} cannot restore an old account after logout during optional plate hydration`, async () => {
  const hooks = stateHooks(), values = new Map<string, string>(); let release!: () => void, promptStarted!: () => void;
  const started = new Promise<void>(resolve => { promptStarted = resolve; });
  const storage = { async getItem(key: string) { return values.get(key) ?? null; }, async setItem(key: string, value: string) { values.set(key, value); }, async removeItem(key: string) { values.delete(key); } };
  const store = createDeviceVehicleStore(storage);
  const profile = { id: "created", username: "driver", secured: true };
  type Account = { profile: typeof profile | null; register(username: string, accepted: boolean, password: string): Promise<void>; guest(accepted: boolean): Promise<void>; clear(): Promise<void> };
  const apiCalls: unknown[][] = [];
  const module = { exports: {} as { AccountProvider(props: { children: null }): Element }, require(name: string) {
    if (name === "react") return { ...hooks.react, default: hooks.react, __esModule: true };
    if (name === "react-native") return { AppState: { addEventListener: () => ({ remove() {} }) } };
    if (name === "@react-native-async-storage/async-storage") return { __esModule: true, default: storage };
    if (name === "../services/deviceVehicle") return { deviceVehicle: { ...store, async requestPrompt(id: string) { promptStarted(); await new Promise<void>(resolve => { release = resolve; }); await store.requestPrompt(id); } } };
    if (name === "../services/api") return { api: { register: async (...args: unknown[]) => { apiCalls.push(args); return profile; }, guest: async (...args: unknown[]) => { apiCalls.push(args); return profile; } } };
    if (name === "../services/credentials") return { credentials: {} };
    if (name === "../services/arrivalStorage") return { selectArrivalAccount: async () => {} };
    if (name === "../services/backgroundArrival") return { disableBackgroundArrival: async () => {} };
    throw new Error(`Unexpected account dependency: ${name}`);
  } };
  runInNewContext(transpile("src/state/AccountContext.tsx"), module);
  const render = () => { hooks.start(); return module.exports.AccountProvider({ children: null }).props.value as Account; };
  const account = render(), signup = mode === "register" ? account.register("driver", true, "safe-password") : account.guest(true);
  await started; await account.clear(); release(); await signup;
  assert.equal(render().profile, null); assert.equal(values.has("parkskopje-profile"), false);
  assert.deepEqual(apiCalls, mode === "register" ? [["driver", true, "safe-password"]] : [[true]], "plate is never passed to an authentication API");
});

test("a delayed logout cannot erase a newer login or its device-only plate", async () => {
  const hooks = stateHooks(), values = new Map<string, string>(); let finishLogout!: () => void;
  const storage = { async getItem(key: string) { return values.get(key) ?? null; }, async setItem(key: string, value: string) { values.set(key, value); }, async removeItem(key: string) { values.delete(key); } };
  const store = createDeviceVehicleStore(storage);
  type Account = { profile: { id: string } | null; login(username: string, password: string, accepted: boolean): Promise<void>; logout(): Promise<void> };
  const module = { exports: {} as { AccountProvider(props: { children: null }): Element }, require(name: string) {
    if (name === "react") return { ...hooks.react, default: hooks.react, __esModule: true };
    if (name === "react-native") return { AppState: { addEventListener: () => ({ remove() {} }) } };
    if (name === "@react-native-async-storage/async-storage") return { __esModule: true, default: storage };
    if (name === "../services/deviceVehicle") return { deviceVehicle: store };
    if (name === "../services/api") return { api: { login: async (username: string) => ({ id: username, username, secured: true }), logout: () => new Promise<void>(resolve => { finishLogout = resolve; }) } };
    if (name === "../services/credentials") return { credentials: {} };
    if (name === "../services/arrivalStorage") return { selectArrivalAccount: async () => {} };
    if (name === "../services/backgroundArrival") return { disableBackgroundArrival: async () => {} };
    throw new Error(`Unexpected account dependency: ${name}`);
  } };
  runInNewContext(transpile("src/state/AccountContext.tsx"), module);
  const render = () => { hooks.start(); return module.exports.AccountProvider({ children: null }).props.value as Account; };
  const account = render(); await account.login("old", "password", true); await store.savePlate("SK1234AB");
  const logout = account.logout(); await account.login("new", "password", true); await store.savePlate("GV5678CD");
  finishLogout(); await logout;
  assert.equal(render().profile?.id, "new"); assert.equal(store.getSnapshot().accountId, "new"); assert.equal(store.getSnapshot().savedPlate, "GV5678CD");
});

for (const nextId of ["new", "original"]) test(`delete completion cannot clear a newer ${nextId === "original" ? "same-ID" : "different-ID"} login`, async () => {
  const hooks = stateHooks(), values = new Map<string, string>();
  const storage = { async getItem(key: string) { return values.get(key) ?? null; }, async setItem(key: string, value: string) { values.set(key, value); }, async removeItem(key: string) { values.delete(key); } };
  const store = createDeviceVehicleStore(storage);
  type Account = { profile: { id: string } | null; login(username: string, password: string, accepted: boolean): Promise<void>; captureClear(): () => Promise<void> };
  const module = { exports: {} as { AccountProvider(props: { children: null }): Element }, require(name: string) {
    if (name === "react") return { ...hooks.react, default: hooks.react, __esModule: true };
    if (name === "react-native") return { AppState: { addEventListener: () => ({ remove() {} }) } };
    if (name === "@react-native-async-storage/async-storage") return { __esModule: true, default: storage };
    if (name === "../services/deviceVehicle") return { deviceVehicle: store };
    if (name === "../services/api") return { api: { login: async (username: string) => ({ id: username, username, secured: true }) } };
    if (name === "../services/credentials") return { credentials: {} };
    if (name === "../services/arrivalStorage") return { selectArrivalAccount: async () => {} };
    if (name === "../services/backgroundArrival") return { disableBackgroundArrival: async () => {} };
    throw new Error(`Unexpected account dependency: ${name}`);
  } };
  runInNewContext(transpile("src/state/AccountContext.tsx"), module);
  const render = () => { hooks.start(); return module.exports.AccountProvider({ children: null }).props.value as Account; };
  await render().login("original", "password", true);
  const finishDeletion = render().captureClear();
  await render().login(nextId, "password", true); await store.savePlate("GV5678CD"); await finishDeletion();
  assert.equal(render().profile?.id, nextId); assert.equal(store.getSnapshot().savedPlate, "GV5678CD");
  const finishCurrentDeletion = render().captureClear(); await finishCurrentDeletion();
  assert.equal(render().profile, null); assert.equal(store.getSnapshot().savedPlate, null);
});

test("saving a guest account or renewing consent does not re-offer a plate the same driver skipped", async () => {
  const hooks = stateHooks(), values = new Map<string, string>();
  const storage = { async getItem(key: string) { return values.get(key) ?? null; }, async setItem(key: string, value: string) { values.set(key, value); }, async removeItem(key: string) { values.delete(key); } };
  const store = createDeviceVehicleStore(storage);
  const guest = { id: "same-driver", username: "", secured: false, guest: true };
  type Account = { register(username: string, accepted: boolean, password: string): Promise<void>; guest(accepted: boolean): Promise<void> };
  const module = { exports: {} as { AccountProvider(props: { children: null }): Element }, require(name: string) {
    if (name === "react") return { ...hooks.react, default: hooks.react, __esModule: true };
    if (name === "react-native") return { AppState: { addEventListener: () => ({ remove() {} }) } };
    if (name === "@react-native-async-storage/async-storage") return { __esModule: true, default: storage };
    if (name === "../services/deviceVehicle") return { deviceVehicle: store };
    if (name === "../services/api") return { api: { guest: async () => guest, register: async () => ({ ...guest, username: "driver", secured: true, guest: false }) } };
    if (name === "../services/credentials") return { credentials: {} };
    if (name === "../services/arrivalStorage") return { selectArrivalAccount: async () => {} };
    if (name === "../services/backgroundArrival") return { disableBackgroundArrival: async () => {} };
    throw new Error(`Unexpected account dependency: ${name}`);
  } };
  runInNewContext(transpile("src/state/AccountContext.tsx"), module);
  const render = () => { hooks.start(); return module.exports.AccountProvider({ children: null }).props.value as Account; };
  await render().guest(true);
  assert.equal(store.getSnapshot().offerPlate, true, "a new driver is offered the optional plate once");
  await store.dismissPrompt();
  await render().register("driver", true, "safe-password");
  assert.equal(store.getSnapshot().offerPlate, false);
  await render().guest(true);
  assert.equal(store.getSnapshot().offerPlate, false);
});
