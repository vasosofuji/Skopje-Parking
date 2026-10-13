import test from "node:test";
import assert from "node:assert/strict";
import type { ParkingSession } from "../src/domain/parking-sessions";
import { sessionMinutes, sessionZoneLabel, spendingSummary } from "../src/domain/spending";

const now = Date.parse("2026-10-13T10:00:00Z"), hour = 3600000;
const session = (id: string, startedAt: number, change: Partial<ParkingSession> = {}): ParkingSession => ({
  id, placeId: "gradski:zone:D42", zoneCode: "D42", zoneName: "MIDA", operator: "gradski", startedAt, stoppedAt: null,
  paidHours: 2, maxStayMinutes: null, firstHour: 40, nextHour: 30, car: null, ...change,
});

test("spending is totalled per Skopje month and per zone, counting unknown prices without guessing", () => {
  const sessions = [
    session("sep", Date.parse("2026-09-20T08:00:00Z")),
    // 23:30 UTC on 30 September is already October in Skopje.
    session("edge", Date.parse("2026-09-30T23:30:00Z"), { paidHours: 1 }),
    session("poc", now - 5 * hour, { placeId: "poc:zone:1:0", zoneCode: "1", zoneName: "POC 1", operator: "poc", paidHours: 1, firstHour: 70, nextHour: 70 }),
    session("unknown", now - 2 * hour, { firstHour: null, nextHour: null }),
    session("aug", Date.parse("2026-08-10T08:00:00Z"), { paidHours: 3 }),
  ];
  const summary = spendingSummary(sessions, now);
  assert.deepEqual(summary.thisMonth, { key: "2026-10", label: "2026-10", total: 40 + 70, count: 3, unknown: 1 });
  assert.deepEqual(summary.previousMonths.map(m => [m.key, m.total, m.count]), [["2026-09", 70, 1], ["2026-08", 100, 1]]);
  assert.deepEqual(summary.zones.map(z => [z.label, z.total, z.count, z.unknown]), [["D42 · MIDA", 210, 4, 1], ["POC 1", 70, 1, 0]]);
  assert.deepEqual(spendingSummary([], now).thisMonth, { key: "2026-10", label: "2026-10", total: 0, count: 0, unknown: 0 });
});

test("durations follow hours bought, the stop SMS, the zone limit or now", () => {
  const start = now - 3 * hour;
  assert.equal(sessionMinutes(session("a", start), now), 120);
  assert.equal(sessionMinutes(session("b", start, { paidHours: null, stoppedAt: start + 80 * 60000 }), now), 80);
  assert.equal(sessionMinutes(session("c", start, { paidHours: null, maxStayMinutes: 240 }), now), 180, "still running");
  assert.equal(sessionMinutes(session("d", start, { paidHours: null, maxStayMinutes: 60 }), now), 60);
  assert.equal(sessionZoneLabel(session("e", start, { zoneName: "D42" })), "D42");
  assert.equal(sessionZoneLabel(session("f", start, { zoneName: "Zone D42 Karposh" })), "Zone D42 Karposh");
});
