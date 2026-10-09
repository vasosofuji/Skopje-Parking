import test from "node:test";
import assert from "node:assert/strict";
import { createDeviceVehicleStore, DEVICE_VEHICLE_KEY } from "../src/domain/device-vehicle-store";
import { isCompactLicensePlate, normalizeLicensePlate, smsDraftUri, type PendingSmsStop } from "../src/domain/license-plate";

const stop: PendingSmsStop = { zoneId: "poc-d8", zoneName: "D8", recipient: "144144", stopMessage: "STOP", photoId: "photo-one", protocolExpiresAt: "2026-12-01T00:00:00Z", openedAt: 1790980000000, plate: "SK1234AB" };
function memory() {
  const values = new Map<string, string>();
  let fail = false;
  const storage = {
    async getItem(key: string) { return values.get(key) ?? null; },
    async setItem(key: string, value: string) { if (fail) throw new Error("storage unavailable"); values.set(key, value); },
    async removeItem(key: string) { if (fail) throw new Error("storage unavailable"); values.delete(key); },
  };
  return { values, storage, store: createDeviceVehicleStore(storage), fail: (value: boolean) => { fail = value; } };
}

test("plates require two city letters, three or four digits and two serial letters, saved as compact Latin text", () => {
  for (const [raw, compact] of [["sk 1234-ab", "SK1234AB"], ["OH1234FF", "OH1234FF"], ["gv 0000 zz", "GV0000ZZ"], ["SK1234FF", "SK1234FF"], ["sk 123-ab", "SK123AB"]]) {
    assert.equal(normalizeLicensePlate(raw), compact);
    assert.equal(isCompactLicensePlate(compact), true);
  }
  for (const invalid of [null, 1234, "", "A1", "ABC", "12345", "AB12CDE", "B-AB123", "34ABC123", "SK12FF", "SK12345FF", "S1234FF", "SK1234F", "SK1234FFF", "1234SKFF", "SK12FF34", "SK\n1234AB", "SK\t1234AB", "ЅК1234АВ", "AB&body=STOP", " AB123\u200b", "ABC123;456", "AB/123", "ABCDEFGHIJK123"]) assert.equal(normalizeLicensePlate(invalid), null, String(invalid));
  for (const noncompact of ["sk1234ff", "SK 1234 FF", "SK-1234-FF"]) assert.equal(isCompactLicensePlate(noncompact), false);
  assert.equal(smsDraftUri("144144", "D8 SK1234AB", false), "sms:144144?body=D8%20SK1234AB");
  assert.equal(smsDraftUri("144144", "D8 SK1234AB", true), "sms:144144&body=D8%20SK1234AB");
  assert.equal(smsDraftUri("144144,911", "D8 SK1234AB", false), null);
  assert.equal(smsDraftUri("144144", "D8 SK1234AB\nSTOP", true), null);
});

test("plate and pending stop hydrate only for their owner, and switch/logout clear device records", async () => {
  const local = memory(); await local.store.select("account-a");
  await local.store.savePlate("SK 1234 AB"); await local.store.setPendingStop(stop);
  const restored = createDeviceVehicleStore(local.storage); await restored.select("account-a");
  assert.equal(restored.getSnapshot().savedPlate, "SK1234AB"); assert.deepEqual(restored.getSnapshot().pendingStop, stop);
  const switchAccount = restored.select("account-b");
  assert.equal(restored.getSnapshot().savedPlate, null); assert.equal(restored.getSnapshot().pendingStop, null);
  await switchAccount; assert.equal(local.values.has(DEVICE_VEHICLE_KEY), false);
  await restored.savePlate("OH1234 FF"); await restored.select(null);
  assert.equal(local.values.has(DEVICE_VEHICLE_KEY), false); assert.equal(restored.getSnapshot().savedPlate, null);
});

