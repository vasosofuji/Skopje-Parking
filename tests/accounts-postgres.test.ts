import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import {
  PgDatabase,
  postgresSql,
  type StoreDatabase,
} from "../server/postgres/database";
import type { PoolClient } from "pg";
import { PostgresParkingStore } from "../server/postgres/store";
import { PostgresCommunityStore } from "../server/postgres/community";
import { ParkingStore } from "../server/store";
import { buildApp } from "../server/app";
import { TERMS_VERSION } from "../src/domain/account";
import { zoneGeometry } from "../src/domain/geometry";
import type { Catalog, SignInfo } from "../src/domain/types";

test("an idle PostgreSQL connection failure does not crash the API or expose credentials", async (t) => {
  const db = new PgDatabase("postgresql://test:test@localhost:5432/test");
  const warning = t.mock.method(console, "warn", () => {});
  try {
    assert.doesNotThrow(() => db.pool.emit("error", new Error("private connection details")));
    assert.equal(warning.mock.callCount(), 1);
    assert.equal(String(warning.mock.calls[0].arguments[0]).includes("private"), false);
  } finally {
    warning.mock.restore();
    await db.close();
  }
});

test("PostgreSQL pool initializes the private schema and keeps a transaction on one connection", async (t) => {
  const db = new PgDatabase("postgresql://test:test@localhost:5432/test", "session");
  const queries: { sql: string; values?: unknown[] }[] = [];
  let releases = 0;
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      return { rows: [{ value: 7 }] };
    },
    release: () => {
      releases++;
    },
  } as unknown as PoolClient;
  const connect = t.mock.method(db.pool, "connect", async () => client);
  try {
    assert.deepEqual(await db.prepare("SELECT ? AS value").get(7), {
      value: 7,
    });
    await db.transaction(async () => {
      await db.prepare("SELECT ?").get(2);
      await db.transaction(async () => {
        await db.prepare("SELECT ?").all(3);
      });
    });
    await assert.rejects(
      db.transaction(async () => {
        throw new Error("abort");
      }),
      /abort/,
    );
    assert.equal(connect.mock.callCount(), 3);
    assert.equal(releases, 3);
    assert.deepEqual(
      queries.map((q) => q.sql),
      [
        "SET search_path TO parkskopje",
        "SELECT $1 AS value",
        "BEGIN",
        "SELECT $1",
        "SELECT $1",
        "COMMIT",
        "BEGIN",
        "ROLLBACK",
      ],
    );
    assert.deepEqual(queries[1].values, [7]);
  } finally {
    await db.close();
  }
});

const catalog: Catalog = {
  generatedAt: new Date().toISOString(),
  places: [],
  zones: [],
  destinations: [],
  coverage: { complete: false, bounds: [], notes: [] },
};
const points = [
  { latitude: 41.996, longitude: 21.432 },
  { latitude: 41.997, longitude: 21.432 },
  { latitude: 41.997, longitude: 21.433 },
];
const contribution = {
  requestId: "postgres-zone-demo",
  name: "Demo B2 parking",
  coordinate: points[0],
  geometry: zoneGeometry(points),
  kind: "zone",
  zoneCode: "B2",
  firstHour: 0,
  nextHour: 0,
};

class TestPostgresDatabase implements StoreDatabase {
  count = 0;
  private local = new AsyncLocalStorage<Transaction>();
  constructor(readonly pg: PGlite) {}
  prepare(sql: string) {
    const query = async (values: unknown[]) => {
      this.count++;
      return (this.local.getStore() ?? this.pg).query(postgresSql(sql), values);
    };
    return {
      run: (...values: unknown[]) => query(values),
      get: async (...values: unknown[]) => (await query(values)).rows[0],
      all: async (...values: unknown[]) => (await query(values)).rows,
    };
  }
  transaction<T>(work: () => Promise<T>) {
    return this.local.getStore()
      ? work()
      : this.pg.transaction((tx) => this.local.run(tx, work));
  }
  async close() {
    await this.pg.close();
  }
}

