import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { ParkingStore } from "../server/store";
import { PostgresParkingStore } from "../server/postgres/store";
import { postgresSql, type StoreDatabase } from "../server/postgres/database";
import { buildApp } from "../server/app";
import type { Catalog, ParkingPlace } from "../src/domain/types";
import { TERMS_VERSION } from "../src/domain/account";
const original: ParkingPlace = { id: "official:1", name: "Original parking", kind: "surface", coordinate: { latitude: 42, longitude: 21.43 }, operator: null, zoneCode: null, access: "public", tariff: null, capacity: null, openingHours: null, verification: "official", source: { label: "Official", url: "", retrievedAt: "2026-01-01" } };
const catalog: Catalog = { generatedAt: "2026-01-01", places: [original, { ...original, id: "community:seed", verification: "community" }], zones: [], destinations: [], coverage: { complete: false, bounds: [], notes: [] } };
for (const backend of ["sqlite", "postgres"] as const) test(`${backend}: removal requires confirmation and ownership, protects all original data, cascades community content`, async () => {
  let store: ParkingStore | PostgresParkingStore;
  if (backend === "sqlite") store = new ParkingStore(":memory:", catalog, Date.now, true);
  else {
    const pg = await PGlite.create({ parsers: { 20: Number } });
    for (const file of readdirSync("supabase/migrations").filter(f => f.endsWith(".sql")).sort()) await pg.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    const local = new AsyncLocalStorage<Transaction>();
    const db: StoreDatabase = { prepare(sql) { const query = (values: unknown[]) => (local.getStore() ?? pg).query(postgresSql(sql), values); return { run: (...v) => query(v), get: async (...v) => (await query(v)).rows[0], all: async (...v) => (await query(v)).rows }; }, transaction: work => local.getStore() ? work() : pg.transaction(tx => local.run(tx, work)), close: () => pg.close() };
    store = new PostgresParkingStore(db, Date.now, true); await store.seed(catalog);
  }
  const app = await buildApp(catalog, store);
  try {
    const owner = { authorization: `Bearer ${(await store.createSession()).token}` }, stranger = { authorization: `Bearer ${(await store.createSession()).token}` };
    for (const headers of [owner, stranger]) assert.equal((await app.inject({ method: "POST", url: "/v1/auth/guest", headers, payload: { accepted: true, termsVersion: TERMS_VERSION } })).statusCode, 200);
    const created = await app.inject({ method: "POST", url: "/v1/contributions", headers: owner, payload: { requestId: "delete-test-001", name: "My parking", coordinate: original.coordinate, kind: "surface", zoneCode: null, firstHour: 25, nextHour: 25, freeSpaces: 2, capacity: 10 } });
    assert.equal(created.statusCode, 201, created.body);
    const id = created.json().id;
    const points = async (headers: typeof owner) => (await app.inject({ url: "/v1/rewards", headers })).json().total;
    assert.equal((await app.inject({ method: "POST", url: `/v1/places/${id}/reports`, headers: stranger, payload: { status: "spaces", freeSpaces: 3 } })).statusCode, 200);
    assert.equal(await points(owner), 10 + 10 + 10 + 3);
    assert.equal(await points(stranger), 3);
    const remove = (target: string, headers = owner, payload: object = { confirmed: true }) => app.inject({ method: "DELETE", url: `/v1/places/${target}`, headers, payload });
    assert.equal((await remove(id, {} as typeof owner)).statusCode, 401);
    assert.equal((await remove(id, owner, { confirmed: false })).statusCode, 400);
    assert.equal((await remove(id, stranger)).statusCode, 403);
    for (const p of catalog.places) assert.equal((await remove(p.id)).statusCode, 403);
    assert.deepEqual((await app.inject({ url: `/v1/places/${id}/removal`, headers: owner })).json(), { canRemove: true });
    assert.deepEqual((await app.inject({ url: `/v1/places/${id}/removal`, headers: stranger })).json(), { canRemove: false });
    const result = await remove(id); assert.equal(result.statusCode, 200, result.body);
    // Removing a contribution takes back every point earned on it, so it cannot be farmed.
    assert.equal(await points(owner), 0);
    assert.equal(await points(stranger), 0);
    const places = (await app.inject("/v1/catalog")).json().places;
    assert.equal(places.some((p: ParkingPlace) => p.id === id), false);
    assert.equal(places.some((p: ParkingPlace) => p.id === original.id), true);
    for (const table of ["reports", "price_reports", "contributions", "contribution_details", "capacity_reports"]) assert.equal((await store.db.prepare(`SELECT * FROM ${table} WHERE place_id=?`).all(id)).length, 0);
  } finally { await app.close(); }
});
