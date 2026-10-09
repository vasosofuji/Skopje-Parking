import test from "node:test";
import assert from "node:assert/strict";
import { POC_PRICES, POC_WEEK_MS, PocVisitDetector, pocCardZone, readPocVisits, recordPocVisit } from "../src/domain/poc-cards";
import type { ParkingPlace } from "../src/domain/types";
const place = { id: "poc:space:test", zoneCode: "POC 1", operator: "poc", kind: "surface", access: "public", coordinate: { latitude: 42, longitude: 21.4 } } as ParkingPlace;
test("POC suggestions use only the supplied ordinary card prices for I and II", () => {
  assert.equal(pocCardZone(place, []), "I");
  assert.equal(pocCardZone({ ...place, zoneCode: "POC 2" }, []), "II");
  for (const code of ["POC 0", "POC O", "POC X", "POC 3"]) assert.equal(pocCardZone({ ...place, zoneCode: code }, []), null);
  for (const key of ["I", "II"] as const) {
    assert.equal(POC_PRICES[key].weekly, 1200); assert.equal(POC_PRICES[key].multiWeekly, 2000); assert.equal(POC_PRICES[key].monthly, 2500);
  }
  for (const row of Object.values(POC_PRICES)) assert.equal(row.yearly, null);
  assert.equal(POC_PRICES.O.weekly, null); assert.equal(POC_PRICES.X.monthly, null);
});
test("POC counts separate visits to the same spot in rolling seven days and prompts once", () => {
  const now = 2e12, day = 86400000;
  let value = recordPocVisit(readPocVisits(null, now), "spot", "I", now);
  assert.equal(value.suggest, false);
  value = recordPocVisit(value.history, "spot", "I", now + 1000);
  assert.equal(value.history.visits.length, 1);
  value = recordPocVisit(value.history, "spot", "I", now + day);
  assert.equal(value.suggest, false);
  value = recordPocVisit(value.history, "other", "I", now + day);
  assert.equal(value.suggest, false);
  value = recordPocVisit(value.history, "spot", "I", now + 2 * day);
  assert.equal(value.suggest, true);
  value = recordPocVisit(value.history, "spot", "I", now + 3 * day);
  assert.equal(value.suggest, false);
  assert.equal(readPocVisits(JSON.stringify(value.history), now + POC_WEEK_MS + 4 * day).visits.length, 0);
  assert.deepEqual(readPocVisits("bad", now), { visits: [], prompted: {} });
});
test("cards do not apply to other operators or private parking within a POC area", () => {
  const sector = { ...place, id: "poc:zone:1:0", kind: "zone", geometry: { type: "Polygon", coordinates: [[[21.3, 41.9], [21.5, 41.9], [21.5, 42.1], [21.3, 42.1], [21.3, 41.9]]] } } as ParkingPlace;
  const street = { ...place, id: "osm:1", operator: null, zoneCode: null };
  assert.equal(pocCardZone(street, [sector]), "I");
  assert.equal(pocCardZone({ ...street, operator: "other" }, [sector]), null);
  assert.equal(pocCardZone({ ...street, access: "customers" }, [sector]), null);
  assert.equal(pocCardZone({ ...place, access: "restricted" }, []), null);
  assert.equal(pocCardZone({ ...place, kind: "garage" }, []), null);
  assert.equal(pocCardZone(street, [sector, { ...sector, zoneCode: "POC 0" }]), null);
});
test("known POC areas record sustained stops once, never drive-throughs or stale fixes", () => {
  const detector = new PocVisitDetector(), now = 2e12;
  const zone = { ...place, kind: "zone", geometry: { type: "Polygon", coordinates: [[[21.3, 41.9], [21.5, 41.9], [21.5, 42.1], [21.3, 42.1], [21.3, 41.9]]] } } as ParkingPlace;
  const fix = (elapsed: number, speed = 0) => ({ ...place.coordinate, accuracy: 5, speed, timestamp: now + elapsed });
  assert.equal(detector.update(fix(0, 10), [zone], now), null);
  for (let at = 0; at < 120000; at += 10000) assert.equal(detector.update(fix(at), [zone], now + at), null);
  assert.equal(detector.update(fix(120000), [zone], now + 120000)?.id, zone.id);
  assert.equal(detector.update(fix(130000), [zone], now + 130000), null);
  assert.equal(detector.update(fix(0), [zone], now + 160000), null);
  assert.equal(detector.update(null, [zone], now + 170000), null);
  const privateParking = { ...place, access: "customers" as const };
  const privateDetector = new PocVisitDetector();
  for (let at = 0; at <= 130000; at += 10000) assert.equal(privateDetector.update(fix(at), [zone, privateParking], now + at), null);
  const overlap = new PocVisitDetector();
  for (let at = 0; at <= 130000; at += 10000) assert.equal(overlap.update(fix(at), [zone, { ...zone, id: "poc:zone:0:0", zoneCode: "POC 0" }], now + at), null);
});
test("visits across a large sector count the same physical spot, not the whole zone", () => {
  const now = 2e12, day = 86400000;
  let value = recordPocVisit(readPocVisits(null, now), "poc:zone:1", "I", now, place.coordinate);
  value = recordPocVisit(value.history, "poc:zone:1", "I", now + day, { latitude: 42.001, longitude: 21.4 });
  value = recordPocVisit(value.history, "poc:zone:1", "I", now + 2 * day, { latitude: 42.002, longitude: 21.4 });
  assert.equal(value.suggest, false);
  value = recordPocVisit(value.history, "poc:zone:1", "I", now + 3 * day, { latitude: 42.00001, longitude: 21.4 });
  assert.equal(value.suggest, false);
  value = recordPocVisit(value.history, "poc:zone:1", "I", now + 4 * day, place.coordinate);
  assert.equal(value.suggest, true);
});
