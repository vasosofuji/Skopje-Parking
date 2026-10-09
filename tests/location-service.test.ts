import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("Android's Location Accuracy dialog is offered once per launch, not on every poll or watch", async () => {
  const requests: { mayShowUserSettingsDialog?: boolean }[] = [];
  let adapter: Record<string, (...args: unknown[]) => unknown> | undefined;
  const module = { exports: {} as { watchLocation: (onFix: () => void, onIssue: () => void) => Promise<unknown> }, require(name: string) {
    if (name === "expo-location") return {
      Accuracy: { High: 4 },
      getCurrentPositionAsync: async (options: { mayShowUserSettingsDialog?: boolean }) => { requests.push(options); return { coords: {}, timestamp: 0 }; },
      watchPositionAsync: async (options: { mayShowUserSettingsDialog?: boolean }) => { requests.push(options); return { remove() {} }; },
      getForegroundPermissionsAsync: async () => ({}), requestForegroundPermissionsAsync: async () => ({}),
      hasServicesEnabledAsync: async () => true, enableNetworkProviderAsync: async () => {}, getLastKnownPositionAsync: async () => null,
    };
    if (name === "react-native") return { Platform: { OS: "android" } };
    if (name === "../domain/locationWatch") return { startNativeLocation: (value: typeof adapter) => { adapter = value; return () => {}; } };
    throw new Error(`Unexpected location dependency: ${name}`);
  } };
  runInNewContext(ts.transpileModule(readFileSync("src/services/location.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, module);
  await module.exports.watchLocation(() => {}, () => {});
  await adapter!.current();
  await adapter!.current();
  await adapter!.watch(() => {}, () => {});
  await module.exports.watchLocation(() => {}, () => {});
  await adapter!.current();
  assert.deepEqual(requests.map(r => r.mayShowUserSettingsDialog), [true, false, false, false]);
});
