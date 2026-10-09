import test from "node:test";
import assert from "node:assert/strict";
import { MARKER_COLORS, parkingMarker, parkingMarkerHtml, parkingReviewEvidence } from "../src/domain/marker-appearance";
import { parkingPreviewLayout } from "../src/domain/preview-layout";
import { PRICE_REPORT_TTL_MS } from "../src/domain/parking";
import type { ParkingPlace, SignInfo } from "../src/domain/types";
import { groupParking } from "../src/domain/clusters";
import { createOverlayTapGate } from "../src/domain/map-interactions";

const now = Date.parse("2026-10-01T12:00:00Z");
const parking: ParkingPlace = { id: "osm:1", name: "Imported parking", coordinate: { latitude: 42, longitude: 21.4 }, kind: "surface", operator: null, zoneCode: null, access: "public", tariff: null, capacity: null, openingHours: null, verification: "osm", source: { label: "OSM", url: "", retrievedAt: new Date(now).toISOString() } };
const price = { firstHour: 0, nextHour: 0, reports: 1, observedAt: new Date(now - 1000).toISOString() };
const available = { status: "spaces" as const, source: "community" as const, observedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 1000).toISOString(), reports: 1 };

test("a label from OSM or an availability report alone cannot erase the needs-review cue", () => {
  for (const place of [parking, { ...parking, zoneCode: "A1" }, { ...parking, zoneCode: "", zoneCodeEvidence: "community" as const }, { ...parking, availability: available }]) {
    const marker = parkingMarker(place, 1, now);
    assert.equal(marker.fill, MARKER_COLORS.needsInfo);
    assert.equal(marker.label, "P");
    assert.match(parkingMarkerHtml(marker), /parking-review-badge/);
    assert.equal(marker.needsInfo, true);
  }
  const spaces = parkingMarker({ ...parking, availability: available }, 1, now);
  assert.equal(spaces.stateBadge, "✓"); assert.equal(spaces.stateColor, MARKER_COLORS.spaces);
  const full = parkingMarker({ ...parking, availability: { ...available, status: "full" } }, 1, now);
  assert.equal(full.fill, MARKER_COLORS.needsInfo); assert.equal(full.stateBadge, "×"); assert.equal(full.stateColor, MARKER_COLORS.full);
});

test("review evidence uses official data, real human edits and positive recent presence counts, without inventing pricing", () => {
  assert.equal(parkingReviewEvidence({ ...parking, verification: "official" }, now), "official");
  assert.equal(parkingReviewEvidence({ ...parking, zoneCode: "A1", zoneCodeEvidence: "community" }, now), "zone");
  assert.equal(parkingReviewEvidence({ ...parking, communityPrice: price }, now), "price");
  assert.equal(parkingReviewEvidence({ ...parking, communityPrice: { ...price, observedAt: new Date(now - PRICE_REPORT_TTL_MS).toISOString() } }, now), null);
  for (const votes of [{ yes: 0, no: 0 }, { yes: 1, no: 1 }, { yes: 1, no: 2 }, { yes: 1.5, no: 0 }])
    assert.equal(parkingReviewEvidence({ ...parking, locationReports: votes }, now), null);
  const confirmedLocation = { ...parking, locationReports: { yes: 1, no: 0 } };
  assert.equal(parkingReviewEvidence(confirmedLocation, now), "presence");
  assert.equal(parkingMarker(confirmedLocation, 1, now).freeOfCharge, false);
  assert.equal(parkingMarker(confirmedLocation, 1, now).fill, MARKER_COLORS.normal);
});

test("free pricing remains separate from free spaces, full reports and cosmetic rings", () => {
  const free = { ...parking, communityPrice: price, contributionAccent: "gold" as const };
  const neutral = parkingMarker(free, 1, now);
  assert.equal(neutral.fill, MARKER_COLORS.free); assert.equal(neutral.badge, "0"); assert.equal(neutral.spaces, false);
  const full = parkingMarker({ ...free, availability: { ...available, status: "full" } }, 1, now);
  assert.equal(full.fill, MARKER_COLORS.full); assert.equal(full.badge, "0"); assert.equal(full.border, neutral.border);
  const spaces = parkingMarker({ ...free, availability: available }, 1, now);
  assert.equal(spaces.fill, MARKER_COLORS.spaces); assert.equal(spaces.label, "P ✓"); assert.equal(spaces.badge, "0");
  assert.equal(parkingMarker({ ...free, availability: { ...available, expiresAt: new Date(now).toISOString() } }, 1, now).fill, MARKER_COLORS.free);
  assert.equal(parkingMarker({ ...free, communityPrice: { ...price, nextHour: 40 } }, 1, now).freeOfCharge, false);
  assert.equal(parkingMarker({ ...free, access: "restricted", availability: available }, 1, now).spaces, false);
  assert.equal(parkingMarker({ ...free, capacity: 0, availability: available }, 1, now).spaces, false);
  assert.equal(parkingMarker({ ...free, kind: "zone", availability: available }, 1, now).spaces, false);
  const cluster = parkingMarker(free, 4, now);
  assert.equal(cluster.label, "4"); assert.equal(cluster.badge, null); assert.notEqual(cluster.border, neutral.border);
  assert.match(parkingMarkerHtml(full), /parking-free-badge/);
  assert.match(parkingMarkerHtml(full), new RegExp(MARKER_COLORS.full));
});

