import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { ParkingStore } from "../server/store";
import { PostgresParkingStore } from "../server/postgres/store";
import { postgresSql, type StoreDatabase } from "../server/postgres/database";
import { DestinationAlerts, type PushMessage } from "../server/destination-alerts";
import { SPOT_NOTICE_MS, SPOT_OPENING_KIND, SPOT_TTL_MS, SpotOpenings, spotNearDestination } from "../server/spot-openings";
import { buildApp } from "../server/app";
import { distanceMeters } from "../src/domain/parking";
import * as spotDomain from "../src/domain/spot-openings";
import * as sessionDomain from "../src/domain/parking-sessions";
import * as serial from "../src/services/serial";
import type { ParkingSession } from "../src/domain/parking-sessions";
import type { Catalog, ParkingPlace } from "../src/domain/types";
import seed from "../data/catalog.json";
import vm from "node:vm";
import ts from "typescript";

const { nextSpotShare } = spotDomain;

const catalog = seed as Catalog;
const fcm = (token: string) => ({ type: "fcm" as const, token: `${token}:APA91b${"x".repeat(140)}` });
const plain = catalog.places.filter(place => place.kind !== "zone" && place.access === "public" && !place.geometry);
const destination = plain.find(a => plain.some(b => b !== a && distanceMeters(a.coordinate, b.coordinate) > 50 && distanceMeters(a.coordinate, b.coordinate) < 280))!;
const nearby = plain.find(b => b !== destination && distanceMeters(destination.coordinate, b.coordinate) > 50 && distanceMeters(destination.coordinate, b.coordinate) < 280)!;
const far = plain.find(place => distanceMeters(destination.coordinate, place.coordinate) > 2000)!;

const place = (id: string, latitude: number, longitude: number, extra: Partial<ParkingPlace> = {}) =>
  ({ id, name: id, coordinate: { latitude, longitude }, kind: "surface", operator: null, zoneCode: null, access: "public", tariff: null, capacity: null, openingHours: null, verification: "osm", ...extra }) as ParkingPlace;

test("a spot matches the destination itself or public parking within about 300 m, zones measured from their edge", () => {
  const target = place("target", 42, 21.43);
  assert.equal(spotNearDestination(target, target), true);
  assert.equal(spotNearDestination(place("near", 42.0025, 21.43), target), true, "about 280 m");
  assert.equal(spotNearDestination(place("far", 42.004, 21.43), target), false, "about 445 m");
  assert.equal(spotNearDestination(place("private", 42.001, 21.43, { access: "restricted" }), target), false);
  const zone = place("zone", 42.006, 21.43, { kind: "zone", geometry: { type: "Polygon", coordinates: [[[21.42, 41.99], [21.44, 41.99], [21.44, 42.01], [21.42, 42.01], [21.42, 41.99]]] } });
  assert.equal(spotNearDestination(zone, target), true, "a destination inside a zone is next to it, however far its center");
  assert.equal(spotNearDestination(zone, place("outside", 42.0125, 21.43)), true, "about 280 m beyond the zone edge");
  assert.equal(spotNearDestination(zone, place("beyond", 42.015, 21.43)), false);
});

async function openStore(backend: "sqlite" | "postgres") {
  if (backend === "sqlite") return new ParkingStore(":memory:", catalog, Date.now, true);
  const pg = await PGlite.create({ parsers: { 20: Number } });
  await pg.exec(readdirSync("supabase/migrations").filter(file => file.endsWith(".sql")).sort().map(file => readFileSync(`supabase/migrations/${file}`, "utf8")).join("\n"));
  await pg.exec("SET search_path TO parkskopje");
  const db: StoreDatabase = {
    prepare: sql => ({
      run: async (...values) => pg.query(postgresSql(sql), values),
      get: async (...values) => (await pg.query(postgresSql(sql), values)).rows[0],
      all: async (...values) => (await pg.query(postgresSql(sql), values)).rows,
    }),
    transaction: async work => work(), close: async () => { await pg.close(); },
  };
  const store = new PostgresParkingStore(db, Date.now, true);
  await store.seed(catalog);
  return store;
}

/** Destination watches and spot openings on one store, with a test clock and a push log by token name. */
async function spotAlerts(backend: "sqlite" | "postgres") {
  const store = await openStore(backend), clock = { now: Date.now(), failures: 0 }, delivered: { to: string; message: PushMessage }[] = [];
  const sender = async (target: object, message: PushMessage) => {
    if (clock.failures > 0) { clock.failures--; throw Object.assign(new Error("provider"), { statusCode: 503 }); }
    delivered.push({ to: String((target as { token: string }).token).split(":")[0], message });
  };
  const watches = new DestinationAlerts(store, sender, () => clock.now), spots = new SpotOpenings(store, sender, () => clock.now);
  const [traveler, leaver, other] = await Promise.all([store.createSession(), store.createSession(), store.createSession()]);
  return { store, clock, delivered, watches, spots, traveler: traveler.token, leaver: leaver.token, other: other.token };
}

