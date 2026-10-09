import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { buildApp } from "../server/app";
import { AccountStore } from "../server/accounts";
import { PostgresAccountStore } from "../server/postgres/accounts";
import { ParkingStore } from "../server/store";
import { PostgresParkingStore } from "../server/postgres/store";
import { postgresSql, type StoreDatabase } from "../server/postgres/database";
import { LoginAttemptLimiter } from "../server/account-routes";
import { hashPassword, tokenHash, verifyPassword } from "../server/account-security";
import { TERMS_VERSION } from "../src/domain/account";
import type { Catalog } from "../src/domain/types";

const catalog: Catalog = { generatedAt: new Date().toISOString(), places: [], zones: [], destinations: [], coverage: { complete: false, bounds: [], notes: [] } };
const PASSWORD = "parking test password 2026";
class TestDatabase implements StoreDatabase {
  private local = new AsyncLocalStorage<Transaction>();
  constructor(readonly pg: PGlite) {}
  prepare(sql: string) {
    const query = (values: unknown[]) => (this.local.getStore() ?? this.pg).query(postgresSql(sql), values);
    return { run: (...values: unknown[]) => query(values), get: async (...values: unknown[]) => (await query(values)).rows[0], all: async (...values: unknown[]) => (await query(values)).rows };
  }
  transaction<T>(work: () => Promise<T>) { return this.local.getStore() ? work() : this.pg.transaction((tx) => this.local.run(tx, work)); }
  async close() { await this.pg.close(); }
}
async function fixture(backend: "sqlite" | "postgres") {
  let store: ParkingStore | PostgresParkingStore;
  let accounts: AccountStore | PostgresAccountStore;
  if (backend === "sqlite") {
    store = new ParkingStore(":memory:", catalog, Date.now, true);
    accounts = new AccountStore(store);
  } else {
    const pg = await PGlite.create({ parsers: { 20: Number } });
    for (const file of readdirSync("supabase/migrations").filter(f => f.endsWith(".sql")).sort())
      await pg.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    store = new PostgresParkingStore(new TestDatabase(pg), Date.now, true);
    accounts = new PostgresAccountStore(store);
  }
  const app = await buildApp(catalog, store, { requireOnboarding: true });
  return { store, accounts, app };
}
function authorization(token: string) { return { authorization: "Bearer " + token }; }

