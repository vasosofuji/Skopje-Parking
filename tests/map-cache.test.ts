import test from "node:test";
import assert from "node:assert/strict";
import seed from "../data/catalog.json";
import type { Catalog } from "../src/domain/types";
import { createLayerCache } from "../src/domain/layer-cache";
import { decodeCatalogCache, encodeCatalogCache } from "../src/domain/catalog-cache";
import { currentAvailability } from "../src/domain/parking";

test("layer cache reuses unchanged visible and recently detached layers and evicts old detached layers", () => {
  const attached = new Set<object>(), disposed: object[] = [];
  const cache = createLayerCache<object>(layer => attached.add(layer), layer => attached.delete(layer), layer => disposed.push(layer), 2);
  let creates = 0;
  const make = () => ({ id: ++creates });
  cache.begin(); const first = cache.use("one", "free", make); cache.end();
  cache.begin(); assert.equal(cache.use("one", "free", make), first); cache.end();
  assert.equal(creates, 1);
  cache.begin(); cache.end(); assert.equal(attached.size, 0);
  cache.begin(); assert.equal(cache.use("one", "free", make), first); cache.end();
  cache.begin(); const changed = cache.use("one", "full", make); cache.end();
  assert.notEqual(changed, first); assert.deepEqual(disposed, [first]);
  cache.begin(); cache.use("two", "a", make); cache.end();
  cache.begin(); cache.use("three", "a", make); cache.end();
  assert.ok(disposed.includes(changed)); assert.equal(attached.size, 1);
  cache.clear(); assert.equal(attached.size, 0);
});

test("catalog cache is bounded, rejects corrupt and obsolete records, and preserves report expiry", () => {
  const now = Date.now(), catalog = structuredClone(seed) as Catalog;
  catalog.places[0].availability = { status: "spaces", observedAt: new Date(now).toISOString(), expiresAt: new Date(now + 1000).toISOString(), source: "community", reports: 1 };
  const encoded = encodeCatalogCache(catalog, [], now, 7)!;
  const restored = decodeCatalogCache(encoded, seed.generatedAt, now + 2000)!;
  assert.equal(restored.catalog.places.length, catalog.places.length);
  assert.notEqual(currentAvailability(restored.catalog.places[0].availability, now + 2000).status, "spaces");
  assert.equal(decodeCatalogCache(encoded, seed.generatedAt, now + 8 * 86400000), null);
  assert.equal(decodeCatalogCache(encoded, "2999-01-01"), null);
  assert.equal(decodeCatalogCache("bad json", seed.generatedAt), null);
  assert.equal(decodeCatalogCache("x".repeat(8000001), seed.generatedAt), null);
  for (const patch of [{ destinations: undefined }, { destinations: [{ id: "bad" }] }, { coverage: undefined }, { coverage: { complete: false, bounds: [], notes: [] } }, { coverage: { complete: false, bounds: [1, 2, 3, 4], notes: [null] } }]) {
    const value = JSON.parse(encoded); Object.assign(value.catalog, patch);
    assert.equal(decodeCatalogCache(JSON.stringify(value), seed.generatedAt, now), null);
  }
  catalog.places[0].name = "x".repeat(8000001);
  assert.equal(encodeCatalogCache(catalog, [], now), null);
});