for (const backend of ["sqlite", "postgres"] as const) {
  test(`${backend}: a failed alert does not retry before an extended paid end comes due`, async () => {
    const { store, clock, delivered, watches, spots, traveler, leaver, other } = await spotAlerts(backend);
    try {
      await watches.start(traveler, { placeId: destination.id, language: "en", target: fcm("traveler") });
      const endsAt = clock.now + 30 * 60000;
      await spots.open(leaver, { placeId: nearby.id, endsAt });
      // Another driver's opening far away keeps the delivery pass running.
      await spots.open(other, { placeId: far.id, endsAt });
      clock.now = endsAt - SPOT_NOTICE_MS; clock.failures = 1;
      await spots.flush();
      await spots.open(leaver, { placeId: nearby.id, endsAt: endsAt + 3600000 });
      clock.now += 31000;
      await spots.flush();
      assert.equal(delivered.length, 0, "the retry waits for the new notice time");
      clock.now = endsAt + 3600000 - SPOT_NOTICE_MS;
      await spots.flush();
      assert.deepEqual(delivered.map(item => [item.to, item.message.data.endsAt]), [["traveler", endsAt + 3600000]]);
    } finally { await store.close(); }
  });

  test(`${backend}: a watch moved to a new destination is matched again against existing openings`, async () => {
    const { store, delivered, watches, spots, traveler, leaver } = await spotAlerts(backend);
    try {
      await watches.start(traveler, { placeId: destination.id, language: "en", target: fcm("traveler") });
      await spots.open(leaver, { placeId: nearby.id, leaving: true });
      await spots.flush();
      // The same account from another device (a new push token) now heads for the spot itself.
      await watches.start(traveler, { placeId: nearby.id, language: "en", target: fcm("phone") });
      await spots.flush();
      await watches.start(traveler, { placeId: nearby.id, language: "en", target: fcm("rotated") });
      await spots.flush();
      assert.deepEqual(delivered.map(item => [item.to, item.message.data.destinationId]), [["traveler", destination.id], ["phone", nearby.id]], "a new token for the same destination is not a new alert");
    } finally { await store.close(); }
  });

  test(`${backend}: spot openings alert nearby destination watches 5 minutes early, once, and never the driver who shared`, async () => {
    const store = await openStore(backend);
    let now = Date.now(), failures = 0;
    const delivered: { target: { token?: string }; message: PushMessage }[] = [];
    const sender = async (target: { token?: string } | object, message: PushMessage) => {
      if (failures > 0) { failures--; throw Object.assign(new Error("provider"), { statusCode: 503 }); }
      if ((target as { token?: string }).token?.startsWith("gone")) throw Object.assign(new Error("unregistered"), { statusCode: 410 });
      delivered.push({ target, message });
    };
    try {
      const [traveler, leaver, stranger, late] = await Promise.all([store.createSession(), store.createSession(), store.createSession(), store.createSession()]);
      const watches = new DestinationAlerts(store, sender, () => now), spots = new SpotOpenings(store, sender, () => now);
      await watches.start(traveler.token, { placeId: destination.id, language: "en", target: fcm("traveler") });
      await watches.start(leaver.token, { placeId: destination.id, language: "en", target: fcm("leaver") });
      await watches.start(stranger.token, { placeId: far.id, language: "mk", target: fcm("stranger") });
      const endsAt = now + 30 * 60000;
      assert.deepEqual(await spots.open(leaver.token, { placeId: nearby.id, endsAt }), { notifyAt: endsAt - SPOT_NOTICE_MS });
      await spots.flush();
      assert.equal(delivered.length, 0, "not before 5 minutes ahead");
      now = endsAt - SPOT_NOTICE_MS;
      failures = 1;
      await spots.flush();
      assert.equal(delivered.length, 0, "a failed push is not marked delivered");
      now += 31000;
      await Promise.all([spots.flush(), spots.flush()]);
      assert.equal(delivered.length, 1, "retried once, delivered once, only to the nearby traveler");
      const [{ target, message }] = delivered;
      assert.match(String(target.token), /^traveler:/);
      assert.equal(message.title, `A spot may open soon near ${destination.nameEn ?? destination.name}`);
      assert.equal(message.channelId, "parking-spots");
      assert.deepEqual(message.data, { kind: SPOT_OPENING_KIND, placeId: nearby.id, destinationId: destination.id, endsAt });
      await spots.open(leaver.token, { placeId: nearby.id, leaving: true });
      await spots.flush();
      assert.equal(delivered.length, 1, "leaving early from the same spot does not repeat the alert");
      await watches.start(late.token, { placeId: nearby.id, language: "mk", target: fcm("late") });
      await spots.flush();
      assert.equal(delivered.length, 2, "a watch started after the notice still hears about it");
      assert.equal(delivered[1].message.title, `Наскоро може да се ослободи место кај ${nearby.name}`);
      assert.match(delivered[1].message.body, /Друг возач заминува сега/);

      await spots.open(stranger.token, { placeId: destination.id, leaving: true });
      await watches.start(traveler.token, { placeId: nearby.id, language: "en", target: fcm("gone") });
      await spots.flush();
      assert.deepEqual(delivered.slice(2).map(item => item.target.token?.split(":")[0]).sort(), ["late", "leaver"]);
      const count = async (table: string) => Number((await store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
      assert.equal(await count("destination_watches"), 3, "a dead token drops its watch");
      await spots.open(leaver.token, { placeId: far.id, leaving: true });
      await spots.flush();
      assert.deepEqual(delivered.slice(4).map(item => item.target.token?.split(":")[0]), ["stranger"], "moving to another spot is a new opening");
      now += SPOT_TTL_MS + 1;
      await watches.start(late.token, { placeId: far.id, language: "mk", target: fcm("late") });
      await spots.flush();
      assert.equal(delivered.length, 5, "expired openings are dropped");
      assert.equal(await count("spot_openings"), 0);
      await spots.open(leaver.token, { placeId: nearby.id, leaving: true });
      await spots.withdraw(leaver.token);
      assert.equal(await count("spot_openings"), 0);
    } finally { await store.close(); }
  });
}

test("API: spot openings take only a place and an end time from a signed-in driver, and maintenance delivers them", async () => {
  const store = new ParkingStore(":memory:", catalog, Date.now, true);
  const deliveries: PushMessage[] = [], tasks: Promise<void>[] = [];
  const app = await buildApp(catalog, store, { destinationPushSender: async (_target, message) => { deliveries.push(message); }, backgroundTask: task => { tasks.push(task); }, cronSecret: "cron-secret" });
  const traveler = store.createSession(), leaver = store.createSession();
  const as = (session: { token: string }) => ({ authorization: `Bearer ${session.token}` });
  const open = (payload: object, session = leaver) => app.inject({ method: "POST", url: "/v1/spot-openings", headers: as(session), payload });
  try {
    assert.equal((await app.inject({ method: "PUT", url: "/v1/notifications/destination", headers: as(traveler), payload: { placeId: destination.id, language: "en", target: fcm("traveler") } })).statusCode, 200);
    for (const target of [{ type: "fcm", token: "short" }, { type: "fcm", token: `${"x".repeat(150)}/../` }])
      assert.equal((await app.inject({ method: "PUT", url: "/v1/notifications/destination", headers: as(traveler), payload: { placeId: destination.id, language: "en", target } })).statusCode, 400);
    assert.equal((await app.inject({ method: "POST", url: "/v1/spot-openings", payload: { placeId: nearby.id, leaving: true } })).statusCode, 401);
    for (const bad of [{ placeId: nearby.id }, { placeId: nearby.id, endsAt: Date.now() + 2 * 86400000 }, { placeId: nearby.id, endsAt: Date.now() - 3600000 },
      { placeId: nearby.id, leaving: true, plate: "SK1234AB" }, { placeId: nearby.id, leaving: true, latitude: 42 }, { placeId: nearby.id, leaving: false }])
      assert.equal((await open(bad)).statusCode, 400, JSON.stringify(bad));
    assert.equal((await open({ placeId: "missing", leaving: true })).statusCode, 404);
    const scheduled = await open({ placeId: nearby.id, endsAt: Date.now() + 60 * 60000 });
    assert.equal(scheduled.statusCode, 201);
    await Promise.all(tasks.splice(0));
    assert.equal(deliveries.length, 0);
    assert.equal((await open({ placeId: nearby.id, leaving: true })).statusCode, 201);
    assert.equal((await app.inject({ method: "GET", url: "/internal/maintenance", headers: { authorization: "Bearer wrong" } })).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: "/internal/maintenance", headers: { authorization: "Bearer cron-secret" } })).statusCode, 200);
    await Promise.all(tasks.splice(0));
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].data.kind, SPOT_OPENING_KIND);
    assert.equal((await app.inject({ method: "DELETE", url: "/v1/spot-openings", headers: as(leaver) })).statusCode, 200);
  } finally {
    await new Promise(resolve => setTimeout(resolve, 20));
    await Promise.allSettled(tasks);
    await app.close();
  }
});