for (const backend of ["sqlite", "postgres"] as const) {
  test(`${backend}: password accounts recover the same username, ownership and points after reinstall`, async () => {
    const { app, store, accounts } = await fixture(backend);
    try {
      const initial = await store.createSession();
      const created = await app.inject({ method: "POST", url: "/v1/profile", headers: authorization(initial.token), payload: { username: "Driver_MK", password: PASSWORD, accepted: true, termsVersion: TERMS_VERSION } });
      assert.equal(created.statusCode, 200, created.body);
      const profile = created.json();
      assert.equal(profile.secured, true);
      assert.equal(profile.points, 0);
      assert.equal(JSON.stringify(profile).includes("password"), false);
      const owner = await store.session(initial.token);
      const credential = await store.db.prepare("SELECT password_hash FROM account_credentials WHERE session_id=?").get(owner.id) as { password_hash: string };
      assert.ok(credential.password_hash.startsWith("scrypt:32768:8:3:"));
      assert.equal(credential.password_hash.includes(PASSWORD), false);
      const initialSession = await store.db.prepare("SELECT expires FROM auth_sessions WHERE hash=?").get(tokenHash(initial.token)) as { expires: number };
      assert.ok(initialSession.expires > Date.now());
      const canonical = await store.db.prepare("SELECT hash FROM sessions WHERE id=?").get(owner.id) as { hash: string };
      assert.notEqual(canonical.hash, tokenHash(initial.token));
      assert.equal(await accounts.award(initial.token, "parking:one", "parking"), 10);
      assert.equal(await accounts.award(initial.token, "parking:one", "parking"), 0);
      assert.equal(await accounts.award(initial.token, "boundary:one", "boundary"), 20);
      const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { username: "ｄｒｉｖｅｒ＿ｍｋ", password: PASSWORD } });
      assert.equal(login.statusCode, 200, login.body);
      assert.equal(login.headers["cache-control"], "no-store");
      const restored = login.json();
      assert.equal(restored.profile.id, owner.id);
      assert.equal(restored.profile.points, 30);
      assert.equal(restored.profile.username, "Driver_MK");
      assert.notEqual(restored.token, initial.token);
      assert.equal(restored.token.length, 64);
      assert.deepEqual(await store.session(restored.token), owner);
      const again = await accounts.login("driver_mk", PASSWORD);
      assert.notEqual(again.token, restored.token);
      assert.equal(await accounts.award(again.token, "parking:one", "parking"), 0);
      const rewards = await app.inject({ url: "/v1/rewards", headers: authorization(again.token) });
      assert.equal(rewards.json().total, 30);
      assert.equal(rewards.json().events.length, 2);
      const signedOut = await app.inject({ method: "POST", url: "/v1/auth/logout", headers: authorization(restored.token) });
      assert.equal(signedOut.statusCode, 200);
      await assert.rejects(async () => store.session(restored.token), /valid session/);
      assert.equal((await accounts.profile(again.token))?.id, owner.id);
      await accounts.logout(initial.token);
      await assert.rejects(async () => store.session(initial.token), /valid session/);
      const recovered = await accounts.login("DRIVER_MK", PASSWORD);
      assert.equal(recovered.profile.points, 30);
      await store.db.prepare("UPDATE auth_sessions SET expires=? WHERE hash=?").run(Date.now() - 1, tokenHash(recovered.token));
      await assert.rejects(async () => store.session(recovered.token), /valid session/);
      assert.equal((await accounts.profile(again.token))?.secured, true);
      const deleted = await app.inject({ method: "DELETE", url: "/v1/sessions/me", headers: authorization(again.token) });
      assert.equal(deleted.statusCode, 200, deleted.body);
      for (const table of ["profiles", "account_credentials", "auth_sessions", "reward_events"])
        assert.equal(Number((await store.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE session_id=?`).get(owner.id) as { n: number }).n), 0);
      await assert.rejects(accounts.login("Driver_MK", PASSWORD), /Username or password is incorrect/);
      assert.equal(await accounts.available("Driver_MK"), true);
    } finally { await app.close(); }
  });
  test(`${backend}: existing device names can be secured only once, and invalid login cannot claim them`, async () => {
    const { app, store, accounts } = await fixture(backend);
    try {
      const initial = await store.createSession();
      const legacy = await accounts.register(initial.token, "Existing_Driver", TERMS_VERSION, true);
      assert.equal(legacy.secured, false);
      await assert.rejects(async () => accounts.logout(initial.token), /Save a password/);
      await assert.rejects(accounts.login("Existing_Driver", PASSWORD), /Username or password is incorrect/);
      const secured = await accounts.secure(initial.token, PASSWORD);
      assert.equal(secured.profile.id, legacy.id);
      assert.equal(secured.profile.secured, true);
      await assert.rejects(async () => store.session(initial.token), /valid session/);
      await assert.rejects(accounts.secure(secured.token, "different new password"), /already has a password/);
      const wrong = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { username: "Existing_Driver", password: "wrong password" } });
      const missing = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { username: "Missing_Driver", password: "wrong password" } });
      assert.equal(wrong.statusCode, 401);
      assert.equal(missing.statusCode, 401);
      assert.deepEqual(wrong.json(), missing.json());
      assert.equal((await accounts.login("Existing_Driver", PASSWORD)).profile.id, legacy.id);
      const other = await store.createSession();
      await accounts.register(other.token, "Another_Driver", TERMS_VERSION, true, PASSWORD);
      assert.equal((await accounts.rewards(other.token)).total, 0);
      assert.equal((await app.inject({ method: "POST", url: "/v1/auth/password", headers: authorization(other.token), payload: { password: PASSWORD, sessionId: legacy.id } })).statusCode, 400);
      const pendingLogin = accounts.login("Existing_Driver", PASSWORD);
      const pendingResult = pendingLogin.then(value => ({ value }), error => ({ error }));
      await store.deleteSession(secured.token);
      const result = await pendingResult;
      assert.ok("error" in result);
      assert.equal(result.error.statusCode, 401);
      assert.equal((await accounts.profile(other.token))?.username, "Another_Driver");
    } finally { await app.close(); }
  });
}

test("password derivation uses unique salts and rejects incorrect or malformed values", async () => {
  const [first, second] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(PASSWORD, first), true);
  assert.equal(await verifyPassword("wrong password", first), false);
  assert.equal(await verifyPassword(PASSWORD), false);
  assert.equal(await verifyPassword(PASSWORD, "malformed"), false);
  await assert.rejects(hashPassword("short"), /10-128/);
  await assert.rejects(hashPassword(" ".repeat(20)), /10-128/);
});

test("login throttle counts failed case-equivalent usernames across IPs, resets on success and expires", () => {
  let now = 1000;
  const limiter = new LoginAttemptLimiter(() => now, 50);
  for (let i = 0; i < 8; i++) limiter.failed(i % 2 ? "Ｄｒｉｖｅｒ" : "driver", `10.0.0.${i}`);
  assert.equal(limiter.blocked("Driver", "10.9.9.9"), true);
  assert.equal(limiter.blocked("another_driver", "10.0.0.1"), false);
  now += 15 * 60 * 1000;
  assert.equal(limiter.blocked("driver", "10.0.0.1"), false);
  for (let i = 0; i < 7; i++) limiter.failed("driver", "10.0.0.1");
  limiter.succeeded("DRIVER");
  assert.equal(limiter.blocked("driver", "10.0.0.1"), false, "a correct password clears that username's failures");
  // A carrier IP shared by many drivers is only blocked by sustained password spraying.
  for (let i = 0; i < 99; i++) limiter.failed(`user_${i}`, "100.64.0.1");
  assert.equal(limiter.blocked("someone_new", "100.64.0.1"), false);
  limiter.failed("user_last", "100.64.0.1");
  assert.equal(limiter.blocked("someone_new", "100.64.0.1"), true);
  assert.equal(limiter.blocked("someone_new", "100.64.0.2"), false);
});

test("many drivers behind one carrier IP can all sign in; failures alone trigger limits", async () => {
  const { app, store, accounts } = await fixture("sqlite");
  try {
    for (let i = 0; i < 15; i++) {
      const session = await store.createSession();
      await accounts.register(session.token, `cgnat_driver_${i}`, TERMS_VERSION, true, PASSWORD);
    }
    for (let i = 0; i < 15; i++) {
      const login = await app.inject({ method: "POST", url: "/v1/auth/login", remoteAddress: "100.64.0.7", payload: { username: `cgnat_driver_${i}`, password: PASSWORD } });
      assert.equal(login.statusCode, 200, login.body);
    }
  } finally { await app.close(); }
});

test("login API enforces username throttle and never returns a bearer token for failed login", async () => {
  const { app } = await fixture("sqlite");
  try {
    for (let i = 0; i < 8; i++) {
      const result = await app.inject({ method: "POST", url: "/v1/auth/login", remoteAddress: `10.0.0.${i + 1}`, payload: { username: "NoSuchUser", password: PASSWORD } });
      assert.equal(result.statusCode, 401);
      assert.equal(result.json().token, undefined);
    }
    const result = await app.inject({ method: "POST", url: "/v1/auth/login", remoteAddress: "10.0.0.20", payload: { username: "nosuchuser", password: PASSWORD } });
    assert.equal(result.statusCode, 429);
    assert.equal(result.json().token, undefined);
  } finally { await app.close(); }
});
