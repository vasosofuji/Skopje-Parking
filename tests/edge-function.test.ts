import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgresSql, type StoreDatabase } from "../server/postgres/database";
import { SharedRequestBudget, sharedRateLimitStore } from "../server/postgres/rate-limits";
import { gunzipSync } from "node:zlib";
import { edgeHandler } from "../server/edge";
import { ParkingStore } from "../server/store";
import { buildApp } from "../server/app";
import seed from "../data/catalog.json";
import type { Catalog } from "../src/domain/types";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";

test("notification service worker bypasses the SPA rewrite and is served as updatable JavaScript", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8"));
  const fallback = config.rewrites.find((rule: { destination: string }) => rule.destination === "/index.html");
  const match = new RegExp(`^${fallback.source}$`);
  assert.equal(match.test("/parking-sw.js"), false);
  assert.equal(match.test("/settings"), true);
  assert.equal(match.test("/_expo/static/js/web/example.js"), false);
  const workerHeaders = Object.fromEntries(config.headers.find((rule: { source: string }) => rule.source === "/parking-sw.js").headers.map((header: { key: string; value: string }) => [header.key, header.value]));
  assert.match(workerHeaders["Content-Type"], /application\/javascript/);
  assert.match(workerHeaders["Cache-Control"], /max-age=0/);
  assert.equal(workerHeaders["Service-Worker-Allowed"], "/");
  assert.match(readFileSync("public/parking-sw.js", "utf8"), /addEventListener\("push"/);
});

test("rate budgets survive another function instance and reset after expiry", async () => {
  const pg = new PGlite();
  await pg.exec("CREATE SCHEMA parkskopje; SET search_path TO parkskopje;");
  await pg.exec(readFileSync("supabase/migrations/20261003101436_shared_request_limits.sql", "utf8"));
  const db: StoreDatabase = {
    prepare: sql => ({
      run: (...values) => pg.query(postgresSql(sql), values),
      get: async (...values) => (await pg.query(postgresSql(sql), values)).rows[0],
      all: async (...values) => (await pg.query(postgresSql(sql), values)).rows,
    }),
    transaction: work => work(), close: () => pg.close(),
  };
  const first = new SharedRequestBudget(db), second = new SharedRequestBudget(db);
  try {
    await first.consume("login", "person", 2, 60000);
    await second.consume("login", "person", 2, 60000);
    await assert.rejects(first.consume("login", "person", 2, 60000), { statusCode: 429 });
    const rows = (await pg.query<{ key: string }>("SELECT key FROM request_limits")).rows;
    assert.equal(rows[0].key.includes("person"), false);
    await pg.exec("UPDATE request_limits SET expires=0");
    await second.consume("login", "person", 2, 60000);
    // Failed sign-ins are checked without counting the check itself, and a success clears them.
    assert.equal(await first.peek("login", "person"), 1);
    assert.equal(await second.peek("login", "person"), 1);
    await first.reset("login", "person");
    assert.equal(await second.peek("login", "person"), 0);
    const Store = sharedRateLimitStore(first);
    const root = new Store({}), route = root.child({ path: "/login", prefix: "" } as never);
    const increment = (store: typeof root | typeof route) => new Promise<number>((resolve, reject) =>
      store.incr("client", (error, result) => error ? reject(error) : resolve(Number(result!.current)), 60000, 2));
    assert.equal(await increment(root), 1);
    assert.equal(await increment(root), 2);
    assert.equal(await increment(route), 1);
    const app = Fastify();
    await app.register(rateLimit, { store: Store, max: 100, timeWindow: 60000 });
    app.get("/one", { config: { rateLimit: { max: 1 } } }, async () => ({ ok: true }));
    app.get("/two", { config: { rateLimit: { max: 2 } } }, async () => ({ ok: true }));
    try {
      assert.equal((await app.inject("/one")).statusCode, 200);
      assert.equal((await app.inject("/one")).statusCode, 429);
      assert.equal((await app.inject("/two")).statusCode, 200, "route budgets do not collide");
      assert.equal((await app.inject("/two")).statusCode, 200);
      assert.equal((await app.inject("/two")).statusCode, 429);
    } finally { await app.close(); }
    await pg.exec("UPDATE request_limits SET expires=0");
    await second.prune();
    assert.equal((await pg.query("SELECT * FROM request_limits")).rows.length, 0);
  } finally { await pg.close(); }
});

test("the Edge Function strips its name from the path, gzips JSON, and refuses oversized bodies before reading them", async () => {
  const tasks: Promise<void>[] = [];
  const app = await buildApp(seed as Catalog, new ParkingStore(":memory:", seed as Catalog), { backgroundTask: task => { tasks.push(task); } });
  const handle = edgeHandler(async () => app);
  try {
    const health = await handle(new Request("http://edge.test/api/health"));
    assert.deepEqual(await health.json(), { status: "ok", schemaVersion: 1 });
    const full = await handle(new Request("http://edge.test/api/v1/changes?since=0", { headers: { "Accept-Encoding": "gzip" } }));
    assert.equal(full.headers.get("content-encoding"), "gzip");
    const zipped = Buffer.from(await full.arrayBuffer()), places = JSON.parse(gunzipSync(zipped).toString()).places;
    assert.equal(places.length, (seed as Catalog).places.length);
    assert.ok(zipped.byteLength * 4 < JSON.stringify(places).length, "the map download is compressed");
    const session = await handle(new Request("http://edge.test/api/v1/sessions", { method: "POST" }));
    assert.equal(session.status, 201);
    assert.equal(session.headers.get("cache-control"), "no-store");
    const huge = await handle(new Request("http://edge.test/api/v1/contributions", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": String(600 * 1024) }, body: "x".repeat(600 * 1024) }));
    assert.equal(huge.status, 413);
    assert.ok(tasks.length > 0, "work after a response is handed to the runtime");
    await Promise.all(tasks);
    const broken = edgeHandler(async () => { throw new Error("postgres://user:secret@host"); });
    const failed = await broken(new Request("http://edge.test/api/health"));
    assert.equal(failed.status, 503);
    assert.equal((await failed.text()).includes("secret"), false);
  } finally { await app.close(); }
});

test("maintenance requires its own secret", async () => {
  const store = new ParkingStore(":memory:", seed as Catalog);
  const app = await buildApp(seed as Catalog, store, { backgroundTask: () => {}, cronSecret: "private-cron-secret" });
  try {
    assert.equal((await app.inject("/internal/maintenance")).statusCode, 401);
    assert.equal((await app.inject({ url: "/internal/maintenance", headers: { authorization: "Bearer wrong" } })).statusCode, 401);
    assert.equal((await app.inject({ url: "/internal/maintenance", headers: { authorization: "Bearer private-cron-secret" } })).statusCode, 200);
  } finally { await app.close(); }
});
