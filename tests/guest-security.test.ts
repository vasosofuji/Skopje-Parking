import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { buildApp } from "../server/app";
import { ParkingStore } from "../server/store";
import { PostgresParkingStore } from "../server/postgres/store";
import { postgresSql, type StoreDatabase } from "../server/postgres/database";
import { PasswordWorkLimiter, RequestBudget, verifyPassword } from "../server/account-security";
import { TERMS_VERSION } from "../src/domain/account";
import type { Catalog } from "../src/domain/types";

const catalog: Catalog = { generatedAt: "2026-10-01T00:00:00Z", places: [], zones: [], destinations: [], coverage: { complete: false, bounds: [], notes: [] } };
const password = "guest upgrade test password";
const contribution = { requestId: "guest-contribution", name: "Guest parking", coordinate: { latitude: 41.997, longitude: 21.433 }, kind: "surface", zoneCode: null, firstHour: null, nextHour: null };
const sign = { info: { isParkingSign: true, confidence: 0.8, zoneCode: "A3", operator: null, currency: "MKD", firstHour: 40, nextHour: 40, maxStayMinutes: 120, freeWeekends: null, chargingHours: null, paymentInstructions: null, restrictions: null, rawText: "" }, model: "ocr:mlkit-text-v2" };
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
async function fixture(backend: "sqlite" | "postgres") {
  let store: ParkingStore | PostgresParkingStore;
  let pg: PGlite | undefined;
  if (backend === "sqlite") store = new ParkingStore(":memory:", catalog, Date.now, true);
  else {
    pg = await PGlite.create({ parsers: { 20: Number } });
    await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE parkino_api;");
    for (const file of readdirSync("supabase/migrations").filter(file => file.endsWith(".sql")).sort())
      await pg.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    const engine = pg, local = new AsyncLocalStorage<Transaction>();
    const db: StoreDatabase = {
      prepare(sql) {
        const query = (values: unknown[]) => (local.getStore() ?? engine).query(postgresSql(sql), values);
        return { run: (...values) => query(values), get: async (...values) => (await query(values)).rows[0], all: async (...values) => (await query(values)).rows };
      },
      transaction: work => local.getStore() ? work() : engine.transaction(tx => local.run(tx, work)),
      close: () => engine.close(),
    };
    store = new PostgresParkingStore(db, Date.now, true);
  }
  const app = await buildApp(catalog, store, { requireOnboarding: true });
  const token = (await store.createSession()).token;
  const write = (url: string, payload: unknown, session = token) => app.inject({ method: "POST", url, headers: auth(session), payload: payload as object });
  return { app, store, pg, token, write };
}

for (const backend of ["sqlite", "postgres"] as const) {
  test(`${backend}: guests accept current terms, contribute and upgrade without losing identity or points`, async () => {
    const { app, store, token, write, pg } = await fixture(backend);
    try {
      assert.equal((await write("/v1/contributions", contribution)).statusCode, 403);
      for (const body of [{ accepted: false, termsVersion: TERMS_VERSION }, { accepted: true, termsVersion: "old" }, { accepted: true, termsVersion: TERMS_VERSION, sessionId: "somebody-else" }])
        assert.equal((await write("/v1/auth/guest", body)).statusCode, 400);
      assert.equal((await app.inject({ url: "/v1/profile", headers: auth(token) })).json(), null);
      const guestResponse = await write("/v1/auth/guest", { accepted: true, termsVersion: TERMS_VERSION });
      assert.equal(guestResponse.statusCode, 200, guestResponse.body);
      assert.equal(guestResponse.headers["cache-control"], "no-store");
      const guest = guestResponse.json();
      assert.equal(guest.guest, true); assert.equal(guest.username, ""); assert.equal(guest.secured, false);
      assert.equal((await write("/v1/auth/guest", { accepted: true, termsVersion: TERMS_VERSION })).json().acceptedAt, guest.acceptedAt);
      const other = (await store.createSession()).token;
      const second = (await write("/v1/auth/guest", { accepted: true, termsVersion: TERMS_VERSION }, other)).json();
      assert.notEqual(second.id, guest.id); assert.equal(second.username, "");
      const place = await write("/v1/contributions", contribution);
      assert.equal(place.statusCode, 201, place.body);
      assert.equal((await app.inject({ url: "/v1/rewards", headers: auth(token) })).json().total, 10);
      assert.equal((await write("/v1/profile", { username: "GuestDriver", accepted: true, termsVersion: TERMS_VERSION })).statusCode, 400, "new named accounts require a password");
      assert.equal((await write("/v1/auth/password", { password })).statusCode, 403, "a guest cannot secure an empty username");
      const named = await write("/v1/profile", { username: "GuestDriver", password, accepted: true, termsVersion: TERMS_VERSION });
      assert.equal(named.statusCode, 200, named.body);
      assert.equal(named.json().guest, false); assert.equal(named.json().id, guest.id); assert.equal(named.json().points, 10); assert.equal(named.json().secured, true);
      const remaining = await store.db.prepare("SELECT COUNT(*) AS n FROM guest_profiles WHERE session_id=?").get(guest.id) as { n: number };
      assert.equal(Number(remaining.n), 0);
      const ownership = await store.db.prepare("SELECT session_id FROM contributions WHERE place_id=?").get(place.json().id) as { session_id: string };
      assert.equal(ownership.session_id, guest.id);
      const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { username: "ｇｕｅｓｔｄｒｉｖｅｒ", password } });
      assert.equal(login.statusCode, 200, login.body);
      assert.equal(login.json().profile.id, guest.id); assert.equal(login.json().profile.points, 10);
      const cannotClaim = await write("/v1/profile", { username: "GUESTDRIVER", password, accepted: true, termsVersion: TERMS_VERSION }, other);
      assert.equal(cannotClaim.statusCode, 409);
      assert.equal((await app.inject({ url: "/v1/profile", headers: auth(other) })).json().guest, true, "failed upgrade retains the guest");
      assert.equal((await write("/v1/auth/guest", { accepted: true, termsVersion: TERMS_VERSION })).json().guest, false, "named accounts cannot be downgraded");
      if (pg) {
        const permissions = (await pg.query<{ rls: boolean; anonymous: boolean; client: boolean; api: boolean }>(`SELECT c.relrowsecurity AS rls,
          has_table_privilege('anon','parkskopje.guest_profiles','SELECT') AS anonymous,
          has_table_privilege('authenticated','parkskopje.guest_profiles','SELECT') AS client,
          has_table_privilege('parkino_api','parkskopje.guest_profiles','SELECT') AS api
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='parkskopje' AND c.relname='guest_profiles'`)).rows[0];
        assert.deepEqual(permissions, { rls: true, anonymous: false, client: false, api: true });
      }
      await app.inject({ method: "DELETE", url: "/v1/sessions/me", headers: auth(other) });
      assert.equal(Number((await store.db.prepare("SELECT COUNT(*) AS n FROM guest_profiles WHERE session_id=?").get(second.id) as { n: number }).n), 0);
    } finally { await app.close(); }
  });

  test(`${backend}: concurrent guest upgrades cannot create two names, and stale consent blocks writes`, async () => {
    const { app, store, token, write } = await fixture(backend);
    try {
      const guest = (await write("/v1/auth/guest", { accepted: true, termsVersion: TERMS_VERSION })).json();
      await store.db.prepare("UPDATE guest_profiles SET terms_version=? WHERE session_id=?").run("old", guest.id);
      assert.equal((await write("/v1/contributions", contribution)).statusCode, 403);
      assert.equal((await write("/v1/auth/guest", { accepted: true, termsVersion: TERMS_VERSION })).statusCode, 200);
      const attempts = await Promise.all(["FirstName", "SecondName"].map(username => write("/v1/profile", { username, password, accepted: true, termsVersion: TERMS_VERSION })));
      assert.deepEqual(attempts.map(response => response.statusCode).sort(), [200, 409]);
      assert.equal(Number((await store.db.prepare("SELECT COUNT(*) AS n FROM profiles WHERE session_id=?").get(guest.id) as { n: number }).n), 1);
      assert.equal((await app.inject({ url: "/v1/profile", headers: auth(token) })).json().id, guest.id);
    } finally { await app.close(); }
  });
}

