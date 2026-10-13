import test from "node:test";
import assert from "node:assert/strict";
import { eligibleSmsZone, smsZoneChoices, ZonePaymentDwell } from "../src/domain/zone-payment";
import { officialSmsPayment } from "../src/domain/skopje-rules";
import { carPaidUntil, carPosition, carSession, paymentSession, sessionId } from "../src/domain/my-car";
import { readSessions, validSession, type ParkingSession } from "../src/domain/parking-sessions";
import { paymentFix, paymentNow, paymentZone } from "./fixtures/zone-payment";
import type { ParkingPlace } from "../src/domain/types";

const ids = (places: ParkingPlace[]) => places.map(place => place.id);
// Gradski street zones are catalog points; meters north of the driver at (42, 21).
const street = (code: string, meters: number, east = 0): ParkingPlace => ({
  ...paymentZone, id: `gradski:zone:${code}`, zoneCode: code, name: `Street ${code}`, geometry: undefined, locationPrecision: "area", access: "unknown",
  coordinate: { latitude: 42 + meters / 111195, longitude: 21 + east / (111195 * Math.cos(42 * Math.PI / 180)) },
  smsPayment: officialSmsPayment({ id: `gradski:zone:${code}`, kind: "zone" })!, tariff: { firstHour: 25, nextHour: 25, maxStayMinutes: null, evidence: "official", source: paymentZone.source },
});
const fix = (accuracy = 8, offset = 0) => ({ ...paymentFix(offset), accuracy });

test("a stopped driver near a Gradski street point is offered that zone", () => {
  assert.deepEqual(ids(smsZoneChoices(fix(), [street("D42", 90)], paymentNow)), ["gradski:zone:D42"]);
  assert.equal(eligibleSmsZone(fix(), [street("D42", 90)], "SK1234FF", paymentNow), null, "the outline-only check never saw street points");
  // Reach grows with GPS accuracy: 150 m plus the accuracy circle.
  assert.deepEqual(ids(smsZoneChoices(fix(8), [street("D42", 165)], paymentNow)), []);
  assert.deepEqual(ids(smsZoneChoices(fix(20), [street("D42", 165)], paymentNow)), ["gradski:zone:D42"]);
  for (const moving of [{ ...fix(), speed: 2 }, fix(25), { ...fix(), timestamp: paymentNow - 25_000 }]) assert.deepEqual(smsZoneChoices(moving, [street("D42", 40)], paymentNow), []);
});

test("similarly close street zones are all offered, nearest first; a clear nearest wins alone", () => {
  // 40 m vs 70 m with 8 m accuracy: within the 30 + 2 x 8 m margin.
  assert.deepEqual(ids(smsZoneChoices(fix(), [street("D62", 70, 10), street("D42", 40)], paymentNow)), ["gradski:zone:D42", "gradski:zone:D62"]);
  assert.deepEqual(ids(smsZoneChoices(fix(), [street("D62", 110), street("D42", 20)], paymentNow)), ["gradski:zone:D42"]);
  // Poorer accuracy widens the margin.
  assert.deepEqual(ids(smsZoneChoices(fix(20), [street("D62", 110), street("D42", 50)], paymentNow)), ["gradski:zone:D42", "gradski:zone:D62"]);
  const crowd = [10, 20, 30, 40].map((meters, index) => street(`D${50 + index}`, meters));
  assert.equal(smsZoneChoices(fix(), crowd, paymentNow).length, 3, "at most three choices");
});

test("street choices respect access, capacity, free time, night hours, verification and parking lots", () => {
  const d42 = street("D42", 40);
  for (const place of [{ ...d42, access: "restricted" as const }, { ...d42, capacity: 0 }, { ...d42, smsPayment: undefined }, { ...d42, zoneCode: "D43" },
    { ...d42, tariff: { ...d42.tariff!, firstHour: 0, nextHour: 0 } }]) assert.deepEqual(smsZoneChoices(fix(), [place], paymentNow), []);
  const sunday = Date.parse("2026-10-11T10:00:00Z"), night = Date.parse("2026-10-05T22:30:00Z");
  assert.deepEqual(smsZoneChoices({ ...fix(), timestamp: sunday }, [street("C17", 40)], sunday), [], "Gradski centre is free on Sundays");
  assert.deepEqual(smsZoneChoices({ ...fix(), timestamp: night }, [d42], night), [], "unpublished hours stay quiet at night");
  const lot: ParkingPlace = { ...paymentZone, id: "osm:lot", kind: "surface", smsPayment: undefined, zoneCode: null };
  assert.deepEqual(smsZoneChoices(fix(), [lot, d42], paymentNow), [], "parked inside a lot, not on the street");
  assert.deepEqual(smsZoneChoices(fix(), [{ ...lot, access: "restricted" }, d42], paymentNow), []);
});

