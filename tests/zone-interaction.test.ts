import test from "node:test";
import assert from "node:assert/strict";
import { canInteractWithZone, isPocSector, nativeRegionZoom } from "../src/domain/zone-interaction";
import type { ParkingPlace } from "../src/domain/types";
const sector: Pick<ParkingPlace, "id" | "kind" | "operator" | "zoneCode"> = { id: "poc:zone:1:0", kind: "zone", operator: "poc", zoneCode: "POC 1" };
test("tiny POC tariff sectors remain tappable at all zooms alongside parking and picking", () => {
  assert.equal(isPocSector(sector), true);
  assert.equal(canInteractWithZone(sector, 15.5), true);
  assert.equal(canInteractWithZone(sector, 16), true);
  assert.equal(canInteractWithZone(sector, 19), true);
  assert.equal(canInteractWithZone(sector, 19, true), true);
  assert.equal(canInteractWithZone({ ...sector, kind: "surface" }, 19), true);
  assert.equal(canInteractWithZone({ ...sector, id: "gradski:zone:D8", operator: "gradski", zoneCode: "D8" }, 19), true);
  assert.equal(isPocSector({ ...sector, id: "custom", operator: "POC" }), true);
  assert.equal(nativeRegionZoom(0.022), 15);
  assert.equal(nativeRegionZoom(0.011), 16);
});

test("named local POC parking zones use ordinary pins instead of tariff overlays", () => {
  for (const zoneCode of ["C2", "B32"]) assert.equal(isPocSector({ ...sector, id: "poc:parking:" + zoneCode, zoneCode }), false);
});
