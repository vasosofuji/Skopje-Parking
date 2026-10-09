import test from "node:test";
import assert from "node:assert/strict";
import { ParkingStore } from "../server/store";
import { buildApp } from "../server/app";
import type { Catalog } from "../src/domain/types";

const catalog: Catalog = { generatedAt: "2026-10-01T00:00:00Z", places: [], zones: [], destinations: [], coverage: { complete: false, bounds: [], notes: [] } };

test("concurrent address searches queue for the one-per-second geocoder slot instead of failing", async () => {
  const original = globalThis.fetch;
  const calls: number[] = [];
  globalThis.fetch = (async () => {
    calls.push(Date.now());
    return new Response(JSON.stringify([{ place_id: 1, display_name: "Macedonia Square", lat: "41.9961", lon: "21.4316" }]), { status: 200 });
  }) as typeof fetch;
  const app = await buildApp(catalog, new ParkingStore(":memory:", catalog));
  try {
    const responses = await Promise.all(["plostad", "debar maalo", "kapishtec"].map((q, i) =>
      app.inject({ url: `/v1/search?q=${encodeURIComponent(q)}`, remoteAddress: `10.0.0.${i + 1}` })));
    assert.deepEqual(responses.map(r => r.statusCode), [200, 200, 200]);
    assert.equal(responses[2].json()[0].name, "Macedonia Square");
    for (let i = 1; i < calls.length; i++) assert.ok(calls[i] - calls[i - 1] >= 1000, "geocoder calls stay one second apart");
    // Cached answers skip the queue entirely.
    assert.equal((await app.inject({ url: "/v1/search?q=PLOSTAD", remoteAddress: "10.0.0.9" })).statusCode, 200);
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = original;
    await app.close();
  }
});
