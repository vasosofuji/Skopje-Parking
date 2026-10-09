import { groupParking } from "../src/domain/clusters";
import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateCost,
  currentAvailability,
  distanceMeters,
  rankParking,
  normalizeZoneCode,
  searchText,
  REPORT_TTL_MS,
  PRICE_REPORT_TTL_MS,
  parkingPrice,
  SESSION_MATURITY_MS,
} from "../src/domain/parking";
import type { Catalog, ParkingPlace, Tariff } from "../src/domain/types";
import { ParkingStore } from "../server/store";
import { buildApp } from "../server/app";
import seed from "../data/catalog.json";
const source = {
  label: "Test operator",
  url: "https://example.com",
  retrievedAt: "2026-09-30T12:00:00Z",
};
const tariff: Tariff = {
  firstHour: 75,
  nextHour: 50,
  maxStayMinutes: null,
  evidence: "official",
  source,
};
const point = { latitude: 41.996, longitude: 21.432 };
const place: ParkingPlace = {
  id: "test",
  name: "Test parking",
  coordinate: point,
  kind: "garage",
  operator: "gradski",
  zoneCode: null,
  access: "public",
  tariff,
  capacity: 50,
  openingHours: null,
  verification: "official",
  source,
};
const catalog: Catalog = {
  generatedAt: source.retrievedAt,
  places: [place],
  zones: [],
  destinations: [],
  coverage: { complete: false, bounds: [41.91, 21.3, 42.08, 21.58], notes: [] },
};
function fixture() {
  let now = Date.parse(source.retrievedAt);
  const store = new ParkingStore(":memory:", catalog, () => now);
  return {
    store,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}
test("price estimates round started hours and respect time limits", () => {
  assert.equal(estimateCost(tariff, 30), 75);
  assert.equal(estimateCost(tariff, 60), 75);
  assert.equal(estimateCost(tariff, 61), 125);
  assert.equal(estimateCost({ ...tariff, maxStayMinutes: 120 }, 121), null);
  assert.equal(estimateCost(null, 60), null);
  assert.equal(estimateCost(tariff, 0), null);
  assert.equal(estimateCost(tariff, NaN), null);
});
test("cheapest comparison keeps unknown estimates last and excludes restricted access and sector centres", () => {
  const rows = rankParking(
    [
      place,
      { ...place, id: "unknown", tariff: null },
      { ...place, id: "restricted", access: "restricted" },
      { ...place, id: "sector", kind: "zone" },
      {
        ...place,
        id: "unverified",
        tariff: { ...tariff, evidence: "community" },
      },
    ],
    point,
    120,
    1000,
    "cheapest",
  );
  assert.deepEqual(
    rows.map((r) => r.place.id),
    ["test", "unknown", "unverified"],
  );
  assert.equal(rows[0].cost, 125);
});
test("distance and zone-code normalization are consistent", () => {
  assert.equal(distanceMeters(point, point), 0);
  assert.ok(
    distanceMeters(point, { ...point, latitude: point.latitude + 0.001 }) > 110,
  );
  assert.equal(normalizeZoneCode("  С 9 "), "C9");
  assert.equal(normalizeZoneCode("в2"), "B2");
});
test("a report expires on the server and cached client at the TTL boundary", () => {
  const { store, advance, now } = fixture();
  const session = store.createSession();
  const availability = store.report("test", session.token, "spaces");
  assert.equal(availability.status, "spaces");
  advance(REPORT_TTL_MS);
  assert.equal(store.availability("test").status, "unknown");
  assert.equal(currentAvailability(availability, now()).status, "unknown");
  store.close();
});
test("one session overwrites its report and conflicting contributors remain visible", () => {
  const { store } = fixture();
  const a = store.createSession(),
    b = store.createSession();
  store.report("test", a.token, "spaces");
  store.report("test", a.token, "spaces");
  assert.equal(store.availability("test").reports, 1);
  store.report("test", b.token, "full");
  assert.equal(store.availability("test").status, "mixed");
  store.report("test", a.token, "full");
  assert.equal(store.availability("test").status, "full");
  store.close();
});
test("duplicate votes do not publish; three mature sessions publish once with unknown price", () => {
  const { store, advance } = fixture();
  const a = store.createSession(),
    b = store.createSession(),
    c = store.createSession();
  const proposal = store.propose(
    {
      name: "New parking",
      coordinate: { latitude: 42.04, longitude: 21.49 },
      kind: "surface",
      zoneCode: "C9",
      note: "Parking sign at the entrance",
    },
    a.token,
  );
  store.vote(proposal.id, a.token);
  assert.equal(store.proposal(proposal.id).votes, 1);
  store.vote(proposal.id, b.token);
  store.vote(proposal.id, c.token);
  assert.equal(store.proposal(proposal.id).status, "pending");
  advance(SESSION_MATURITY_MS);
  assert.equal(store.vote(proposal.id, c.token).status, "published");
  const added = store.place("community:" + proposal.id);
  assert.equal(added.tariff, null);
  assert.equal(added.access, "unknown");
  store.vote(proposal.id, c.token);
  assert.equal(store.places().length, 2);
  store.close();
});
test("nearby submissions merge into an existing proposal", () => {
  const { store } = fixture();
  const a = store.createSession(),
    b = store.createSession();
  const input = {
    name: "New parking",
    coordinate: { latitude: 42.04, longitude: 21.49 },
    kind: "surface" as const,
    zoneCode: null,
    note: "Sign at entrance",
  };
  const p = store.propose(input, a.token),
    q = store.propose(
      { ...input, coordinate: { ...input.coordinate, latitude: 42.04001 } },
      b.token,
    );
  assert.equal(p.id, q.id);
  assert.equal(q.votes, 2);
  store.close();
});
test("operator feed validates ownership, freshness, capacity and out-of-order events", () => {
  const { store, advance, now } = fixture();
  const observation = {
    placeId: "test",
    freeSpaces: 7,
    observedAt: new Date(now()).toISOString(),
  };
  assert.throws(() => store.observe("poc", [observation]), /another operator/);
  assert.throws(
    () => store.observe("gradski", [{ ...observation, freeSpaces: 51 }]),
    /capacity/,
  );
  store.observe("gradski", [observation]);
  advance(1000);
  store.observe("gradski", [
    {
      ...observation,
      freeSpaces: 0,
      observedAt: new Date(now()).toISOString(),
    },
  ]);
  store.observe("gradski", [observation]);
  assert.equal(store.availability("test").status, "full");
  advance(5 * 60 * 1000);
  assert.equal(store.availability("test").status, "unknown");
  assert.throws(() => store.observe("gradski", [observation]), /fresh/);
  store.close();
});
test("session deletion removes reports and votes and invalidates credentials", () => {
  const { store } = fixture();
  const session = store.createSession();
  store.report("test", session.token, "spaces");
  store.deleteSession(session.token);
  assert.equal(store.availability("test").status, "unknown");
  assert.throws(
    () => store.report("test", session.token, "full"),
    /valid session/,
  );
  store.close();
});
test("HTTP routes reject invalid coordinates, missing identity and operator credentials", async () => {
  const { store } = fixture();
  const app = await buildApp(catalog, store, {
    feedKeys: { gradski: "test-key" },
  });
  const session = await app.inject({ method: "POST", url: "/v1/sessions" });
  assert.equal(session.statusCode, 201);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/places/test/reports",
        payload: { status: "spaces" },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/proposals",
        headers: { authorization: "Bearer " + session.json().token },
        payload: {
          name: "Out of city",
          coordinate: { latitude: 50, longitude: 21 },
          kind: "surface",
          zoneCode: null,
          note: "A parking place",
        },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/operators/gradski/observations",
        payload: { observations: [] },
      })
    ).statusCode,
    401,
  );
  const report = await app.inject({
    method: "POST",
    url: "/v1/places/test/reports",
    headers: { authorization: "Bearer " + session.json().token },
    payload: { status: "spaces" },
  });
  assert.equal(report.statusCode, 200);
  assert.equal(report.json().status, "spaces");
  await app.close();
});
test("real imported catalog has valid coordinates and closed polygon rings", () => {
  const actual = seed as Catalog;
  assert.equal(actual.coverage.complete, false);
  assert.ok(actual.places.length > 800);
  assert.equal(actual.zones.length, 36);
  assert.equal(
    new Set(actual.places.map((p) => p.id)).size,
    actual.places.length,
  );
  for (const p of actual.places) {
    assert.ok(
      Number.isFinite(p.coordinate.latitude) &&
        Number.isFinite(p.coordinate.longitude),
    );
    if (p.geometry)
      for (const ring of p.geometry.coordinates) {
        assert.ok(ring.length >= 4);
        assert.deepEqual(ring[0], ring[ring.length - 1]);
      }
  }
});