test("a confirmed MKD sign can show free parking; an extraction draft cannot", () => {
  const info: SignInfo = { isParkingSign: true, confidence: 1, zoneCode: null, operator: null, currency: "MKD", firstHour: 0, nextHour: 0, maxStayMinutes: null, chargingHours: null, paymentInstructions: null, restrictions: null, rawText: "Бесплатно" };
  const signInfo = { ...info, readingId: "one", model: "manual", observedAt: new Date(now).toISOString() };
  assert.equal(parkingMarker({ ...parking, signInfo }, 1, now).freeOfCharge, false);
  const marker = parkingMarker({ ...parking, signInfo: { ...signInfo, confirmedAt: new Date(now).toISOString() } }, 1, now);
  assert.equal(marker.freeOfCharge, true); assert.equal(marker.needsInfo, false);
});

test("preview placement stays inside the visible map and does not draw a misleading pointer when clamped", () => {
  for (const width of [320, 390, 700]) for (const point of [{ x: 5, y: 140 }, { x: width - 5, y: 550 }, { x: width / 2, y: 400 }]) {
    const layout = parkingPreviewLayout(point, width, 700, 94, 240);
    assert.equal(layout.visible, true);
    assert.ok(layout.left >= 12 && layout.left + layout.width <= width - 12);
    assert.ok(layout.top >= 12 && layout.top + 240 <= 700 - 94 - 12);
    if (layout.showArrow) assert.ok(Math.abs(layout.top + 240 + 18 - point.y) <= 2);
  }
  assert.equal(parkingPreviewLayout({ x: -1, y: 400 }, 390, 700, 94, 240).visible, false);
  assert.equal(parkingPreviewLayout({ x: 100, y: 200 }, 390, 260, 94, 240).visible, false);
  // Long content hits ScrollView's maximum; include the real outer padding/border.
  const mapHeight = 560, drawer = 94, measuredHeight = mapHeight - drawer - 56 + 24 + 2;
  assert.equal(parkingPreviewLayout({ x: 195, y: 300 }, 390, mapHeight, drawer, measuredHeight).visible, true);
});

test("the same catalog changes marker and cluster appearance when the explicit clock expires a report", () => {
  const places = [{ ...parking, availability: available }, { ...parking, id: "osm:2" }];
  assert.equal(groupParking(places, 1, 1, null, now).length, 2);
  assert.equal(groupParking(places, 1, 1, null, now + 1000).length, 1);
  assert.equal(parkingMarker(places[0], 1, now).stateBadge, "✓");
  assert.equal(parkingMarker(places[0], 1, now + 1000).stateBadge, null);
});

test("polygon presses do not become blank taps on Android or Apple Maps, while later blank/picking taps remain usable", () => {
  let clock = 1000;
  const taps = createOverlayTapGate(() => clock), point = { latitude: 42, longitude: 21 };
  taps.record(point); assert.equal(taps.consume("polygon-press", point), true);
  taps.record(point); assert.equal(taps.consume(undefined, point), true);
  assert.equal(taps.consume(undefined, point), false, "a separate tap is not swallowed");
  taps.record(point); clock += 401; assert.equal(taps.consume(undefined, point), false);
  taps.record(point); assert.equal(taps.consume(undefined, { ...point, latitude: 42.01 }), false);
  assert.equal(taps.consume("marker-press", point), true);
});

test("type marks remain identifiable even when unreviewed, full, free or available", () => {
  for (const [kind, label] of Object.entries({surface: "P", garage: "G", underground: "U", street: "S", zone: "Z"})) {
    const place = { ...parking, kind: kind as ParkingPlace["kind"] };
    assert.equal(parkingMarker(place, 1, now).label, label);
    assert.equal(parkingMarker({ ...place, verification: "official" }, 1, now).label, label);
    assert.equal(parkingMarker({ ...place, verification: "official", availability: { ...available, status: "full" } }, 1, now).label, label);
  }
});
test("named local zones join regular parking clusters from overview zoom", () => {
  const named = { ...parking, id: "poc:parking:C2", kind: "zone" as const, zoneCode: "C2", operator: "poc", verification: "official" as const };
  const tariff = { ...named, id: "poc:zone:1:0", zoneCode: "POC 1" };
  for (const filtered of [false, true]) {
    const groups = groupParking([named, parking, tariff], 1, 1, null, now, filtered);
    assert.equal(groups.flat().length, 2);
    assert.ok(groups.flat().some(place => place.id === named.id));
    assert.equal(groupParking([named, parking], 1, 1, named.id, now, filtered).length, 2);
  }
});
