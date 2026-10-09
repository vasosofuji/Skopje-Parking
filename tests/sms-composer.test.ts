import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as plates from "../src/domain/license-plate";
type Result = "opened" | "cancelled" | "unsupported" | "error";

function composer(os = "android", agent = "", result = "unknown", available: Promise<boolean> = Promise.resolve(true)) {
  const drafts: string[][] = [], urls: string[] = [];
  let fails = false;
  const module = { exports: {} as { openSmsComposer(recipient: string, message: string, beforeOpen?: () => boolean): Promise<Result> }, navigator: { userAgent: agent }, require(name: string) {
    if (name === "react-native") return { Platform: { OS: os } };
    if (name === "../domain/license-plate") return plates;
    if (name === "expo-sms") return { isAvailableAsync: () => available, sendSMSAsync: async (recipient: string, message: string) => { if (fails) throw new Error("composer unavailable"); drafts.push([recipient, message]); return { result }; } };
    if (name === "expo-linking") return { openURL: async (uri: string) => { if (fails) throw new Error("no handler"); urls.push(uri); } };
    throw new Error(`Unexpected SMS dependency: ${name}`);
  } };
  runInNewContext(ts.transpileModule(readFileSync("src/services/smsComposer.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, module);
  return { open: module.exports.openSmsComposer, drafts, urls, fail: () => { fails = true; } };
}

test("native SMS opens only a composer, preserves cancellation, and reports no payment success", async () => {
  const native = composer(); assert.equal(native.drafts.length, 0);
  assert.equal(await native.open("144144", "D8 SK1234AB"), "opened"); assert.deepEqual(native.drafts, [["144144", "D8 SK1234AB"]]);
  const cancelled = composer("ios", "", "cancelled"); assert.equal(await cancelled.open("144144", "D8 SK1234AB"), "cancelled");
  assert.equal(await composer("ios", "", "sent").open("144144", "D8 SK1234AB"), "opened");
  assert.equal(await composer("ios", "", "unknown", Promise.resolve(false)).open("144144", "D8 SK1234AB"), "unsupported");
  native.fail(); assert.equal(await native.open("144144", "D8 SK1234AB"), "error");
});

test("availability checks cannot open a stale draft after the user leaves or changes account", async () => {
  let ready!: (value: boolean) => void, valid = true;
  const native = composer("android", "", "unknown", new Promise(resolve => { ready = resolve; }));
  const opening = native.open("144144", "D8 SK1234AB", () => valid);
  valid = false; ready(true); assert.equal(await opening, "cancelled"); assert.equal(native.drafts.length, 0);
});

test("mobile web uses encoded SMS URIs, desktop falls back, and malicious draft text never launches", async () => {
  const iphone = composer("web", "iPhone Safari"); assert.equal(await iphone.open("144144", "D8 SK1234AB"), "opened"); assert.equal(iphone.urls[0], "sms:144144&body=D8%20SK1234AB");
  const android = composer("web", "Android Chrome"); assert.equal(await android.open("144144", "D8 SK1234AB"), "opened"); assert.equal(android.urls[0], "sms:144144?body=D8%20SK1234AB");
  const desktop = composer("web", "Windows Chrome"); assert.equal(await desktop.open("144144", "D8 SK1234AB"), "unsupported"); assert.equal(desktop.urls.length, 0);
  for (const [recipient, text] of [["144144;911", "STOP"], ["144144", "D8 SK1234AB&body=STOP"], ["144144", "STOP\nSTOP"], ["144144", "STOP,123"]]) assert.equal(await android.open(recipient, text), "error");
  assert.equal(android.urls.length, 1);
});