test("clustering preserves all facilities and keeps a selected pin separate", () => {
  const second = { ...place, id: "second" };
  const groups = groupParking([place, second], 0.01, 0.01, place.id);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups
      .flat()
      .map((p) => p.id)
      .sort(),
    ["second", "test"],
  );
});

test("API refresh publishes pending confirmations once sessions mature", async () => {
  const { store, advance } = fixture();
  const sessions = [
    store.createSession(),
    store.createSession(),
    store.createSession(),
  ];
  const proposal = store.propose(
    {
      name: "Future parking",
      coordinate: { latitude: 42.04, longitude: 21.49 },
      kind: "surface",
      zoneCode: null,
      note: "Signed parking at entrance",
    },
    sessions[0].token,
  );
  store.vote(proposal.id, sessions[1].token);
  store.vote(proposal.id, sessions[2].token);
  advance(SESSION_MATURITY_MS);
  const app = await buildApp(catalog, store);
  const response = await app.inject({ method: "GET", url: "/v1/catalog" });
  assert.equal(response.statusCode, 200);
  assert.ok(
    response
      .json()
      .places.some((p: ParkingPlace) => p.id === "community:" + proposal.id),
  );
  assert.equal(store.proposal(proposal.id).status, "published");
  store.moderate(proposal.id);
  assert.equal(store.proposal(proposal.id).status, "rejected");
  assert.equal(store.places().length, 1);
  await app.close();
});