test("sign and contribution budgets follow an account across IP addresses", async () => {
  const { app, token, write } = await fixture("sqlite");
  try {
    await write("/v1/auth/guest", { accepted: true, termsVersion: TERMS_VERSION });
    const place = (await write("/v1/contributions", contribution)).json();
    for (let i = 0; i < 11; i++) {
      const response = await app.inject({ method: "POST", url: `/v1/places/${place.id}/signs`, headers: auth(token), remoteAddress: `10.0.0.${i + 1}`, payload: sign });
      assert.equal(response.statusCode, i < 10 ? 201 : 429, response.body);
    }
    // Only small confirmed details are accepted; a photo-sized body is refused before it is read.
    const oversized = await app.inject({ method: "POST", url: `/v1/places/${place.id}/signs`, remoteAddress: "10.0.1.1", payload: { ...sign, info: { ...sign.info, rawText: "A".repeat(100 * 1024) } } });
    assert.equal(oversized.statusCode, 413);
    for (let i = 0; i < 20; i++) {
      const response = await app.inject({ method: "POST", url: "/v1/contributions", headers: auth(token), remoteAddress: `10.1.0.${i + 1}`, payload: contribution });
      assert.equal(response.statusCode, i < 19 ? 201 : 429, response.body);
    }
  } finally { await app.close(); }
});

test("resource budgets stay bounded, expire and release password work after failures", async () => {
  let now = 0;
  const budget = new RequestBudget(() => now, 2);
  budget.consume("write", "one", 1, 1000);
  assert.throws(() => budget.consume("write", "one", 1, 1000), { statusCode: 429 });
  budget.consume("write", "two", 1, 1000);
  assert.throws(() => budget.consume("write", "three", 1, 1000), { statusCode: 429 });
  now = 10000;
  assert.doesNotThrow(() => budget.consume("write", "three", 1, 1000));
  const gate = new PasswordWorkLimiter(1);
  let release!: () => void;
  const pending = gate.run(() => new Promise<void>(resolve => { release = resolve; }));
  await assert.rejects(gate.run(async () => "never"), { statusCode: 429 });
  release(); await pending;
  await assert.rejects(gate.run(async () => { throw new Error("failure"); }), /failure/);
  assert.equal(await gate.run(async () => "released"), "released");
  // A sign-up burst waits in a bounded queue instead of failing.
  const queued = new PasswordWorkLimiter(1, 1);
  let finish!: () => void;
  const order: string[] = [];
  const first = queued.run(() => new Promise<void>(resolve => { finish = resolve; }).then(() => { order.push("first"); }));
  const second = queued.run(async () => { order.push("second"); });
  await assert.rejects(queued.run(async () => "overflow"), { statusCode: 429 });
  finish(); await Promise.all([first, second]);
  assert.deepEqual(order, ["first", "second"]);
  assert.equal(await queued.run(async () => "idle"), "idle");
  assert.equal(await verifyPassword("x".repeat(129)), false);
});