for (const backend of ["sqlite", "postgres"] as const) {
  test(`${backend}: onboarding requires consent and unique usernames across simultaneous users`, async () => {
    let store: ParkingStore | PostgresParkingStore;
    if (backend === "postgres") {
      const pg = await PGlite.create({ parsers: { 20: Number } });
      await pg.exec(
        readdirSync("supabase/migrations").filter(f => f.endsWith(".sql")).sort().map(f => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n"),
      );
      store = new PostgresParkingStore(
        new TestPostgresDatabase(pg),
        Date.now,
        true,
      );
      await store.seed(catalog);
    } else store = new ParkingStore(":memory:", catalog, Date.now, true);
    const app = await buildApp(catalog, store, { requireOnboarding: true });
    try {
      const first = await store.createSession(),
        second = await store.createSession();
      const h1 = { authorization: "Bearer " + first.token },
        h2 = { authorization: "Bearer " + second.token };
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/v1/contributions",
            headers: h1,
            payload: contribution,
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/v1/profile",
            headers: h1,
            payload: {
              username: "DemoUser",
              accepted: false,
              termsVersion: TERMS_VERSION,
            },
          })
        ).statusCode,
        400,
      );
      const registrations = await Promise.all(
        [h1, h2].map((headers, i) =>
          app.inject({
            method: "POST",
            url: "/v1/profile",
            headers,
            payload: {
              username: i ? "ｄｅｍｏｕｓｅｒ" : "DemoUser",
              password: "recoverable test password",
              accepted: true,
              termsVersion: TERMS_VERSION,
            },
          }),
        ),
      );
      assert.deepEqual(
        registrations.map((r) => r.statusCode).sort(),
        [200, 409],
      );
      const winner = registrations[0].statusCode === 200 ? h1 : h2,
        loser = winner === h1 ? h2 : h1;
      assert.equal(
        (
          await app.inject("/v1/usernames/availability?username=DEMOUSER")
        ).json().available,
        false,
      );
      const profile = (
        await app.inject({ url: "/v1/profile", headers: winner })
      ).json();
      assert.equal(profile.termsVersion, TERMS_VERSION);
      assert.ok(Date.parse(profile.acceptedAt));
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/v1/profile",
            headers: loser,
            payload: {
              username: "DemoSecond",
              password: "recoverable test password",
              accepted: true,
              termsVersion: TERMS_VERSION,
            },
          })
        ).statusCode,
        200,
      );
      const added = await app.inject({
        method: "POST",
        url: "/v1/contributions",
        headers: winner,
        payload: contribution,
      });
      assert.equal(added.statusCode, 201, added.body);
      const id = added.json().id,
        path = `/v1/places/${id}`;
      const retries = await Promise.all(
        [1, 2].map(() =>
          app.inject({
            method: "POST",
            url: "/v1/contributions",
            headers: winner,
            payload: contribution,
          }),
        ),
      );
      assert.ok(
        retries.every((r) => r.json().id === id),
        "repeated requests preserve one zone",
      );
      const moved = zoneGeometry(
        points.map((p, i) =>
          i === 0 ? { ...p, longitude: p.longitude + 0.0002 } : p,
        ),
      );
      for (const [url, payload, method] of [
        [path + "/boundary", moved, "PUT"],
        [path + "/prices", { firstHour: 45.5, nextHour: 30 }, "POST"],
        [path + "/labels", { zoneCode: "А42" }, "POST"],
      ] as const) {
        const r = await app.inject({ method, url, headers: loser, payload });
        assert.equal(r.statusCode, 200, r.body);
      }
      const shared = (await app.inject("/v1/catalog")).json().places[0];
      assert.deepEqual(shared.geometry, moved);
      assert.equal(shared.zoneCode, "A42");
      assert.equal(shared.communityPrice.firstHour, 45.5);
      if (backend === "postgres") {
        const community = new PostgresCommunityStore(
          store as PostgresParkingStore,
        );
        const db = (store as PostgresParkingStore).db as TestPostgresDatabase;
        const info: SignInfo = {
          isParkingSign: true,
          confidence: 0.95,
          zoneCode: "A42",
          operator: null,
          currency: "MKD",
          firstHour: 50,
          nextHour: 50,
          maxStayMinutes: null,
          chargingHours: "08:00-20:00",
          paymentInstructions: null,
          restrictions: null,
          rawText: "A42 50 ден",
        };
        await community.addSignReading(id, first.token, info, "ocr:mlkit-text-v2");
        assert.equal(
          (await app.inject("/v1/catalog")).json().places[0].signInfo.firstHour,
          50,
        );
        const realCatalog = JSON.parse(
          readFileSync("data/catalog.json", "utf8"),
        ) as Catalog;
        await (store as PostgresParkingStore).seed(realCatalog);
        db.count = 0;
        const all = await app.inject("/v1/catalog");
        assert.equal(all.statusCode, 200, all.body);
        assert.ok(
          db.count <= 12, // Includes bulk contributor cosmetics and payment schedule lookups.
          `catalog should use bulk queries, used ${db.count}`,
        );
        assert.ok(all.json().places.length >= realCatalog.places.length);
        const zone = realCatalog.places.find(
          (p) => p.kind === "zone" && p.operator && p.zoneCode,
        )!;
        await (store as PostgresParkingStore).reportPrice(
          zone.id,
          second.token,
          55,
          55,
        );
        assert.equal(
          (await (store as PostgresParkingStore).places()).find(
            (p) => p.id === zone.id,
          )?.communityPrice?.firstHour,
          55,
        );
      }
      // Every physical parking type can have a shared footprint without becoming a tariff zone.
      for (const kind of ["surface", "street", "garage", "underground"] as const) {
        const created = await app.inject({ method: "POST", url: "/v1/contributions", headers: winner, payload: {
          requestId: "perimeter-" + kind, name: "Parking " + kind, kind, zoneCode: "", coordinate: points[0], firstHour: 0, nextHour: 0,
        } });
        assert.equal(created.statusCode, 201, created.body);
        const placeId = created.json().id;
        const endpoint = `/v1/places/${placeId}/boundary`;
        const rejected = await app.inject({ method: "PUT", url: endpoint, payload: moved });
        assert.equal(rejected.statusCode, 401);
        for (const [headers, geometry] of [[winner, zoneGeometry(points)], [loser, moved]] as const) {
          const saved = await app.inject({ method: "PUT", url: endpoint, headers, payload: geometry });
          assert.equal(saved.statusCode, 200, saved.body);
          const reader = (await app.inject({ url: "/v1/catalog", headers: headers === winner ? loser : winner })).json();
          const area = reader.places.find((p: { id: string }) => p.id === placeId);
          assert.deepEqual(area.geometry, geometry);
          assert.equal(area.kind, kind);
          assert.equal(area.zoneCode, null);
          assert.deepEqual(area.coordinate, points[0], "moving corners must not move the entrance pin");
          // Re-importing source data must preserve the separately stored community boundary.
          if (backend === "postgres") await (store as PostgresParkingStore).seed({ ...catalog, places: [{ ...area, geometry: undefined }] });
          else (store as ParkingStore).db.prepare("UPDATE places SET data=? WHERE id=?").run(JSON.stringify({ ...area, geometry: undefined }), placeId);
          const persisted = (await app.inject("/v1/catalog")).json().places.find((p: { id: string }) => p.id === placeId);
          assert.deepEqual(persisted.geometry, geometry);
        }
        const invalid = await app.inject({ method: "PUT", url: endpoint, headers: loser, payload: zoneGeometry([points[0], points[0], points[1]]) });
        assert.equal(invalid.statusCode, 400);
      }
      assert.equal(
        (
          await app.inject({
            method: "DELETE",
            url: "/v1/sessions/me",
            headers: winner,
          })
        ).statusCode,
        200,
      );
      assert.equal(
        (await app.inject({ url: "/v1/profile", headers: winner })).statusCode,
        401,
      );
      assert.equal(
        (
          await app.inject("/v1/usernames/availability?username=DEMOUSER")
        ).json().available,
        true,
      );
      assert.ok(
        (await app.inject("/v1/catalog"))
          .json()
          .places.some((p: { id: string }) => p.id === id),
        "public zone survives account deletion",
      );
    } finally {
      await app.close();
    }
  });
}