test("later plate edits preserve the original stop message, while corrupt stored or supplied drafts are rejected", async () => {
  const local = memory(); await local.store.select("a"); await local.store.savePlate(stop.plate); await local.store.setPendingStop(stop);
  await local.store.savePlate("GV5678CD"); assert.deepEqual(local.store.getSnapshot().pendingStop, stop);
  await assert.rejects(local.store.setPendingStop({ ...stop, stopMessage: "STOP;send=1" }));
  local.values.set(DEVICE_VEHICLE_KEY, JSON.stringify({ version: 1, accountId: "a", savedPlate: "URL&body=bad", pendingStop: { ...stop, recipient: "144144,911" } }));
  const restored = createDeviceVehicleStore(local.storage); await restored.select("a");
  assert.equal(restored.getSnapshot().savedPlate, null); assert.equal(restored.getSnapshot().pendingStop, null);
});

test("failed saves preserve the last plate, and optional setup remains skippable during storage failure", async () => {
  const local = memory(); await local.store.requestPrompt("a"); assert.equal(local.store.getSnapshot().offerPlate, true);
  local.fail(true); await assert.rejects(local.store.dismissPrompt()); assert.equal(local.store.getSnapshot().offerPlate, false);
  local.fail(false); await local.store.savePlate(stop.plate);
  local.fail(true); await assert.rejects(local.store.savePlate("GV5678CD")); assert.equal(local.store.getSnapshot().savedPlate, stop.plate);
  await assert.rejects(local.store.select(null)); assert.equal(local.store.getSnapshot().savedPlate, null);
});

test("an in-flight write cannot survive a logout or publish into another account", async () => {
  const values = new Map<string, string>(); let release!: () => void, started!: () => void;
  const writing = new Promise<void>(resolve => { started = resolve; });
  const local = createDeviceVehicleStore({
    async getItem(key) { return values.get(key) ?? null; }, async removeItem(key) { values.delete(key); },
    async setItem(key, value) { started(); await new Promise<void>(resolve => { release = resolve; }); values.set(key, value); },
  });
  await local.select("a"); const save = local.savePlate(stop.plate); await writing;
  const logout = local.select(null); assert.equal(local.getSnapshot().savedPlate, null);
  release(); await assert.rejects(save, /account changed/); await logout;
  assert.equal(values.has(DEVICE_VEHICLE_KEY), false); assert.equal(local.getSnapshot().accountId, null);
});

test("callbacks captured by an old account cannot save a plate or SMS after switching or signing in again", async () => {
  const local = memory(); await local.store.select("a"); const accountA = local.store.forAccount("a");
  await local.store.select("b"); await local.store.savePlate("GV5678CD");
  await assert.rejects(accountA.savePlate(stop.plate), /account changed/);
  await assert.rejects(accountA.setPendingStop(stop), /account changed/);
  await assert.rejects(accountA.dismissPrompt(), /account changed/);
  await assert.rejects(accountA.clearPendingStop(), /account changed/);
  assert.equal(local.store.getSnapshot().savedPlate, "GV5678CD"); assert.equal(local.store.getSnapshot().pendingStop, null);
  await local.store.select(null); await local.store.select("a");
  await assert.rejects(accountA.setPendingStop(stop), /account changed/, "same ID does not revive callbacks from a logged-out session");
});

test("old malformed stored plates are rejected and correction is offered; save rejects them without changing the plate", async () => {
  const local = memory();
  local.values.set(DEVICE_VEHICLE_KEY, JSON.stringify({ version: 1, accountId: "a", savedPlate: "AB12CDE", pendingStop: { ...stop, plate: "AB12CDE" }, offerPlate: false }));
  await local.store.select("a");
  assert.equal(local.store.getSnapshot().savedPlate, null);
  assert.equal(local.store.getSnapshot().pendingStop, null);
  assert.equal(local.store.getSnapshot().offerPlate, true);
  await local.store.savePlate("sk 1234-ff");
  assert.equal(local.store.getSnapshot().savedPlate, "SK1234FF");
  assert.equal(local.store.getSnapshot().offerPlate, false);
  await assert.rejects(local.store.savePlate("SK12FF"), /valid license plate/);
  assert.equal(local.store.getSnapshot().savedPlate, "SK1234FF");
  await local.store.savePlate("");
  assert.equal(local.store.getSnapshot().savedPlate, null);
});