test("fresh available spaces stay visible outside clusters and expire back into clustering", () => {
  const now = Date.now(),
    available: ParkingPlace = {
      ...place,
      id: "available",
      availability: {
        status: "spaces",
        source: "community",
        reports: 1,
        observedAt: new Date(now - 1000).toISOString(),
        expiresAt: new Date(now + 60000).toISOString(),
      },
    };
  assert.equal(groupParking([place, available], 0.01, 0.01, null).length, 2);
  available.availability!.expiresAt = new Date(now - 1).toISOString();
  assert.equal(groupParking([place, available], 0.01, 0.01, null).length, 1);
});

test("cheapest uses fresh driver prices including free parking, with unknowns last", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  const report = { firstHour: 0, nextHour: 20, reports: 1, observedAt: new Date(now).toISOString() };
  const reported = { ...place, id: "reported", communityPrice: report };
  const rows = rankParking([
    { ...place, id: "unknown", tariff: null }, place, reported,
    { ...place, id: "customers", access: "customers" },
    { ...place, id: "unknown-access", access: "unknown" },
    { ...place, id: "far", coordinate: { ...point, latitude: point.latitude + 1 } },
  ], point, 120, 1000, "cheapest", now);
  assert.deepEqual(rows.map(r => [r.place.id, r.cost, r.costEvidence]), [
    ["reported", 20, "community"], ["test", 125, "official"], ["unknown", null, null],
  ]);
  assert.equal(rankParking([reported], point, 60, 1000, "cheapest", now)[0].cost, 0);
  assert.equal(parkingPrice(reported, now)?.firstHour, 0);
  assert.equal(rankParking([{ ...reported, tariff: { ...tariff, maxStayMinutes: 60 } }], point, 120, 1000, "cheapest", now)[0].cost, null);
});

