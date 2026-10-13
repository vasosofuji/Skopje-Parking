import test from "node:test";
import assert from "node:assert/strict";
import type { ParkingSession } from "../src/domain/parking-sessions";
import { GRADSKI_MONTHLY_ZONE_PASS, PASS_COOLDOWN_MS, cardOffer, passZone, readCardPrompts } from "../src/domain/parking-passes";

const now = Date.parse("2026-10-13T10:00:00Z"), hour = 3600000, day = 24 * hour;
const poc = (id: string, daysAgo: number, change: Partial<ParkingSession> = {}): ParkingSession => ({
  id, placeId: "poc:zone:1:0", zoneCode: "1", zoneName: "POC 1", operator: "poc", startedAt: now - daysAgo * day, stoppedAt: null,
  paidHours: 3, maxStayMinutes: null, firstHour: 70, nextHour: 70, car: null, ...change,
});
const week = (count: number, change: Partial<ParkingSession> = {}) => Array.from({ length: count }, (_, i) => poc(`s${i}`, i + 0.5, change));

test("pass zones come from the seeded zone id or the operator's own zone token", () => {
  assert.deepEqual(passZone({ placeId: "gradski:zone:A3", operator: "gradski", zoneCode: "A3" }), { operator: "gradski", zone: "A" });
  assert.deepEqual(passZone({ placeId: "gradski:zone:A0", operator: null, zoneCode: "Vodno" }), { operator: "gradski", zone: "A" });
  assert.deepEqual(passZone({ placeId: "osm:1", operator: "gradski", zoneCode: "d 42" }), { operator: "gradski", zone: "D" });
  assert.deepEqual(passZone({ placeId: "poc:zone:2:4", operator: "poc", zoneCode: "2" }), { operator: "poc", zone: "II" });
  assert.deepEqual(passZone({ placeId: "osm:2", operator: "poc", zoneCode: "POC 1" }), { operator: "poc", zone: "I" });
  for (const value of [{ placeId: "poc:zone:0:0", operator: "poc", zoneCode: "0" }, { placeId: "osm:3", operator: null, zoneCode: "A3" }, { placeId: "osm:4", operator: "gradski", zoneCode: "E1" }] as const) assert.equal(passZone(value), null);
  assert.deepEqual(GRADSKI_MONTHLY_ZONE_PASS, { A: 4500, B: 3500, C: 2500, D: 1500 }, "official price list, checked 2026-10-13");
});

test("a monthly card is offered only when repeated paid visits project above its price", () => {
  // 4 visits x 3 h x 70 MKD = 840 MKD a week, about 3600 a month against a 2500 MKD card.
  assert.deepEqual(cardOffer(week(4), now, {}), { operator: "poc", zone: "I", kind: "paid", key: "poc:I", visits: 4, price: 2500, saving: 1100 });
  assert.equal(cardOffer(week(4, { paidHours: 1 }), now, {}), null, "1200 MKD a month is cheaper than the card");
  assert.equal(cardOffer(week(2, { paidHours: 8 }), now, {}), null, "two visits are not a habit");
  const sameDay = [0, 1, 2, 3].map(i => poc(`d${i}`, 0, { startedAt: now - (i + 1) * hour, paidHours: 4 }));
  assert.equal(cardOffer(sameDay, now, {}), null, "payments within hours of each other are one visit");
  assert.equal(cardOffer(week(4, { firstHour: null, nextHour: null }), now, {}), null, "unknown prices never invent a saving");
  // Start-stop sessions 12, 36 and 60 hours old without a stop SMS count 12 hours each, not until now.
  assert.equal((cardOffer(week(3, { paidHours: null }), now, {}) as { saving: number }).saving, Math.floor((3 * 12 * 70 * 30 / 7 - 2500) / 10) * 10);
  assert.equal(cardOffer([...week(2, { paidHours: 8 }), poc("old", 8, { paidHours: 8 })], now, {}), null, "only the past 7 days count");
  const gradski = week(5, { placeId: "gradski:zone:B12", zoneCode: "B12", operator: "gradski", paidHours: 6, firstHour: 30, nextHour: 30 });
  assert.deepEqual(cardOffer(gradski, now, {}), { operator: "gradski", zone: "B", kind: "paid", key: "gradski:B", visits: 5, price: 3500, saving: 350 });
  assert.equal(cardOffer([...gradski, ...week(4)], now, {})?.key, "poc:I", "the larger saving wins");
});

test("each zone prompts once per cooldown, and paid sessions outrank recorded visits", () => {
  const prompts = readCardPrompts(JSON.stringify({ "poc:I": now - day, "gradski:A": now - PASS_COOLDOWN_MS - 1, junk: "x", future: now + day }), now);
  assert.deepEqual(prompts, { "poc:I": now - day });
  assert.equal(cardOffer(week(4), now, prompts), null);
  assert.equal(cardOffer(week(4), now, {}, "II")?.kind, "paid");
  assert.deepEqual(cardOffer([], now, {}, "II"), { kind: "visits", key: "poc:II", operator: "poc", zone: "II" });
  assert.equal(cardOffer([], now, prompts, "I"), null, "a paid prompt also silences visit prompts for that zone");
  assert.deepEqual(readCardPrompts("[1]", now), {});
  assert.deepEqual(readCardPrompts("{bad", now), {});
});
