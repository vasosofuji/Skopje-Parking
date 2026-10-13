import test from "node:test";
import assert from "node:assert/strict";
import { activeSession, addSession, latestSessionEnd, readSessions, sessionCost, sessionEffectiveEnd, sessionEndsAt, type ParkingSession } from "../src/domain/parking-sessions";

const now = Date.parse("2026-10-13T10:00:00Z");
const base: ParkingSession = { id: "a", placeId: "gradski:zone:D42", zoneCode: "D42", zoneName: "MIDA", operator: "gradski", startedAt: now - 30 * 60000, stoppedAt: null, paidHours: 2, maxStayMinutes: 120, firstHour: 40, nextHour: 40, car: { latitude: 42, longitude: 21.4 } };

test("the session log keeps valid entries in order and drops damaged or expired ones", () => {
  const raw = JSON.stringify([{ ...base, id: "b", startedAt: now - 1000 }, base, { ...base, id: "x", firstHour: -1 }, { ...base, id: "old", startedAt: now - 500 * 86400000 }, "junk"]);
  assert.deepEqual(readSessions(raw, now).map(s => s.id), ["a", "b"]);
  assert.deepEqual(readSessions("{", now), []);
  assert.equal(addSession([base], { ...base, firstHour: 50 }, now).length, 1, "same id replaces");
});

test("end time, active session and cost follow hours bought, stop SMS or maximum stay", () => {
  assert.equal(sessionEndsAt(base), base.startedAt + 2 * 3600000);
  assert.equal(activeSession([base], now)?.id, "a");
  assert.equal(activeSession([base], now + 2 * 3600000), null);
  assert.equal(sessionCost(base, now), 80, "two bought hours");
  const startStop = { ...base, paidHours: null, startedAt: now - 150 * 60000, maxStayMinutes: null, firstHour: 60, nextHour: 50 };
  assert.equal(sessionCost(startStop, now), 160, "three started hours");
  assert.equal(sessionCost({ ...startStop, stoppedAt: startStop.startedAt + 20 * 60000 }, now), 60);
  assert.equal(activeSession([{ ...startStop, stoppedAt: now - 1 }], now), null);
  assert.equal(sessionCost({ ...base, firstHour: null }, now), null);
});

test("paying again at the same place never moves the end earlier", () => {
  const long = { ...base, paidHours: 3 }, extra = { ...base, id: "b", startedAt: base.startedAt + 3600000, paidHours: 1 };
  assert.equal(latestSessionEnd([long, extra]), long.startedAt + 3 * 3600000, "the 3 hours bought first still run");
  assert.equal(activeSession([long, extra], extra.startedAt + 1.5 * 3600000)?.id, "b", "running after the newest payment's own end");
  assert.equal(latestSessionEnd([long, { ...extra, paidHours: 4 }]), extra.startedAt + 4 * 3600000);
  assert.equal(latestSessionEnd([long, { ...extra, placeId: "gradski:zone:D43" }]), extra.startedAt + 3600000, "another place is a new stay");
  assert.equal(latestSessionEnd([long, { ...extra, stoppedAt: extra.startedAt + 60000 }]), extra.startedAt + 60000, "leaving ends it");
  assert.equal(latestSessionEnd([]), null);
});

test("a start-stop session never stopped stops counting 12 hours after it started", () => {
  const forgotten = { ...base, paidHours: null, maxStayMinutes: null, startedAt: now - 30 * 3600000, firstHour: 60, nextHour: 50 };
  assert.equal(sessionEffectiveEnd(forgotten, now), forgotten.startedAt + 12 * 3600000);
  assert.equal(sessionCost(forgotten, now), 60 + 11 * 50, "12 hours, not 30");
  assert.equal(sessionCost(forgotten, now + 86400000), 60 + 11 * 50, "and it stops growing");
  assert.equal(activeSession([forgotten], now), null);
  assert.equal(sessionEffectiveEnd({ ...forgotten, startedAt: now - 3600000 }, now), now, "a running one counts until now");
});
