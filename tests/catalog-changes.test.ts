import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { ParkingStore } from "../server/store";
import { PostgresParkingStore } from "../server/postgres/store";
import { postgresSql, type StoreDatabase } from "../server/postgres/database";
import { buildApp } from "../server/app";
import { applyCatalogChanges, decodeCatalogCache, encodeCatalogCache } from "../src/domain/catalog-cache";
import { insidePolygon } from "../src/domain/arrival";
import seed from "../data/catalog.json";
import type { Catalog, ParkingPlace } from "../src/domain/types";

const catalog = seed as Catalog;

async function backendStore(backend: "sqlite" | "postgres") {
  if (backend === "sqlite") return new ParkingStore(":memory:", catalog, Date.now, true);
  const pg = await PGlite.create({ parsers: { 20: Number } });
  for (const file of readdirSync("supabase/migrations").filter(f => f.endsWith(".sql")).sort()) await pg.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  const local = new AsyncLocalStorage<Transaction>();
  const db: StoreDatabase = { prepare(sql) { const query = (v: unknown[]) => (local.getStore() ?? pg).query(postgresSql(sql), v); return { run: (...v) => query(v), get: async (...v) => (await query(v)).rows[0], all: async (...v) => (await query(v)).rows }; }, transaction: work => local.getStore() ? work() : pg.transaction(tx => local.run(tx, work)), close: () => pg.close() };
  const store = new PostgresParkingStore(db, Date.now, true); await store.seed(catalog);
  return store;
}

for (const backend of ["sqlite", "postgres"] as const) test(`${backend}: phones download only what changed, including zone siblings and parkings inside a changed zone`, async () => {
  const store = await backendStore(backend);
  const app = await buildApp(catalog, store);
  try {
    const headers = { authorization: `Bearer ${(await app.inject({ method: "POST", url: "/v1/sessions" })).json().token}` };
    const changes = async (since: number) => (await app.inject({ url: `/v1/changes?since=${since}`, headers })).json();
    const full = await changes(0);
    assert.equal(full.full, true);
    assert.equal(full.places.length, (await app.inject("/v1/catalog")).json().places.length, "a fresh install gets every place once");
    const quiet = await changes(Date.now() + 60_000);
    assert.deepEqual([quiet.full, quiet.places, quiet.removed], [false, [], []], "nothing changed, nothing sent");

    // An availability report changes only its own parking.
    const parking = catalog.places.find(place => place.kind !== "zone" && place.access !== "restricted")!;
    const before = Date.now();
    assert.equal((await app.inject({ method: "POST", url: `/v1/places/${encodeURIComponent(parking.id)}/reports`, headers, payload: { status: "spaces" } })).statusCode, 200);
    const report = await changes(before);
    assert.equal(report.cursor, before, "the cursor waits until recent writes have certainly committed");
    assert.deepEqual(report.places.map((place: ParkingPlace) => place.id), [parking.id]);
    assert.equal(report.places[0].availability.status, "spaces");

    // A zone tariff is shared by every outline of that operator's zone code and inherited by parkings inside it.
    const zone = catalog.places.find(place => place.kind === "zone" && place.operator && place.zoneCode && place.geometry &&
      catalog.places.some(other => other.kind !== "zone" && insidePolygon(other.coordinate, place.geometry!)))!;
    const priced = Date.now();
    assert.equal((await app.inject({ method: "POST", url: `/v1/places/${encodeURIComponent(zone.id)}/prices`, headers, payload: { firstHour: 55, nextHour: 55 } })).statusCode, 200);
    const ids = new Set((await changes(priced)).places.map((place: ParkingPlace) => place.id));
    for (const place of catalog.places) {
      const sibling = place.kind === "zone" && place.operator === zone.operator && place.zoneCode === zone.zoneCode;
      const inside = place.kind !== "zone" && insidePolygon(place.coordinate, zone.geometry!);
      if (sibling || inside) assert.ok(ids.has(place.id), `${place.id} is sent with its zone`);
    }

    // A removed contribution is removed from phones.
    const contribution = { requestId: "delta-removal", name: "Delta parking", coordinate: { latitude: 41.9971, longitude: 21.4301 }, kind: "surface", zoneCode: null, firstHour: null, nextHour: null };
    const created = (await app.inject({ method: "POST", url: "/v1/contributions", headers, payload: contribution })).json() as ParkingPlace;
    const added = await changes(priced);
    assert.ok(added.places.some((place: ParkingPlace) => place.id === created.id));
    const deleted = Date.now();
    assert.equal((await app.inject({ method: "DELETE", url: `/v1/places/${encodeURIComponent(created.id)}`, headers, payload: { confirmed: true } })).statusCode, 200);
    const gone = await changes(deleted);
    assert.ok(gone.removed.includes(created.id));
    assert.equal(gone.places.some((place: ParkingPlace) => place.id === created.id), false);

    // Applying the deltas to the bundled catalog matches a fresh download.
    let phone = applyCatalogChanges(catalog, full);
    for (const delta of [report, await changes(priced), gone]) phone = applyCatalogChanges(phone, delta);
    const fresh = new Map(((await changes(0)).places as ParkingPlace[]).map(place => [place.id, place]));
    assert.equal(phone.places.length, fresh.size);
    for (const place of phone.places) assert.deepEqual(stable(place), stable(fresh.get(place.id)!), place.id);
  } finally { await app.close(); }
});

// Availability is computed at read time, so its countdown fields differ between two reads.
const stable = (place: ParkingPlace) => ({ ...place, availability: place.availability?.status });

test("the phone keeps the cursor with the cached map and replaces only changed places", () => {
  const [first, second] = catalog.places;
  const changed = applyCatalogChanges(catalog, { cursor: 5, full: false, places: [{ ...first, name: "Renamed" }, { ...first, id: "community:new" }], removed: [second.id], trustInputs: false });
  assert.equal(changed.places[0].name, "Renamed");
  assert.equal(changed.places.some(place => place.id === second.id), false);
  assert.equal(changed.places.at(-1)!.id, "community:new");
  assert.equal(changed.trustInputs, false);
  assert.equal(changed.zones, catalog.zones, "zones, destinations and coverage stay bundled");
  const now = Date.now();
  const restored = decodeCatalogCache(encodeCatalogCache(changed, [], now, 5), catalog.generatedAt, now)!;
  assert.equal(restored.cursor, 5);
  assert.equal(decodeCatalogCache(JSON.stringify({ version: 1, savedAt: now, catalog, proposals: [] }), catalog.generatedAt, now), null, "an old cache without a cursor resyncs once");
});
