import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as reminders from "../src/domain/backgroundArrival";
import type * as ArrivalStorage from "../src/services/arrivalStorage";
function fixture(beforeWrite: (key: string, value: string) => Promise<void> = async () => {}) {
  const items = new Map<string, string>();
  const storage = { getItem: async (key: string) => items.get(key) ?? null, setItem: async (key: string, value: string) => { await beforeWrite(key, value); items.set(key, value); }, removeItem: async (key: string) => { items.delete(key); } };
  const exports = {} as typeof ArrivalStorage;
  const source = ts.transpileModule(readFileSync("src/services/arrivalStorage.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { exports, require(name: string) {
    if (name === "@react-native-async-storage/async-storage") return { __esModule: true, default: storage };
    if (name === "../domain/backgroundArrival") return reminders;
    throw Error(name);
  } });
  return { items, service: exports };
}
test("reported cooldowns are account-scoped, survive opt-out/signout, and never inherit legacy shown prompts", async () => {
  const { items, service } = fixture(), now = Date.now();
  items.set("parkskopje-arrival-state-v1", JSON.stringify({ ...reminders.emptyReminderState(), detector: { candidate: null, prompted: [["legacy-shown", now]] } }));
  await service.selectArrivalAccount("alice");
  assert.equal((await service.readArrivalState()).detector.prompted.length, 0);
  const report = reminders.acknowledgeArrivalReport(reminders.emptyReminderState(), "parking", now);
  await service.saveArrivalState(report);
  await service.selectArrivalAccount("bob");
  assert.equal((await service.readArrivalState()).detector.prompted.length, 0);
  await service.selectArrivalAccount(null);
  assert.equal((await service.readArrivalState()).detector.prompted.length, 0);
  await service.selectArrivalAccount("alice");
  assert.equal((await service.readArrivalState()).detector.prompted[0][0], "parking");
  await service.clearArrivalStorage();
  assert.equal((await service.readArrivalState()).detector.prompted[0][0], "parking");
  assert.equal((await service.readArrivalState()).pending, null);
});
test("in-flight report acknowledgement remains attributed to its captured account", async () => {
  const { service } = fixture();
  await service.selectArrivalAccount("alice");
  await service.selectArrivalAccount("bob");
  await service.arrivalTransaction(async () => service.saveArrivalState(reminders.acknowledgeArrivalReport(await service.readArrivalState("alice"), "alice-lot"), "alice"));
  assert.equal((await service.readArrivalState()).detector.prompted.length, 0);
  assert.equal((await service.readArrivalState("alice")).detector.prompted[0][0], "alice-lot");
});


test("capturing a report account waits for in-flight account selection before reading storage", async () => {
  let release!: () => void;
  const { service } = fixture(async (key, value) => {
    if (key === "parkskopje-arrival-account-v2" && value === "bob") await new Promise<void>(resolve => { release = resolve; });
  });
  await service.selectArrivalAccount("alice");
  const selecting = service.selectArrivalAccount("bob");
  await new Promise(resolve => setImmediate(resolve));
  let captured: string | null | undefined;
  const binding = service.captureArrivalAccount().then(value => { captured = value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(captured, undefined, "new profile must not bind to old stored account");
  release(); await Promise.all([selecting, binding]);
  assert.equal(captured, "bob");
});
