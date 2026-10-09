import test from "node:test";
import assert from "node:assert/strict";
import { ArrivalDetector, ARRIVAL_COOLDOWN_MS, type Fix } from "../src/domain/arrival";
import {
  advanceArrival,
  acknowledgeArrivalReport,
  ARRIVAL_REMINDER_KIND,
  emptyReminderState,
  freshPendingArrival,
  openArrivalNotification,
  REMINDER_EXPIRY_MS,
} from "../src/domain/backgroundArrival";
import type { ParkingPlace } from "../src/domain/types";
const start = Date.parse("2026-10-01T12:00:00Z");
const place: ParkingPlace = {
  id: "arrival-test", name: "Parking", coordinate: { latitude: 41.996, longitude: 21.432 },
  kind: "surface", operator: null, zoneCode: null, access: "public", tariff: null,
  capacity: null, openingHours: null, verification: "community",
  source: { label: "test", url: "", retrievedAt: new Date(start).toISOString() },
};
const fix = (seconds: number, changes: Partial<Fix> = {}): Fix => ({
  ...place.coordinate, accuracy: 8, speed: 0, timestamp: start + seconds * 1000, ...changes,
});
const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test("headless relaunch preserves dwell and cooldown; foreground and background share suppression", () => {
  const initial = advanceArrival(emptyReminderState(), [fix(0)], [place], true, start);
  const saved = roundTrip(initial.state);
  const reloaded = advanceArrival(roundTrip(initial.state), [fix(5), fix(10)], [place], true, start + 10000);
  advanceArrival(initial.state, [fix(5)], [place], false, start + 5000);
  assert.deepEqual(initial.state, saved, "advancing cannot mutate a previously persisted snapshot");
  assert.equal(reloaded.place?.id, place.id);
  assert.equal(reloaded.state.pending?.placeId, place.id);
  const next = advanceArrival(roundTrip({ ...reloaded.state, pending: null }), [fix(20)], [place], false, start + 20000);
  assert.equal(next.place, null);
  const later = start + ARRIVAL_COOLDOWN_MS + 20000;
  const d = new ArrivalDetector(roundTrip(reloaded.state.detector));
  assert.equal(d.update({ ...fix(0), timestamp: later }, [place], later), null);
  assert.equal(d.update({ ...fix(0), timestamp: later + 10000 }, [place], later + 10000)?.id, place.id);
});

test("notification tap accepts only the exact persisted pending reminder and expires old taps", () => {
  const result = advanceArrival(emptyReminderState(), [fix(0), fix(10)], [place], true, start + 10000);
  const pending = result.state.pending!;
  const data = { kind: ARRIVAL_REMINDER_KIND, placeId: place.id, createdAt: pending.createdAt };
  assert.equal(openArrivalNotification(roundTrip(result.state), data, start + 20000).pending?.opened, true);
  for (const bad of [{ ...data, placeId: "another" }, { ...data, createdAt: 0 }, { ...data, kind: "other" }, { url: "https://outside.example" }, null]) {
    assert.equal(openArrivalNotification(result.state, bad, start + 20000), result.state);
  }
  assert.equal(openArrivalNotification(result.state, data, pending.createdAt + REMINDER_EXPIRY_MS), result.state);
  assert.equal(freshPendingArrival(pending, pending.createdAt - 1), null);
});

test("driving, weak GPS, stale batches and departure never create background reminders", () => {
  for (const changes of [{ speed: 10 }, { accuracy: 80 }, { accuracy: null }, { latitude: NaN }, { speed: NaN }]) {
    const result = advanceArrival(emptyReminderState(), [fix(0, changes), fix(10, changes)], [place], true, start + 10000);
    assert.equal(result.place, null);
    assert.equal(result.state.pending, null);
  }
  assert.equal(advanceArrival(emptyReminderState(), [fix(0), fix(10)], [place], true, start + 60000).place, null);
  const departed = advanceArrival(emptyReminderState(), [fix(0), fix(10), fix(15, { latitude: 42.1 })], [place], true, start + 15000);
  assert.equal(departed.place, null);
  assert.deepEqual(departed.state.detector.prompted, []);
});

