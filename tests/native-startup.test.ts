import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createSessionManager } from "../src/services/session";
import { apiEndpoint } from "../src/services/apiEndpoint";

// Load the actual API module before any screen mounts, as the release bundle does.
const source = ts.transpileModule(readFileSync("src/services/api.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

function load(platform: string, window: object, apiUrl?: string, hostUri?: string) {
  let base: string | undefined;
  const context = {
    exports: {}, window,
    process: { env: { EXPO_PUBLIC_API_URL: apiUrl } },
    require(name: string) {
      if (name === "react-native") return { Platform: { OS: platform } };
      if (name === "expo-constants") return { __esModule: true, default: { expoConfig: { hostUri } } };
      if (name === "./transport") return {
        createTransport(value: string) { base = value; return async () => ({}); },
      };
      if (name === "./arrivalStorage") return { captureArrivalAccount: async () => "account", acknowledgeParkingReport: async () => {} };
      if (name === "./credentials") return { credentials: {} };
      if (name === "./session") return { createSessionManager };
      if (name === "./apiEndpoint") return { apiEndpoint };
      if (name === "../domain/account") return { TERMS_VERSION: "test" };
      throw new Error(`Unexpected startup dependency: ${name}`);
    },
  };
  vm.runInNewContext(source, context);
  return base;
}

test("Android and iOS startup tolerate the native window global without location", () => {
  for (const platform of ["android", "ios"]) {
    assert.equal(load(platform, {}, "https://vkqxtqcuoobiijbnpxod.supabase.co/functions/v1/api"),
      "https://vkqxtqcuoobiijbnpxod.supabase.co/functions/v1/api");
    assert.equal(load(platform, {}, undefined, "192.168.1.20:8081"),
      "http://192.168.1.20:3001");
  }
});

test("web development uses the browser hostname and an explicit API overrides it", () => {
  assert.equal(load("web", { location: { hostname: "192.168.1.30" } }),
    "http://192.168.1.30:3001");
  assert.equal(load("web", {}, "https://vkqxtqcuoobiijbnpxod.supabase.co/functions/v1/api"),
    "https://vkqxtqcuoobiijbnpxod.supabase.co/functions/v1/api");
});
