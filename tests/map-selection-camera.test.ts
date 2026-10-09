import test from "node:test";
import assert from "node:assert/strict";
import { CURRENT_LOCATION_ZOOM, mapCameraDeltas, parkingSelectionDeltas, parkingSelectionZoom } from "../src/domain/map-selection-camera";

test("current-location camera is eight times closer than overview at a fixed native span", () => {
  assert.equal(CURRENT_LOCATION_ZOOM, 18);
  assert.deepEqual(mapCameraDeltas(), { latitudeDelta: 0.022, longitudeDelta: 0.022 });
  assert.deepEqual(mapCameraDeltas(CURRENT_LOCATION_ZOOM), { latitudeDelta: 0.00275, longitudeDelta: 0.00275 });
});
test("POC selection adds a half level from overview and caps repeated selections at street context", () => {
  assert.equal(parkingSelectionZoom(15, true), 15.5);
  assert.equal(parkingSelectionZoom(15.5, true), 16);
  assert.equal(parkingSelectionZoom(16, true), 16);
  assert.equal(parkingSelectionZoom(18, true), 18);
  assert.equal(parkingSelectionZoom(11, true), 11.5);
  assert.equal(parkingSelectionZoom(NaN, true), 15.5);
});
test("POC native spans shrink slightly in both dimensions and preserve closer framing", () => {
  const overview = parkingSelectionDeltas(0.022, 0.03, true);
  assert.ok(Math.abs(overview.latitudeDelta - 0.022 / Math.SQRT2) < 1e-10);
  assert.ok(Math.abs(overview.longitudeDelta / overview.latitudeDelta - 0.03 / 0.022) < 1e-10);
  const second = parkingSelectionDeltas(overview.latitudeDelta, overview.longitudeDelta, true);
  assert.ok(Math.abs(second.latitudeDelta - 0.011) < 1e-10);
  assert.deepEqual(parkingSelectionDeltas(0.004, 0.007, true), { latitudeDelta: 0.004, longitudeDelta: 0.007 });
});
test("actual parking camera behavior retains previous close-up policy", () => {
  assert.equal(parkingSelectionZoom(13, false), 16);
  assert.equal(parkingSelectionZoom(17, false), 17);
  assert.deepEqual(parkingSelectionDeltas(0.022, 0.03, false), { latitudeDelta: 0.011, longitudeDelta: 0.011 });
  assert.deepEqual(parkingSelectionDeltas(0.004, 0.007, false), { latitudeDelta: 0.004, longitudeDelta: 0.007 });
});