test("a confirmed sign price ranks like other evidence; an unconfirmed reading does not", () => {
  const sign = { isParkingSign: true, confidence: 0.9, zoneCode: "A1", operator: null, currency: "MKD", firstHour: 60, nextHour: 40, maxStayMinutes: null, chargingHours: null, paymentInstructions: null, restrictions: null, rawText: "A1 60" };
  const confirmed = { ...place, tariff: null, signInfo: { ...sign, confirmedAt: "2026-10-01T10:00:00Z" } } as ParkingPlace;
  assert.deepEqual(rankParking([confirmed], point, 120, 1000, "cheapest").map(r => [r.cost, r.costEvidence]), [[100, "sign"]]);
  assert.equal(rankParking([{ ...confirmed, signInfo: { ...sign } } as ParkingPlace], point, 120, 1000, "cheapest")[0].cost, null);
});

test("invalid or expired cached reports fall back to published rates", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  const report = { firstHour: 0, nextHour: 0, reports: 1, observedAt: new Date(now).toISOString() };
  for (const invalid of [
    { observedAt: new Date(now - PRICE_REPORT_TTL_MS).toISOString() },
    { observedAt: new Date(now + 1).toISOString() }, { observedAt: "invalid" },
    { reports: 0 }, { reports: 1.5 }, { firstHour: -1 }, { nextHour: Infinity },
    { firstHour: NaN }, { nextHour: 10001 },
  ]) {
    const p = { ...place, communityPrice: { ...report, ...invalid } };
    assert.equal(parkingPrice(p, now)?.evidence, "official");
    assert.equal(rankParking([p], point, 60, 1000, "cheapest", now)[0].cost, 75);
    assert.equal(rankParking([{ ...p, tariff: null }], point, 60, 1000, "cheapest", now)[0].cost, null);
  }
  const p = { ...place, communityPrice: { ...report, observedAt: new Date(now - PRICE_REPORT_TTL_MS + 1).toISOString() } };
  assert.equal(rankParking([p], point, 60, 1000, "cheapest", now)[0].cost, 0);
});

test("unknown and equal-price ordering is stable by straight-line distance then id", () => {
  const near = { ...place, id: "a", tariff: null };
  const far = { ...near, id: "far", coordinate: { ...point, latitude: point.latitude + 0.001 } };
  const tie = { ...near, id: "b" };
  const input = [far, tie, near];
  const rows = rankParking(input, point, 60, 1000, "cheapest");
  assert.deepEqual(rows.map(r => r.place.id), ["a", "b", "far"]);
  assert.deepEqual(input.map(p => p.id), ["far", "b", "a"]);
  assert.ok(rows[2].distance > 110 && rows[2].distance < 112);
  assert.deepEqual(rankParking([far, { ...near, tariff }], point, 60, 1000, "nearest").map(r => r.place.id), ["a", "far"]);
  assert.deepEqual(rankParking(input.map(p => ({ ...p, tariff })), point, 60, 1000, "cheapest").map(r => r.place.id), ["a", "b", "far"]);
});

test("search matches Macedonian names across Cyrillic, Latin, diacritics and digraphs", () => {
  const finds = (name: string, query: string) => searchText(name).includes(searchText(query));
  assert.ok(finds("Плоштад Македонија / Macedonia Square", "plostad"));
  assert.ok(finds("Плоштад Македонија", "ploshtad makedonija"));
  assert.ok(finds("СЕКТОР ДЕБАР МААЛО", "Debar Maalo"));
  assert.ok(finds("Ѓорче Петров", "gjorce"));
  assert.ok(finds("Чаир", "Çair"));
  assert.ok(finds("Џон Кенеди", "dzon kenedi"));
  assert.ok(!finds("Чаир", "centar"));
});