test("batch sorting tolerates delayed delivery but never invents dwell across a long GPS gap", () => {
  assert.equal(advanceArrival(emptyReminderState(), [fix(10), fix(0), fix(5)], [place], true, start + 12000).place?.id, place.id);
  const initial = advanceArrival(emptyReminderState(), [fix(0)], [place], true, start);
  assert.equal(advanceArrival(initial.state, [fix(60)], [place], true, start + 60000).place, null);
});

test("dismissed or opened questions suppress only the current visit; reports start the cooldown", () => {
  const first = advanceArrival(emptyReminderState(), [fix(0), fix(10)], [place], true, start + 10000);
  const opened = openArrivalNotification(first.state, { kind: ARRIVAL_REMINDER_KIND, placeId: place.id, createdAt: start + 10000 }, start + 11000);
  const consumed = { ...opened, pending: null };
  assert.deepEqual(consumed.detector.prompted, [], "opening never records a report");
  const staying = advanceArrival(consumed, [fix(20), fix(30)], [place], true, start + 30000);
  assert.equal(staying.place, null);
  const left = advanceArrival(staying.state, [fix(35, { latitude: 42.1 })], [place], false, start + 35000);
  const reentered = advanceArrival(left.state, [fix(40), fix(50)], [place], false, start + 50000);
  assert.equal(reentered.place?.id, place.id, "leaving and returning asks again without a 30-minute wait");
  const reported = acknowledgeArrivalReport(reentered.state, place.id, start + 51000);
  const departed = advanceArrival(reported, [fix(55, { latitude: 42.1 })], [place], false, start + 55000);
  assert.equal(advanceArrival(departed.state, [fix(60), fix(70)], [place], false, start + 70000).place, null, "a submitted report prevents repeat questions");
});

test("background surveyed boundaries exclude holes and do not treat approximate zone labels as parking", () => {
  const zone: ParkingPlace = {
    ...place, kind: "zone", geometry: { type: "Polygon", coordinates: [
      [[21.43, 41.99], [21.44, 41.99], [21.44, 42], [21.43, 42], [21.43, 41.99]],
      [[21.431, 41.995], [21.433, 41.995], [21.433, 41.997], [21.431, 41.997], [21.431, 41.995]],
    ] },
  };
  assert.equal(advanceArrival(emptyReminderState(), [fix(0), fix(10)], [zone], true, start + 10000).place, null);
  const approximate = { ...place, kind: "zone" as const, locationPrecision: "area" as const };
  assert.equal(advanceArrival(emptyReminderState(), [fix(0), fix(10)], [approximate], true, start + 10000).place, null);
  const surveyed = { ...zone, geometry: { ...zone.geometry!, coordinates: [zone.geometry!.coordinates[0]] } };
  assert.equal(advanceArrival(emptyReminderState(), [fix(0), fix(10)], [surveyed], true, start + 10000).place?.id, place.id);
  const pricedZone = { ...surveyed, communityPrice: { firstHour: 30, nextHour: 30, observedAt: new Date(start).toISOString(), reports: 1 } };
  // The API rejects availability for tariff zones, so a priced zone has nothing to ask.
  assert.equal(advanceArrival(emptyReminderState(), [fix(0), fix(10)], [pricedZone], true, start + 10000).place, null, "known-price zones do not prompt");
  const tariff = { ...pricedZone, id: "poc:zone:1:0", operator: "poc", zoneCode: "POC 1" };
  assert.equal(advanceArrival(emptyReminderState(), [fix(0), fix(10)], [tariff], true, start + 10000).place, null, "large tariff overlays cannot block the SMS prompt");
  assert.equal(advanceArrival(emptyReminderState(), [fix(0), fix(10)], [{ ...pricedZone, id: "zone" }, place], true, start + 10000).place?.id, place.id, "a real parking facility still asks about availability inside a known-price zone");
});


test("a batch rejected before delivery does not suppress the next accurate arrival", () => {
  const rejected = advanceArrival(emptyReminderState(), [fix(0), fix(10), fix(12, { accuracy: 80 })], [place], true, start + 12000);
  assert.equal(rejected.place, null);
  assert.equal(rejected.state.detector.visit, null);
  const retry = advanceArrival(rejected.state, [fix(15), fix(25)], [place], true, start + 25000);
  assert.equal(retry.place?.id, place.id);
});