test("the phone shares a bought end time once, a stop SMS as leaving now, and nothing after the driver left", () => {
  const now = Date.parse("2026-10-13T10:00:00Z");
  const paid: ParkingSession = { id: "a", placeId: "gradski:zone:D42", zoneCode: "D42", zoneName: "MIDA", operator: "gradski", startedAt: now - 30 * 60000, stoppedAt: null, paidHours: 2, maxStayMinutes: 120, firstHour: 40, nextHour: 40, car: { latitude: 42, longitude: 21.4 } };
  const endsAt = paid.startedAt + 2 * 3600000;
  assert.deepEqual(nextSpotShare([paid], now, null), { session: "a", placeId: paid.placeId, endsAt });
  assert.equal(nextSpotShare([paid], now, { session: "a", endsAt }), null, "already shared");
  assert.deepEqual(nextSpotShare([{ ...paid, paidHours: 3 }], now, { session: "a", endsAt })?.endsAt, endsAt + 3600000, "more time bought is shared again");
  assert.equal(nextSpotShare([paid], now, { session: "a", endsAt: "left" }), null, "after I'm leaving, never the old end time");
  assert.equal(nextSpotShare([paid], endsAt, null), null, "ended sessions are not shared");
  assert.equal(nextSpotShare([], now, null), null);
  const startStop = { ...paid, paidHours: null };
  assert.equal(nextSpotShare([startStop], now, null), null, "a maximum stay is not an end time");
  assert.deepEqual(nextSpotShare([{ ...startStop, stoppedAt: now - 60000 }], now, null), { session: "a", placeId: paid.placeId, endsAt: "left" });
  assert.equal(nextSpotShare([{ ...startStop, stoppedAt: now - 60000 }], now, { session: "a", endsAt: "left" }), null);
  assert.equal(nextSpotShare([{ ...startStop, stoppedAt: now - 20 * 60000 }], now, null), null, "an old stop is not news");
  const extra: ParkingSession = { ...paid, id: "b", startedAt: now, paidHours: 1 };
  assert.deepEqual(nextSpotShare([paid, extra], now, { session: "a", endsAt }), { session: "b", placeId: paid.placeId, endsAt }, "one more hour bought sooner keeps the later end");
  assert.equal(nextSpotShare([paid, extra], now, { session: "b", endsAt }), null);
});

