import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { ParkingStore } from "../server/store";
import { PostgresParkingStore } from "../server/postgres/store";
import { postgresSql, type StoreDatabase } from "../server/postgres/database";
import { buildApp } from "../server/app";
import { confirmedSignCatalog, nearestAvailableParking, parkingPrice } from "../src/domain/parking";
import type { Catalog, Geometry, ParkingPlace, SignInfo } from "../src/domain/types";

const coordinate = { latitude: 41.9965, longitude: 21.4325 };
const base: ParkingPlace = {
  id: "lot", name: "Parking", coordinate, kind: "surface", operator: null, zoneCode: "B2",
  access: "public", tariff: null, capacity: 4, openingHours: null, verification: "community",
  source: { label: "Test", url: "", retrievedAt: new Date().toISOString() },
};
const geometry: Geometry = { type: "Polygon", coordinates: [
  [[21.432, 41.996], [21.433, 41.996], [21.433, 41.997], [21.432, 41.997], [21.432, 41.996]],
] };
const catalog: Catalog = {
  generatedAt: new Date().toISOString(),
  places: [base, { ...base, id: "unlabelled", zoneCode: null }, { ...base, id: "zone", kind: "zone", capacity: null, geometry }],
  zones: [], destinations: [], coverage: { complete: false, bounds: [], notes: [] },
};
const sign: SignInfo = {
  isParkingSign: true, confidence: 1, zoneCode: "C2", operator: null, currency: "MKD", firstHour: 99,
  nextHour: 99, maxStayMinutes: null, chargingHours: "07:00-23:00", paymentInstructions: null,
  restrictions: null, rawText: "C2 · 99 MKD",
};

async function createStore(backend: "sqlite" | "postgres") {
  if (backend === "sqlite") return new ParkingStore(":memory:", catalog, Date.now, true);
  const pg = await PGlite.create({ parsers: { 20: Number } });
  for (const file of readdirSync("supabase/migrations").filter(file => file.endsWith(".sql")).sort())
    await pg.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  const local = new AsyncLocalStorage<Transaction>();
  const db: StoreDatabase = {
    prepare(sql) {
      const query = (values: unknown[]) => (local.getStore() ?? pg).query(postgresSql(sql), values);
      return { run: (...values) => query(values), get: async (...values) => (await query(values)).rows[0], all: async (...values) => (await query(values)).rows };
    },
    transaction: work => local.getStore() ? work() : pg.transaction(transaction => local.run(transaction, work)),
    close: () => pg.close(),
  };
  const store = new PostgresParkingStore(db, Date.now, true);
  await store.seed(catalog);
  return store;
}

for (const backend of ["sqlite", "postgres"] as const) {
  test(`${backend}: zero capacity rejects all available reports and invalidates older available status`, async () => {
    const store = await createStore(backend);
    const app = await buildApp(catalog, store);
    const headers = { authorization: `Bearer ${(await store.createSession()).token}` };
    const report = (payload: object) => app.inject({ method: "POST", url: "/v1/places/lot/reports", headers, payload });
    try {
      assert.equal((await report({ status: "spaces", freeSpaces: 3 })).statusCode, 200);
      assert.equal((await app.inject({ method: "PUT", url: "/v1/places/lot/capacity", headers, payload: { capacity: 0 } })).statusCode, 200);
      for (const payload of [{ status: "spaces" }, { status: "spaces", freeSpaces: 0 }, { status: "spaces", freeSpaces: 1 }])
        assert.equal((await report(payload)).statusCode, 400);
      const places = (await app.inject("/v1/catalog")).json().places as ParkingPlace[];
      const changed = places.find(place => place.id === "lot")!;
      assert.equal(changed.capacity, 0);
      assert.equal(changed.availability?.status, "unknown");
      assert.equal(changed.availability?.freeSpaces, undefined);
      assert.deepEqual(nearestAvailableParking(places, { ...base, id: "origin" }), []);
      assert.equal((await report({ status: "full" })).statusCode, 200, "reporting no spaces is still valid");
      assert.equal((await app.inject({ method: "PUT", url: "/v1/places/lot/capacity", headers, payload: { capacity: 4 } })).statusCode, 200);
      assert.equal((await report({ status: "spaces" })).statusCode, 200, "correcting capacity re-enables ordinary quick reports");
    } finally { await app.close(); }
  });

  test(`${backend}: a sign conflicting with its zone label never propagates a tariff`, async () => {
    const store = await createStore(backend);
    const app = await buildApp(catalog, store);
    const headers = { authorization: `Bearer ${(await store.createSession()).token}` };
    try {
      const url = "/v1/places/zone/signs";
      assert.equal((await app.inject({ method: "POST", url, headers, payload: { info: sign } })).statusCode, 201);
      let places = (await app.inject("/v1/catalog")).json().places as ParkingPlace[];
      assert.equal(places.find(place => place.id === "zone")?.signInfo?.zoneCode, "C2", "keep conflicting evidence on its source for correction");
      for (const id of ["lot", "unlabelled"]) {
        const place = places.find(item => item.id === id)!;
        assert.equal(place.signInfo, undefined);
        assert.equal(parkingPrice(place), null);
      }
      assert.equal((await app.inject({ method: "POST", url, headers, payload: { info: { ...sign, zoneCode: "Б2", firstHour: 40, nextHour: 40 } } })).statusCode, 201);
      places = (await app.inject("/v1/catalog")).json().places;
      for (const id of ["lot", "unlabelled"])
        assert.equal(parkingPrice(places.find(place => place.id === id)!)?.firstHour, 40, "a normalized matching correction can propagate");
      assert.equal((await app.inject({ method: "POST", url: "/v1/places/zone/labels", headers, payload: { zoneCode: "D42" } })).statusCode, 200);
      places = (await app.inject("/v1/catalog")).json().places;
      assert.equal(places.find(place => place.id === "unlabelled")?.signInfo, undefined, "a newer contradictory community label also blocks inference");
    } finally { await app.close(); }
  });
}

test("offline recommendations reject stale available status at zero capacity", () => {
  const impossible: ParkingPlace = { ...base, capacity: 0, availability: {
    status: "spaces", source: "community", reports: 1, observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(),
  } };
  assert.deepEqual(nearestAvailableParking([impossible], { ...base, id: "origin" }), []);
});

test("legacy draft cleanup removes copied hours and keeps independent or confirmed hours", () => {
  const draft: ParkingPlace = { ...base, openingHours: sign.chargingHours, signInfo: { ...sign, readingId: "legacy", model: "AI", observedAt: new Date().toISOString() } };
  const confirmed: ParkingPlace = { ...draft, id: "confirmed", signInfo: { ...draft.signInfo!, confirmedAt: new Date().toISOString() } };
  const independent: ParkingPlace = { ...draft, id: "independent", openingHours: "24/7" };
  const cleaned = confirmedSignCatalog({ ...catalog, places: [draft, independent, confirmed] }).places;
  assert.equal(cleaned[0].signInfo, undefined);
  assert.equal(cleaned[0].openingHours, null);
  assert.equal(cleaned[1].openingHours, "24/7");
  assert.equal(cleaned[2].openingHours, sign.chargingHours);
  assert.equal(cleaned[2].signInfo?.confirmedAt, confirmed.signInfo?.confirmedAt);
});
