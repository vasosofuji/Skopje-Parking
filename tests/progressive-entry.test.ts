import assert from "node:assert/strict";
import test from "node:test";
import { createProgressiveEntry, priceInput, spacesInput, manualPriceInput, manualSpacesInput, incompleteManualStep, type EntryApi } from "../src/domain/progressive-entry";
import { availabilityIsFresh, createEntryDraftStore, entryDraftKey, readEntryDraft, type DraftStorage, type EntryDraft } from "../src/domain/entry-drafts";
import type { Contribution, ParkingPlace } from "../src/domain/types";
const place = { id: "park-1", zoneCode: null, capacity: null } as ParkingPlace;
const contribution: Contribution = { requestId: "once", name: "Parking", coordinate: { latitude: 42, longitude: 21.4 }, kind: "surface", zoneCode: null, firstHour: null, nextHour: null };
function client(overrides: Partial<EntryApi> = {}) {
  const calls: unknown[][] = [];
  const api: EntryApi = {
    contribute: async value => { calls.push(["create", value]); return { ...place, zoneCode: value.zoneCode }; },
    label: async (...values) => { calls.push(["label", ...values]); }, price: async (...values) => { calls.push(["price", ...values]); },
    paymentSchedule: async (...values) => { calls.push(["paymentSchedule", ...values]); },
    capacity: async (...values) => { calls.push(["capacity", ...values]); }, report: async (...values) => { calls.push(["report", ...values]); }, boundary: async (...values) => { calls.push(["boundary", ...values]); }, ...overrides,
  };
  return { calls, api };
}
test("zone creates a pin once and later completed steps save independently", async () => {
  const { calls, api } = client(), writer = createProgressiveEntry(api, { contribution });
  await writer.label("B2");
  assert.equal(writer.id(), "park-1");
  assert.equal(calls.length, 1);
  await writer.price(40, 50);
  await writer.spaces(20, 8);
  assert.deepEqual(calls.map(value => value[0]), ["create", "price", "capacity", "report"]);
  await writer.label("B2"); await writer.price(40, 50); await writer.spaces(20, 8);
  assert.equal(calls.length, 4);
});
test("thank-you tracking excludes empty creation and unchanged existing details", async () => {
  const empty = client(), newEntry = createProgressiveEntry(empty.api, { contribution });
  await newEntry.ensure(); assert.equal(newEntry.snapshot().contributed, undefined);
  const existing = { ...place, zoneCode: "B2", capacity: 20, tariff: { firstHour: 40, nextHour: 40 }, paymentSchedule: { chargingHours: "Mon-Fri 07:00-23:00", freeWeekends: "both" } } as ParkingPlace;
  const { api, calls } = client(), writer = createProgressiveEntry(api, { place: existing });
  await writer.label("B2"); await writer.price(40, 40); await writer.spaces(20, null); await writer.paymentSchedule(existing.paymentSchedule!);
  assert.equal(writer.snapshot().contributed, undefined); assert.deepEqual(calls, []);
});
test("thank-you tracking waits for successful writes and persists across reopening", async () => {
  const failing = client({ price: async () => { throw new Error("offline"); } }), writer = createProgressiveEntry(failing.api, { place });
  await assert.rejects(writer.price(0, 0)); assert.equal(writer.snapshot().contributed, undefined);
  const success = client(), retry = createProgressiveEntry(success.api, { place, snapshot: writer.snapshot() });
  await retry.price(0, 0); assert.equal(retry.snapshot().contributed, true);
  assert.equal(createProgressiveEntry(success.api, { place, snapshot: retry.snapshot() }).snapshot().contributed, true);
});
test("a new zone label and removing a known schedule are substantive contributions", async () => {
  const { api } = client(), created = createProgressiveEntry(api, { contribution });
  await created.label("B2"); assert.equal(created.snapshot().contributed, true);
  const edit = createProgressiveEntry(api, { place, snapshot: { code: null, total: null, price: "", boundary: "", schedule: JSON.stringify({ chargingHours: "Mon 07:00-23:00", freeWeekends: null }) } });
  await edit.paymentSchedule({ chargingHours: null, freeWeekends: null }); assert.equal(edit.snapshot().contributed, true);
});
test("a failed later step leaves completed zone saved and retries without another pin", async () => {
  let tries = 0;
  const { calls, api } = client({ price: async () => { if (++tries === 1) throw new Error("offline"); } });
  const writer = createProgressiveEntry(api, { contribution });
  await writer.label("B1");
  await assert.rejects(writer.price(20, 20), /offline/);
  assert.equal(writer.snapshot().code, "B1");
  await writer.price(20, 20);
  assert.equal(calls.filter(value => value[0] === "create").length, 1);
});
test("serialized writes wait for creation and preserve explicit step order", async () => {
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { api } = client({ contribute: async value => { events.push("creating"); await gate; return { ...place, zoneCode: value.zoneCode }; }, price: async () => { events.push("price"); } });
  const writer = createProgressiveEntry(api, { contribution });
  const first = writer.label("A0"), second = writer.price(0, 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ["creating"]);
  release(); await Promise.all([first, second]);
  assert.deepEqual(events, ["creating", "price"]);
});
test("a reopened failed capacity/report step does not repeat its completed capacity update", async () => {
  const { calls, api } = client({ report: async () => { throw new Error("offline"); } });
  const writer = createProgressiveEntry(api, { place });
  await assert.rejects(writer.spaces(10, 4));
  const next = client(), reopened = createProgressiveEntry(next.api, { place, snapshot: writer.snapshot() });
  await reopened.spaces(10, 4);
  assert.deepEqual(calls, [["capacity", "park-1", 10]]);
  assert.deepEqual(next.calls, [["report", "park-1", "spaces", 4]]);
});
test("post-sign details update the already-created pin without repeating zone, price or creation", async () => {
  const { calls, api } = client(), writer = createProgressiveEntry(api, { place });
  await writer.spaces(20, 4);
  await writer.boundary({ type: "Polygon", coordinates: [[[21.43, 42], [21.431, 42], [21.431, 42.001], [21.43, 42]]] });
  assert.deepEqual(calls.map(call => call[0]), ["capacity", "report", "boundary"]);
  assert.ok(calls.every(call => call[1] === "park-1"));
});
test("manual fallback reuses the photo-created identity even before catalog refresh", async () => {
  const { calls, api } = client(), writer = createProgressiveEntry(api, { placeId: "photo-created" });
  await writer.label("B2"); await writer.price(40, 40);
  assert.equal(writer.id(), "photo-created");
  assert.deepEqual(calls, [["label", "photo-created", "B2"], ["price", "photo-created", 40, 40]]);
});
test("failed initial creation retries the same request identity", async () => {
  const ids: string[] = [];
  const { api } = client({ contribute: async value => { ids.push(value.requestId); if (ids.length === 1) throw new Error("timeout"); return place; } });
  const writer = createProgressiveEntry(api, { contribution });
  await assert.rejects(writer.ensure()); await writer.ensure();
  assert.deepEqual(ids, ["once", "once"]);
});
test("price and count inputs retain zero and reject impossible counts", () => {
  assert.deepEqual(priceInput("0", ""), { first: 0, next: 0 });
  assert.deepEqual(priceInput("12,5", "15"), { first: 12.5, next: 15 });
  assert.equal(priceInput("", ""), null);
  assert.throws(() => priceInput("", "20"));
  assert.throws(() => priceInput("-5", ""));
  assert.deepEqual(spacesInput("20", "0"), { total: 20, available: 0 });
  assert.throws(() => spacesInput("20", "21"));
  assert.throws(() => spacesInput("", "21", 20));
  assert.throws(() => spacesInput("1.5", "1"));
});
test("manual entry requires pricing and capacity but never an availability count", () => {
  assert.throws(() => manualPriceInput("", ""), /price-required/);
  assert.deepEqual(manualPriceInput("0", ""), { first: 0, next: 0 });
  assert.deepEqual(manualPriceInput("40", ""), { first: 40, next: 40 });
  assert.throws(() => manualSpacesInput(""), /spaces-required/);
  assert.deepEqual(manualSpacesInput("20"), { total: 20, available: null });
  assert.deepEqual(manualSpacesInput("0"), { total: 0, available: null });
  assert.throws(() => manualSpacesInput("1.5"), /spaces-range/);
});
test("unfinished and legacy done drafts retain earlier saves but require missing details", () => {
  const base = { id: "park-1", code: null, total: null, price: "", boundary: "" };
  const simple = { detailed: false, zone: false, afterSign: false };
  const detailed = { ...simple, detailed: true };
  const geometry = { type: "Polygon" as const, coordinates: [[[21.43, 42], [21.431, 42], [21.431, 42.001], [21.43, 42]]] };
  assert.equal(incompleteManualStep(base, simple), "price");
  assert.equal(incompleteManualStep({ ...base, price: "0:0" }, simple), null);
  assert.equal(incompleteManualStep({ ...base, price: "0:0" }, detailed), "spaces");
  assert.equal(incompleteManualStep({ ...base, price: "0:0", total: 20 }, detailed), "perimeter");
  assert.equal(incompleteManualStep({ ...base, price: "0:0", total: 20, free: 0 }, detailed), "perimeter");
  assert.equal(incompleteManualStep({ ...base, price: "0:0", total: 20, free: 0 }, { ...detailed, geometry }), null);
  assert.equal(incompleteManualStep({ ...base, price: "0:0" }, { ...detailed, zone: true, geometry }), null);
  assert.equal(incompleteManualStep({ ...base, total: 20, free: 0 }, { ...detailed, afterSign: true, geometry }), null);
  assert.equal(incompleteManualStep({ ...base, price: "0:0", total: 20, free: 0 }, { ...detailed, geometry: { type: "Polygon", coordinates: [[[21.4, 42], [21.4, 42], [21.4, 42], [21.4, 42]]] } }), "perimeter");
});
test("an unchanged imported perimeter with holes fulfills detailed entry", () => {
  const geometry = { type: "Polygon" as const, coordinates: [[[21.43, 42], [21.431, 42], [21.431, 42.001], [21.43, 42]], [[21.4301, 42.0001], [21.4302, 42.0001], [21.4302, 42.0002], [21.4301, 42.0001]]] };
  const snapshot = { code: null, total: 20, free: 4, price: "40:40", boundary: JSON.stringify(geometry) };
  assert.equal(incompleteManualStep(snapshot, { detailed: true, zone: false, afterSign: false, geometry, existingGeometry: geometry }), null);
});
function storage() {
  const values = new Map<string, string>();
  const io: DraftStorage = { getItem: async key => values.get(key) ?? null, multiSet: async pairs => { for (const [key, value] of pairs) values.set(key, value); }, multiRemove: async keys => { keys.forEach(key => values.delete(key)); } };
  return { values, io };
}
const draft = (): EntryDraft => ({ version: 1, updatedAt: Date.now(), requestId: "once", step: "price", detailed: true, code: "B2", first: "", next: "", capacity: "", freeSpaces: "", pending: { type: "label", code: "B2" } });
test("durable pending intent survives reopening and is isolated to its account", async () => {
  const { io } = storage(), key = entryDraftKey("user-a", "coordinate");
  const local = createEntryDraftStore(io, "user-a", key, draft());
  await local.update({ first: "40" });
  assert.deepEqual((await readEntryDraft(io, key))?.pending, { type: "label", code: "B2" });
  assert.equal(await readEntryDraft(io, entryDraftKey("user-b", "coordinate")), null);
});
test("typing updates cannot erase pending writes, and finishing clears both pin aliases", async () => {
  const { io, values } = storage(), key = entryDraftKey("user-a", "coordinate");
  const local = createEntryDraftStore(io, "user-a", key, draft());
  const saving = local.update({ pending: { type: "price", first: 40, next: 40 } });
  const typing = local.update({ capacity: "12" });
  await Promise.all([saving, typing]);
  assert.equal((await readEntryDraft(io, key))?.pending?.type, "price");
  await local.update({ snapshot: { id: "park-1", code: "B2", total: null, price: "40:40", boundary: "" }, pending: null });
  const alias = entryDraftKey("user-a", "park-1"), restored = await readEntryDraft(io, alias);
  assert.equal(restored?.capacity, "12");
  const reopened = createEntryDraftStore(io, "user-a", alias, restored!);
  await reopened.clear();
  assert.equal(values.size, 0);
});
test("old drafts keep capacity but never replay stale free-space estimates", async () => {
  const { io, values } = storage(), key = entryDraftKey("user-a", "park-1"), old = draft();
  old.updatedAt = 0; old.freeSpaces = "6"; old.pending = { type: "spaces", total: 20, available: 6 };
  values.set(key, JSON.stringify(old));
  const restored = await readEntryDraft(io, key, 16 * 60_000);
  assert.equal(restored?.freeSpaces, "");
  assert.deepEqual(restored?.pending, { type: "spaces", total: 20, available: null });
});
test("editing another field does not renew an old availability observation", async () => {
  const { io, values } = storage(), key = entryDraftKey("user-a", "park-1"), old = draft();
  old.updatedAt = 30 * 60_000; old.freeSpaces = "6"; old.freeObservedAt = 0;
  old.pending = { type: "spaces", total: 20, available: 6, observedAt: 0 };
  values.set(key, JSON.stringify(old));
  const restored = await readEntryDraft(io, key, 30 * 60_000);
  assert.equal(restored?.freeSpaces, "");
  assert.equal(restored?.pending?.type === "spaces" && restored.pending.available, null);
  assert.equal(availabilityIsFresh(0, 30 * 60_000), false);
  assert.equal(availabilityIsFresh(29 * 60_000, 30 * 60_000), true);
});

test("payment schedules retry and deduplicate across draft restoration", async () => {
  let attempts = 0;
  const { api } = client({ paymentSchedule: async () => { if (++attempts === 1) throw new Error("offline"); } });
  const writer = createProgressiveEntry(api, { place });
  const value = { chargingHours: "Mon-Sat 07:00-23:00", freeWeekends: "sunday" as const };
  await assert.rejects(writer.paymentSchedule(value), /offline/);
  assert.equal(writer.snapshot().schedule, undefined);
  await writer.paymentSchedule(value);
  const next = client(), reopened = createProgressiveEntry(next.api, { place, snapshot: writer.snapshot() });
  await reopened.paymentSchedule(value);
  assert.equal(next.calls.length, 0);
});
