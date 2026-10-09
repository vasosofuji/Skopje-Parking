import test from "node:test";
import assert from "node:assert/strict";
import { arrivalParkingAtFix, containsParkingFix, distanceToParkingBoundary, parkingBoundaryBleedMeters } from "../src/domain/arrival";
import type { ParkingPlace } from "../src/domain/types";
const lot = { id: "community:lot", kind: "zone", verification: "community", access: "public", coordinate: { latitude: 42.0005, longitude: 21.4005 }, geometry: { type: "Polygon", coordinates: [[[21.4,42],[21.401,42],[21.401,42.001],[21.4,42.001],[21.4,42]]] } } as ParkingPlace;
const outside = { latitude: 41.9999, longitude: 21.4005 };
test("user boundaries have a 20m invisible exterior tolerance, never wider original map geometry", () => {
  assert.ok(distanceToParkingBoundary(outside, lot.geometry!) > 10 && distanceToParkingBoundary(outside, lot.geometry!) < 12);
  assert.equal(parkingBoundaryBleedMeters(lot), 20);
  assert.equal(containsParkingFix(outside, lot), true);
  assert.equal(containsParkingFix({ ...outside, latitude: 41.9997 }, lot), false);
  const imported = { ...lot, id: "osm:lot", verification: "osm" as const };
  assert.equal(containsParkingFix(outside, imported), false);
  assert.equal(containsParkingFix(outside, { ...imported, boundaryEvidence: "community" }), true);
  assert.equal(containsParkingFix(outside, { ...lot, access: "restricted" }), false);
});
test("holes remain excluded and buffered overlaps cannot silently select a wrong parking lot", () => {
  const withHole = { ...lot, geometry: { ...lot.geometry!, coordinates: [...lot.geometry!.coordinates, [[21.40001,42.00001],[21.4002,42.00001],[21.4002,42.0002],[21.40001,42.0002],[21.40001,42.00001]]] } };
  assert.equal(containsParkingFix({ latitude: 42.00002, longitude: 21.40002 }, withHole), false);
  assert.equal(arrivalParkingAtFix(outside, [lot, { ...lot, id: "community:other" }]), null);
  const exact = { ...lot, id: "community:exact", geometry: { type: "Polygon" as const, coordinates: [[[21.4,41.9998],[21.401,41.9998],[21.401,41.99995],[21.4,41.99995],[21.4,41.9998]]] } };
  assert.equal(arrivalParkingAtFix(outside, [lot, exact])?.id, exact.id);
  const sector = { ...lot, id: "poc:zone:1:0", operator: "poc", zoneCode: "POC 1" };
  assert.equal(arrivalParkingAtFix({ latitude: 42.0005, longitude: 21.4005 }, [lot, sector])?.id, lot.id);
});
