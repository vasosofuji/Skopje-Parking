import test from "node:test";
import assert from "node:assert/strict";
import {
  ArrivalDetector,
  insidePolygon,
  type Fix,
} from "../src/domain/arrival";
import { ParkingStore } from "../server/store";
import { buildApp } from "../server/app";
import type { Catalog, ParkingPlace } from "../src/domain/types";
import seed from "../data/catalog.json";
const start = Date.parse("2026-10-01T12:00:00Z");
const point = { latitude: 41.996, longitude: 21.432 };
const place: ParkingPlace = {
  id: "test",
  name: "Test parking",
  coordinate: point,
  kind: "surface",
  operator: null,
  zoneCode: null,
  access: "public",
  tariff: null,
  capacity: null,
  openingHours: null,
  verification: "osm",
  source: {
    label: "Test",
    url: "",
    retrievedAt: new Date(start).toISOString(),
  },
};
const catalog: Catalog = {
  generatedAt: new Date(start).toISOString(),
  places: [place],
  zones: [],
  destinations: [],
  coverage: { complete: false, bounds: [], notes: [] },
};
const fix = (seconds: number, changes: Partial<Fix> = {}): Fix => ({
  ...point,
  accuracy: 8,
  speed: 0,
  timestamp: start + seconds * 1000,
  ...changes,
});
function update(
  detector: ArrivalDetector,
  seconds: number,
  changes: Partial<Fix> = {},
) {
  return detector.update(
    fix(seconds, changes),
    [place],
    start + seconds * 1000,
  );
}
test("arrival needs 10 seconds of fresh stationary fixes and suppresses repeat prompts", () => {
  const d = new ArrivalDetector();
  for (let s = 0; s < 10; s += 5) assert.equal(update(d, s), null);
  assert.equal(update(d, 10)?.id, place.id);
  for (let s = 15; s < 180; s += 5) assert.equal(update(d, s), null);
});
test("leaving, driving, poor accuracy and GPS gaps reset arrival dwell", () => {
  for (const change of [
    { latitude: 42 },
    { speed: 5 },
    { accuracy: 100 },
    { accuracy: null },
  ]) {
    const d = new ArrivalDetector();
    update(d, 0);
    update(d, 5);
    assert.equal(update(d, 10, change), null);
    for (let s = 15; s < 25; s += 5) assert.equal(update(d, s), null);
    assert.equal(update(d, 25)?.id, place.id);
  }
  const d = new ArrivalDetector();
  update(d, 0);
  update(d, 5);
  assert.equal(update(d, 70), null);
  assert.equal(d.update(fix(10), [place], start + 80000), null);
});
test("polygons respect holes, surveyed zones trigger arrival, and approximate labels do not", () => {
  const geometry = {
    type: "Polygon" as const,
    coordinates: [
      [
        [21.43, 41.99],
        [21.44, 41.99],
        [21.44, 42],
        [21.43, 42],
        [21.43, 41.99],
      ],
      [
        [21.431, 41.995],
        [21.433, 41.995],
        [21.433, 41.997],
        [21.431, 41.997],
        [21.431, 41.995],
      ],
    ],
  };
  assert.equal(insidePolygon(point, geometry), false);
  assert.equal(
    insidePolygon({ latitude: 41.994, longitude: 21.432 }, geometry),
    true,
  );
  const d = new ArrivalDetector();
  for (let s = 0; s <= 120; s += 5)
    assert.equal(
      d.update(
        fix(s),
        [{ ...place, kind: "zone", geometry }],
        start + s * 1000,
      ),
      null,
    );
  const zone = {
    ...place,
    kind: "zone" as const,
    geometry: { ...geometry, coordinates: [geometry.coordinates[0]] },
  };
  const zoneDetector = new ArrivalDetector();
  for (let s = 0; s < 10; s += 5)
    assert.equal(zoneDetector.update(fix(s), [zone], start + s * 1000), null);
  assert.equal(
    zoneDetector.update(fix(10), [zone], start + 10000)?.id,
    place.id,
  );
  const approximate = {
    ...place,
    kind: "zone" as const,
    locationPrecision: "area" as const,
  };
  const areaDetector = new ArrivalDetector();
  for (let s = 0; s <= 60; s += 5)
    assert.equal(
      areaDetector.update(fix(s), [approximate], start + s * 1000),
      null,
    );
  const facilityDetector = new ArrivalDetector();
  for (let s = 0; s < 10; s += 5)
    facilityDetector.update(
      fix(s),
      [{ ...zone, id: "zone" }, place],
      start + s * 1000,
    );
  assert.equal(
    facilityDetector.update(
      fix(10),
      [{ ...zone, id: "zone" }, place],
      start + 10000,
    )?.id,
    place.id,
  );
});
test("driver prices and presence reports persist, deduplicate and expire without changing availability or official tariffs", () => {
  let now = start;
  const store = new ParkingStore(":memory:", catalog, () => now);
  try {
    const { token } = store.createSession();
    store.reportPrice(place.id, token, 30, 20);
    store.reportPrice(place.id, token, 40, 30);
    store.confirmLocation(place.id, token, true);
    store.confirmLocation(place.id, token, false);
    let p = store.places()[0];
    assert.equal(p.communityPrice?.firstHour, 40);
    assert.equal(p.communityPrice?.reports, 1);
    assert.deepEqual(p.locationReports, { yes: 0, no: 1 });
    assert.equal(p.availability.status, "unknown");
    assert.equal(p.tariff, null);
    now += 90 * 86400000;
    p = store.places()[0];
    assert.equal(p.communityPrice, undefined);
    assert.deepEqual(p.locationReports, { yes: 0, no: 0 });
    store.deleteSession(token);
    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS n FROM price_reports").get()?.n,
      0,
    );
    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS n FROM location_reports").get()?.n,
      0,
    );
  } finally {
    store.close();
  }
});
test("price and location APIs validate amounts and require sessions", async () => {
  const app = await buildApp(catalog, new ParkingStore(":memory:", catalog));
  try {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/places/test/prices",
          payload: { firstHour: 50, nextHour: 50 },
        })
      ).statusCode,
      401,
    );
    const { token } = (
      await app.inject({ method: "POST", url: "/v1/sessions" })
    ).json();
    const headers = { authorization: `Bearer ${token}` };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/places/test/prices",
          headers,
          payload: { firstHour: -1, nextHour: 30 },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/places/test/prices",
          headers,
          payload: { firstHour: 0, nextHour: 0 },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/places/test/confirmations",
          headers,
          payload: { present: false },
        })
      ).statusCode,
      200,
    );
    const data = (
      await app.inject({ method: "GET", url: "/v1/catalog" })
    ).json();
    assert.equal(data.places[0].communityPrice.firstHour, 0);
    assert.equal(data.places[0].locationReports.no, 1);
  } finally {
    await app.close();
  }
});
test("named zones are searchable with honest approximate anchors and POC sectors remain distinct", () => {
  const data = seed as Catalog;
  for (const code of ["A0", "B2", "D42"]) {
    const p = data.places.find((p) => p.zoneCode === code)!;
    assert.ok(p);
    assert.equal(p.kind, "zone");
    assert.equal(p.locationPrecision, "area");
    // An outline is only ever a labelled approximation, never a surveyed boundary.
    if (p.geometry) assert.deepEqual([p.boundaryEvidence, p.boundarySource?.license], ["derived", "ODbL 1.0"]);
    assert.ok(p.tariff);
  }
  assert.equal(
    data.places.filter((p) => p.operator === "poc" && p.kind === "zone").length,
    13,
  );
  assert.ok(data.destinations.length > 500);
  assert.equal(
    data.zones.some((z) => z.code === "A42"),
    false,
  );
});

test("zone price reports apply across sectors of the same operator and code only", () => {
  const zone = {
    ...place,
    id: "zone:a",
    kind: "zone" as const,
    operator: "poc",
    zoneCode: "POC 1",
  };
  const other = { ...zone, id: "zone:b" };
  const different = { ...zone, id: "zone:c", operator: "gradski" };
  const store = new ParkingStore(":memory:", {
    ...catalog,
    places: [zone, other, different],
  });
  try {
    const { token } = store.createSession();
    store.reportPrice(other.id, token, 70, 70);
    const all = store.places();
    assert.equal(
      all.find((p) => p.id === zone.id)?.communityPrice?.firstHour,
      70,
    );
    assert.equal(
      all.find((p) => p.id === other.id)?.communityPrice?.firstHour,
      70,
    );
    assert.equal(
      all.find((p) => p.id === different.id)?.communityPrice,
      undefined,
    );
  } finally {
    store.close();
  }
});
