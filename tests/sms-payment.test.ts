import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { ParkingStore } from "../server/store";
import { PostgresParkingStore } from "../server/postgres/store";
import { postgresSql, type StoreDatabase } from "../server/postgres/database";
import { buildApp } from "../server/app";
import { isVerifiedSmsPayment, smsZoneMatches } from "../src/domain/sms-payment";
import { officialSmsPayment } from "../src/domain/skopje-rules";
import seed from "../data/catalog.json";
import type { Catalog, VerifiedSmsPayment } from "../src/domain/types";

const catalog = seed as Catalog;

test("only the operators' published rules can open an SMS composer", () => {
  const official = officialSmsPayment({ id: "gradski:zone:D8", kind: "zone" })!;
  assert.equal(isVerifiedSmsPayment(official), true);
  // Sign photos are not stored, so a protocol read from a photo can never be verified again.
  const photographed: VerifiedSmsPayment = { ...official, photoId: "photo-123", confirmedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() };
  assert.equal(isVerifiedSmsPayment(photographed), false);
  assert.equal(isVerifiedSmsPayment({ ...official, destination: "sms:evil" }), false);
  assert.equal(isVerifiedSmsPayment(null), false);
  assert.equal(smsZoneMatches("POC 1", "1"), true); assert.equal(smsZoneMatches("Д8", "D8"), true);
  assert.equal(smsZoneMatches("POC 0", "1"), false); assert.equal(smsZoneMatches("Gradski B1", "1"), false);
});

for (const backend of ["sqlite", "postgres"] as const) test(`${backend}: the SMS check endpoint serves only official rules and stops when a zone is relabelled`, async () => {
  let store: ParkingStore | PostgresParkingStore;
  if (backend === "sqlite") store = new ParkingStore(":memory:", catalog, Date.now, true);
  else {
    const pg = await PGlite.create({ parsers: { 20: Number } });
    for (const file of readdirSync("supabase/migrations").filter(f => f.endsWith(".sql")).sort()) await pg.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    const local = new AsyncLocalStorage<Transaction>();
    const db: StoreDatabase = { prepare(sql) { const query = (v: unknown[]) => (local.getStore() ?? pg).query(postgresSql(sql), v); return { run: (...v) => query(v), get: async (...v) => (await query(v)).rows[0], all: async (...v) => (await query(v)).rows }; }, transaction: work => local.getStore() ? work() : pg.transaction(tx => local.run(tx, work)), close: () => pg.close() };
    store = new PostgresParkingStore(db, Date.now, true); await store.seed(catalog);
    for (const table of ["sign_readings", "content_flags", "place_changes"]) {
      const security = await pg.query(`SELECT relrowsecurity FROM pg_class WHERE oid='parkskopje.${table}'::regclass`);
      assert.equal((security.rows[0] as { relrowsecurity: boolean }).relrowsecurity, true, `${table} has row-level security`);
    }
  }
  const app = await buildApp(catalog, store);
  try {
    const headers = { authorization: `Bearer ${(await store.createSession()).token}` };
    const check = async (id: string) => (await app.inject({ url: `/v1/places/${encodeURIComponent(id)}/sms-payment`, headers })).json().protocol;
    assert.equal((await check("gradski:zone:A3")).destination, "144144");
    assert.equal((await check("poc:zone:1:0")).destination, "141414");
    const community = catalog.places.find(place => place.kind !== "zone")!;
    assert.equal(await check(community.id), null);
    assert.equal((await app.inject({ method: "POST", url: "/v1/places/gradski:zone:A3/labels", headers, payload: { zoneCode: "A4" } })).statusCode, 200);
    assert.equal(await check("gradski:zone:A3"), null, "a disputed zone code needs a person, not an SMS");
  } finally { await app.close(); }
});