/** The phone's session log and spot sharing services over an in-memory AsyncStorage. */
function phone(sharing: boolean) {
  const storage = new Map<string, string>(sharing ? [] : [["spot-sharing-off-v1", "1"]]), requests: unknown[][] = [];
  const AsyncStorage = { getItem: async (key: string) => storage.get(key) ?? null, setItem: async (key: string, value: string) => { storage.set(key, value); }, removeItem: async (key: string) => { storage.delete(key); } };
  const load = (file: string, modules: Record<string, unknown>) => {
    const module = { exports: {} as any };
    vm.runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
      { module, exports: module.exports, require: (name: string) => modules[name] ?? assert.fail(`unexpected import ${name}`) });
    return module.exports;
  };
  const shared = { "@react-native-async-storage/async-storage": { __esModule: true, default: AsyncStorage }, "../domain/parking-sessions": sessionDomain, "./serial": serial };
  const sessions = load("src/services/parkingSessions.ts", shared);
  const spots = load("src/services/spotOpenings.ts", { ...shared, "./parkingSessions": sessions, "../domain/spot-openings": spotDomain,
    "./api": { api: { spotOpening: async (...args: unknown[]) => { requests.push(args); } } } });
  return { sessions, spots, requests };
}

test("I'm leaving my spot stops the session, and that change shares it with exactly one request", async () => {
  for (const sharing of [true, false]) {
    const { sessions, spots, requests } = phone(sharing);
    const session: ParkingSession = { id: "a", placeId: "gradski:zone:D42", zoneCode: "D42", zoneName: "MIDA", operator: "gradski", startedAt: Date.now() - 30 * 60000, stoppedAt: null, paidHours: 2, maxStayMinutes: null, firstHour: 40, nextHour: 40, car: null };
    await sessions.saveParkingSession(session);
    const stop = spots.watchSpotOpenings();
    await spots.shareSpotOpening();
    assert.deepEqual(requests.map(([, endsAt]) => endsAt), sharing ? [session.startedAt + 2 * 3600000] : [], "the paid end, shared once");
    assert.equal(await spots.leaveSpot(session), sharing);
    const [stored] = await sessions.listParkingSessions() as ParkingSession[];
    assert.ok(stored.stoppedAt !== null && stored.stoppedAt >= session.startedAt, "the session stopped");
    assert.equal(sessionDomain.activeSession([stored], Date.now()), null, "so the button hides");
    await spots.shareSpotOpening();
    assert.deepEqual(requests.slice(1), sharing ? [["gradski:zone:D42", "left"]] : [], sharing ? "one request for leaving" : "sharing off sends nothing");
    stop();
  }
});
