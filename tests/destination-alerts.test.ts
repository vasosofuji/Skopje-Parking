import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { ParkingStore } from "../server/store";
import { PostgresParkingStore } from "../server/postgres/store";
import { postgresSql, type StoreDatabase } from "../server/postgres/database";
import { DestinationAlerts, validPushEndpoint, WATCH_DURATION_MS, type PushMessage } from "../server/destination-alerts";
import type { Catalog } from "../src/domain/types";
import seed from "../data/catalog.json";
import { buildApp } from "../server/app";
import { TERMS_VERSION } from "../src/domain/account";
const catalog = seed as Catalog;
const target = { type: "expo" as const, token: "ExpoPushToken[test_destination_token]" };

for (const backend of ["sqlite", "postgres"] as const) {
  test(`${backend}: destination warnings survive worker recreation, exclude self, deduplicate and expire`, async () => {
    let store: ParkingStore | PostgresParkingStore;
    if (backend === "sqlite") store = new ParkingStore(":memory:", catalog, Date.now, true);
    else {
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
      store = new PostgresParkingStore(db, Date.now, true);
      await store.seed(catalog);
    }
    let now = Date.now(), failures = 1;
    const delivered: PushMessage[] = [];
    const sender = async (_target: unknown, message: PushMessage) => { if (failures-- > 0) throw new Error("temporary provider failure"); delivered.push(message); };
    try {
      const traveler = await store.createSession(), reporter = await store.createSession();
      const placeId = catalog.places[0].id, otherPlaceId = catalog.places[1].id;
      let alerts = new DestinationAlerts(store, sender, () => now);
      await alerts.start(traveler.token, { placeId, language: "en", target });
      await alerts.reportedFull(placeId, traveler.token);
      await alerts.flush();
      assert.equal(delivered.length, 0, "self reports cannot alert");
      await alerts.reportedFull(placeId, reporter.token);
      await alerts.flush();
      assert.equal(delivered.length, 0, "failed push is not falsely marked delivered");
      alerts = new DestinationAlerts(store, sender, () => now);
      now += 31000;
      await Promise.all([alerts.flush(), alerts.flush()]);
      assert.equal(delivered.length, 1, "durable retry claims deliver only once");
      assert.match(delivered[0].body, /Another driver reported/);
      await alerts.reportedFull(placeId, reporter.token);
      await alerts.flush();
      assert.equal(delivered.length, 1, "repeat reports do not spam one trip");
      await alerts.start(traveler.token, { placeId: otherPlaceId, language: "mk", target });
      await alerts.reportedFull(placeId, reporter.token);
      await alerts.flush();
      assert.equal(delivered.length, 1, "switching destination cancels old watch");
      await alerts.stopAt(placeId, traveler.token);
      await alerts.reportedFull(otherPlaceId, reporter.token);
      await alerts.flush();
      assert.equal(delivered.length, 2, "reporting elsewhere does not cancel destination");
      await alerts.start(traveler.token, { placeId, language: "en", target });
      now += WATCH_DURATION_MS;
      await alerts.reportedFull(placeId, reporter.token);
      await alerts.flush();
      assert.equal(delivered.length, 2, "old trips expire");
      await alerts.start(traveler.token, { placeId, language: "en", target });
      await alerts.stop(traveler.token);
      await alerts.reportedFull(placeId, reporter.token);
      await alerts.flush();
      assert.equal(delivered.length, 2, "canceled trips cannot alert");
    } finally { await store.close(); }
  });
}

test("Web Push endpoints cannot send server requests to arbitrary or private hosts", () => {
  for (const endpoint of ["http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://fcm.googleapis.com.attacker.test/x", "https://user:password@fcm.googleapis.com/x", "https://fcm.googleapis.com:8080/x"]) assert.equal(validPushEndpoint(endpoint), false);
  for (const endpoint of ["https://fcm.googleapis.com/fcm/send/test", "https://updates.push.services.mozilla.com/wpush/v2/test", "https://web.push.apple.com/test"]) assert.equal(validPushEndpoint(endpoint), true);
});

test("API Go registration and another driver's full report deliver; logout cancels future alerts", async () => {
  const store = new ParkingStore(":memory:", catalog, Date.now, true);
  const deliveries: PushMessage[] = [];
  const app = await buildApp(catalog, store, { destinationPushSender: async (_target, message) => { deliveries.push(message); } });
  const traveler = store.createSession(), reporter = store.createSession();
  const placeId = catalog.places.find(place => place.kind !== "zone" && place.capacity !== 0)!.id;
  const headers = { authorization: `Bearer ${traveler.token}` };
  const registration = { placeId, language: "en", target };
  try {
    assert.equal((await app.inject({ method: "POST", url: "/v1/profile", headers, payload: { username: "AlertDriver", accepted: true, termsVersion: TERMS_VERSION, password: "secure-password-123" } })).statusCode, 200);
    assert.equal((await app.inject({ method: "PUT", url: "/v1/notifications/destination", headers, payload: registration })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: `/v1/places/${placeId}/reports`, headers: { authorization: `Bearer ${reporter.token}` }, payload: { status: "full" } })).statusCode, 200);
    assert.equal(deliveries.length, 1);
    assert.equal((await app.inject({ method: "PUT", url: "/v1/notifications/destination", headers, payload: registration })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/v1/auth/logout", headers })).statusCode, 200);
    await app.inject({ method: "POST", url: `/v1/places/${placeId}/reports`, headers: { authorization: `Bearer ${reporter.token}` }, payload: { status: "full" } });
    assert.equal(deliveries.length, 1);
    assert.equal((await app.inject({ method: "PUT", url: "/v1/notifications/destination", payload: registration })).statusCode, 401);
    assert.equal((await app.inject({ method: "PUT", url: "/v1/notifications/destination", headers: { authorization: `Bearer ${reporter.token}` }, payload: { ...registration, target: { type: "expo", token: "invalid" } } })).statusCode, 400);
  } finally { await app.close(); }
});