test("outline zones keep the exact check; a sector near a Gradski street offers both", () => {
  assert.deepEqual(ids(smsZoneChoices(fix(), [paymentZone], paymentNow)), [paymentZone.id]);
  const sector: ParkingPlace = { ...paymentZone, id: "poc:zone:1:9", zoneCode: "POC 1", operator: "poc", smsPayment: officialSmsPayment({ id: "poc:zone:1:9", kind: "zone" })! };
  assert.equal(eligibleSmsZone(fix(), [sector, street("C17", 200)], "SK1234FF", paymentNow), null);
  assert.deepEqual(ids(smsZoneChoices(fix(), [sector, street("C17", 200)], paymentNow)), ["poc:zone:1:9", "gradski:zone:C17"]);
  assert.deepEqual(ids(smsZoneChoices(fix(), [sector, street("C17", 450)], paymentNow)), ["poc:zone:1:9"]);
  // An outline the exact checks cannot settle (here: two overlapping sectors) never falls back to a nearby street.
  assert.deepEqual(smsZoneChoices(fix(), [sector, { ...sector, id: "poc:zone:2:1", zoneCode: "POC 2", smsPayment: officialSmsPayment({ id: "poc:zone:2:1", kind: "zone" })! }, street("C17", 60)], paymentNow), []);
});

test("the dwell offers street choices after 15 s, also without a saved plate", () => {
  const detector = new ZonePaymentDwell(), places = [street("D62", 70, 10), street("D42", 40)];
  for (const offset of [0, 5000, 10000]) assert.equal(detector.update(fix(8, offset), places, null, true, paymentNow + offset), null);
  assert.deepEqual(ids(detector.update(fix(8, 15000), places, null, true, paymentNow + 15000)!), ["gradski:zone:D42", "gradski:zone:D62"]);
  detector.prompted(["gradski:zone:D42", "gradski:zone:D62"], null, paymentNow);
  assert.equal(detector.canPrompt(["gradski:zone:D42"], null, paymentNow + 1000), false);
  assert.equal(detector.canPrompt(["gradski:zone:D42"], "SK1234FF", paymentNow + 1000), true);
});

test("the car position is the fix at payment time only when precise and fresh", () => {
  assert.deepEqual(carPosition(fix(30), paymentNow), { latitude: 42, longitude: 21 });
  assert.equal(carPosition(fix(31), paymentNow), null);
  assert.equal(carPosition(fix(5, -31_000), paymentNow), null, "stale");
  assert.equal(carPosition(null, paymentNow), null);
});

test("a payment session is valid for the shared log, with prices checked and the stop id derivable", () => {
  const d42 = street("D42", 40), session = paymentSession(d42, d42.smsPayment!, null, { latitude: 42, longitude: 21 }, paymentNow);
  assert.equal(validSession(session, paymentNow), true);
  assert.deepEqual([session.id, session.zoneCode, session.operator, session.firstHour, session.paidHours, session.maxStayMinutes], [sessionId(d42.id, paymentNow), "D42", "gradski", 25, null, null]);
  const pricey = paymentSession({ ...d42, tariff: { ...d42.tariff!, firstHour: 6000 } }, d42.smsPayment!, null, null, paymentNow);
  assert.equal(pricey.firstHour, null, "an implausible price must not make the log drop the session");
  const poc = officialSmsPayment({ id: "poc:zone:1:9", kind: "zone" })!;
  const fixed = paymentSession({ ...paymentZone, id: "poc:zone:1:9", zoneCode: "POC 1" }, poc, 2, null, paymentNow);
  assert.deepEqual([fixed.zoneCode, fixed.operator, fixed.paidHours], ["POC 1", "poc", 2]);
  assert.equal(readSessions(JSON.stringify([session, pricey, fixed]), paymentNow).length, 3);
});

test("My car shows while a session runs and for 12 hours after it ends, not after a stop SMS", () => {
  const base = paymentSession(street("D42", 40), street("D42", 40).smsPayment!, null, { latitude: 42, longitude: 21 }, paymentNow);
  const hour = 3600000, fixed: ParkingSession = { ...base, paidHours: 2 };
  assert.equal(carSession([], paymentNow), null);
  assert.equal(carSession([fixed], paymentNow + hour)?.id, base.id, "running");
  assert.equal(carSession([fixed], paymentNow + 13 * hour)?.id, base.id, "11 hours after it ended");
  assert.equal(carSession([fixed], paymentNow + 15 * hour), null);
  assert.equal(carSession([base], paymentNow + 11 * hour)?.id, base.id, "unknown end");
  assert.equal(carSession([base], paymentNow + 13 * hour), null);
  assert.equal(carSession([{ ...base, stoppedAt: paymentNow + hour }], paymentNow + 2 * hour), null);
  const extra = { ...fixed, id: "extra", startedAt: paymentNow + hour, paidHours: 0.5 };
  assert.equal(carPaidUntil([fixed, extra], extra), paymentNow + 2 * hour, "Paid until keeps the later end bought before");
  assert.equal(carSession([fixed, extra], paymentNow + 13.5 * hour)?.id, "extra", "recalled 12 hours after that end");
  assert.equal(carPaidUntil([base], base), null, "start-stop has no paid end");
});
