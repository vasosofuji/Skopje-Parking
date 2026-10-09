import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ParkingStore } from "../server/store";
import { CommunityStore } from "../server/community";
import { buildApp } from "../server/app";
import { parkingPrice } from "../src/domain/parking";
import { validZone, zoneGeometry } from "../src/domain/geometry";
import type { Catalog, Contribution, SignInfo } from "../src/domain/types";
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
  { latitude: 41.996, longitude: 21.433 },
];
const contribution: Contribution = {
  requestId: "test-request-123",
  name: "Test parking zone",
  coordinate: points[0],
  geometry: zoneGeometry(points),
  kind: "zone",
  zoneCode: "Б2",
  firstHour: 0,
  nextHour: 0,
};
const photo = {
  mimeType: "image/png" as const,
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGqkAAAAASUVORK5CYII=",
};
const info: SignInfo = {
  isParkingSign: true,
  confidence: 0.96,
  zoneCode: "B2",
  operator: "Gradski",
  currency: "MKD",
  firstHour: 40,
  nextHour: 40,
  maxStayMinutes: null,
  chargingHours: "Mon-Sat 07:00-23:00",
  paymentInstructions: "SMS 144144",
  restrictions: null,
  rawText: "B2 40 ден/час",
};
test("drawn zones, free prices, labels and confirmed sign details survive database restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "parking-db-")),
    file = join(directory, "parking.sqlite");
  let store = new ParkingStore(file, catalog),
    app = await buildApp(catalog, store);
  try {
    const session = await app.inject({ method: "POST", url: "/v1/sessions" });
    assert.equal(session.statusCode, 201, session.body);
    const token = session.json().token,
      headers = { authorization: `Bearer ${token}` };
    const response = await app.inject({
      method: "POST",
      url: "/v1/contributions",
      headers,
      payload: contribution,
    });
    assert.equal(response.statusCode, 201, response.body);
    const id = response.json().id;
    const moved = zoneGeometry(points.map((p, i) => i === 1 ? { ...p, latitude: p.latitude + 0.0002 } : p));
    const secondUser = (await app.inject({ method: "POST", url: "/v1/sessions" })).json().token;
    const boundaryResponse = await app.inject({
      method: "PUT", url: `/v1/places/${id}/boundary`,
      headers: { authorization: `Bearer ${secondUser}` }, payload: moved,
    });
    assert.equal(boundaryResponse.statusCode, 200, boundaryResponse.body);
    assert.deepEqual((await app.inject("/v1/catalog")).json().places[0].geometry, moved);
    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/contributions",
      headers,
      payload: contribution,
    });
    assert.equal(duplicate.json().id, id);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/v1/places/${id}/labels`,
          headers,
          payload: { zoneCode: "D42" },
        })
      ).statusCode,
      200,
    );
    const sign = await app.inject({ method: "POST", url: `/v1/places/${id}/signs`, headers, payload: { info, model: "ocr:mlkit-text-v2" } });
    assert.equal(sign.statusCode, 201, sign.body);
    await app.close();
    store = new ParkingStore(file, catalog);
    app = await buildApp(catalog, store);
    const saved = (await app.inject("/v1/catalog")).json().places[0];
    assert.equal(saved.zoneCode, "D42");
    assert.equal(saved.communityPrice.firstHour, 0);
    assert.equal(saved.signReadingCount, 1);
    assert.deepEqual(saved.geometry, moved, "another user's boundary edit survives restart and is public");
    assert.equal(saved.signInfo?.chargingHours, info.chargingHours, "confirmed details are the public sign at once");
    assert.equal(parkingPrice(saved)?.firstHour, 0, "human price takes precedence");
    assert.equal((await app.inject(`/v1/signs/${sign.json().id}/image`)).statusCode, 404, "no photo is stored or served");
    await app.inject({ method: "DELETE", url: "/v1/sessions/me", headers });
    const after = (await new CommunityStore(store).enrich(store.places()))[0];
    assert.equal(after.signInfo, undefined, "deleting the account deletes its sign details");
    assert.equal(after.zoneCode, "B2");
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("contributions reject bad geometry, unauthenticated writes and any uploaded photo", async () => {
  const store = new ParkingStore(":memory:", catalog),
    app = await buildApp(catalog, store),
    token = store.createSession().token,
    headers = { authorization: `Bearer ${token}` };
  try {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/contributions",
          payload: contribution,
        })
      ).statusCode,
      401,
    );
    const crossing = zoneGeometry([points[0], points[2], points[1], points[3]]);
    assert.equal(validZone(crossing), false);
    for (const geometry of [
      crossing,
      {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
    ])
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/v1/contributions",
            headers,
            payload: { ...contribution, geometry },
          })
        ).statusCode,
        400,
      );
    const id = (
      await app.inject({
        method: "POST",
        url: "/v1/contributions",
        headers,
        payload: contribution,
      })
    ).json().id;
    assert.equal((await app.inject({ method: "PUT", url: `/v1/places/${id}/boundary`, payload: contribution.geometry })).statusCode, 401);
    assert.equal((await app.inject({ method: "PUT", url: `/v1/places/${id}/boundary`, headers, payload: crossing })).statusCode, 400);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/v1/places/${id}/signs`,
          headers,
          payload: { info, base64: photo.base64 },
        })
      ).statusCode,
      400,
      "sign photos are never uploaded",
    );
    assert.equal((await app.inject({ method: "POST", url: `/v1/places/${id}/signs`, payload: { info } })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: `/v1/places/${id}/signs`, headers, payload: { info: { ...info, rawText: "x".repeat(70000) } } })).statusCode, 413);
  } finally {
    await app.close();
  }
});
test("demo trusts a new contributor immediately; the latest human reports become public", async () => {
  let now = Date.now();
  const store = new ParkingStore(":memory:", catalog, () => now, true);
  const app = await buildApp(catalog, store);
  try {
    const one = store.createSession().token, two = store.createSession().token;
    const proposal = store.propose({ name: "Demo parking", coordinate: points[0], kind: "surface", zoneCode: "B2", note: "" }, one);
    assert.equal(proposal.status, "published");
    assert.equal(proposal.requiredVotes, 1);
    const id = "community:" + proposal.id;
    store.report(id, one, "full"); now++;
    assert.equal(store.report(id, two, "spaces").status, "spaces");
    store.reportPrice(id, one, 60, 60); now++;
    store.reportPrice(id, two, 0, 0);
    assert.equal((await app.inject("/v1/catalog")).json().places[0].communityPrice.firstHour, 0);
    assert.equal((await app.inject("/v1/catalog")).json().trustInputs, true);
    store.confirmLocation(id, two, false);
    assert.equal((await app.inject("/v1/catalog")).json().places.length, 0);
    now++; store.confirmLocation(id, one, true);
    assert.equal((await app.inject("/v1/catalog")).json().places.length, 1);
  } finally { await app.close(); }
});
test("parking perimeters support detailed outlines while rejecting excessive vertices", () => {
  const outline = (count: number) => zoneGeometry(Array.from({ length: count }, (_, i) => ({
    latitude: 41.996 + 0.001 * Math.sin(i * Math.PI * 2 / count),
    longitude: 21.432 + 0.001 * Math.cos(i * Math.PI * 2 / count),
  })));
  assert.equal(validZone(outline(119)), true);
  assert.equal(validZone(outline(256)), true);
  assert.equal(validZone(outline(257)), false);
});

