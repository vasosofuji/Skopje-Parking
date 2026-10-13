import test from "node:test";
import assert from "node:assert/strict";
import { createWidgetWriter, parkingWidgetState, widgetPayPath, WIDGET_CHECK_MS, WIDGET_RESTAMP_MS, type ParkingWidgetState } from "../src/domain/parking-widget";
import { redirectSystemPath } from "../src/app/+native-intent";
import type { ParkingPlace } from "../src/domain/types";
import { paymentFix, paymentNow, paymentZone } from "./fixtures/zone-payment";

const priced: ParkingPlace = { ...paymentZone, name: "Аеродром", nameEn: "Aerodrom", tariff: { firstHour: 40, nextHour: 50, maxStayMinutes: null, evidence: "official", source: paymentZone.source } };
// A second zone 300 m east of the first one's outline.
const east: ParkingPlace = { ...priced, id: "gradski:zone:D9", zoneCode: "D9", coordinate: { latitude: 42, longitude: 21.0047 }, geometry: undefined, smsPayment: { ...priced.smsPayment!, zoneCode: "D9" } };
const state = (fix = paymentFix(), places = [priced, east], language: "en" | "mk" = "en", plate: string | null = "SK1234FF") =>
  parkingWidgetState(fix, places, language, plate, "parkskopje", paymentNow + 1000);

test("the widget shows the zone the phone is in, with name, hourly price and its pay link", () => {
  assert.deepEqual(state(), { zone: "D8", detail: "Aerodrom · 40 MKD/h", url: "parkskopje://pay?place=gradski%3Azone%3AD8", pay: "Pay", open: "Open", empty: "No paid zone nearby" });
  assert.equal(state(paymentFix(), undefined, "mk")?.detail, "Аеродром · 40 MKD/ч");
  assert.equal(state(paymentFix(), undefined, "en", null)?.zone, "D8", "no plate or moving car still finds the zone");
  assert.equal(state({ ...paymentFix(), speed: 12 })?.zone, "D8");
  assert.equal(state(paymentFix(), [{ ...priced, tariff: null }])?.detail, "Aerodrom", "unknown price is left out");
});

test("near a zone the widget offers the nearest within a short walk; farther away it has none", () => {
  const outside = { ...paymentFix(), longitude: 21.0025 }; // ~124 m east of D8's outline
  assert.equal(state(outside)?.zone, "D8");
  const far = { ...paymentFix(), longitude: 21.0035 }; // ~210 m from D8, ~100 m from D9's point
  assert.equal(state(far)?.zone, "D9");
  const empty = state({ ...paymentFix(), latitude: 42.01 })!;
  assert.deepEqual([empty.zone, empty.url, empty.detail, empty.empty, empty.open], [null, null, "", "No paid zone nearby", "Open"]);
  assert.equal(state(paymentFix(), [{ ...priced, smsPayment: undefined }])?.zone, null, "zones without verified SMS payment are not offered");
});

test("weak or stale GPS leaves the widget as it was", () => {
  assert.equal(state({ ...paymentFix(), accuracy: 250 }), null);
  assert.equal(state({ ...paymentFix(), accuracy: null }), null);
  assert.equal(state(paymentFix(-60_000)), null);
});

test("the widget writer throttles checks, writes only changes and re-stamps an unchanged zone", () => {
  const written: (ParkingWidgetState & { at: number })[] = [];
  let computed = 0;
  const write = createWidgetWriter(value => written.push(value));
  const zone = (code: string | null) => () => { computed++; return { zone: code, detail: "", url: null, pay: "Pay", open: "Open", empty: "None" }; };
  assert.equal(write(zone("D8"), 0), true);
  assert.equal(write(zone("D9"), WIDGET_CHECK_MS - 1), false, "a change inside the throttle window waits");
  assert.equal(computed, 1, "throttled fixes are not even computed");
  assert.equal(write(zone("D8"), WIDGET_CHECK_MS), false, "an unchanged zone is not rewritten");
  assert.equal(write(zone("D9"), 2 * WIDGET_CHECK_MS), true);
  assert.equal(write(() => null, 3 * WIDGET_CHECK_MS), false, "no usable fix keeps the last state");
  assert.equal(write(zone("D9"), 2 * WIDGET_CHECK_MS + WIDGET_RESTAMP_MS), true, "an old unchanged state is re-stamped");
  assert.deepEqual(written.map(value => [value.zone, value.at]), [["D8", 0], ["D9", 2 * WIDGET_CHECK_MS], ["D9", 2 * WIDGET_CHECK_MS + WIDGET_RESTAMP_MS]]);
});

test("only the widget's pay link is rewritten onto the map", () => {
  assert.equal(widgetPayPath("parkskopje://pay?place=gradski%3Azone%3AD8"), "/?pay=gradski%3Azone%3AD8");
  assert.equal(widgetPayPath("parkskopje-test:///pay/?utm=x&place=poc%3Azone%3A1%3A0"), "/?pay=poc%3Azone%3A1%3A0");
  assert.equal(widgetPayPath("/pay?place=abc"), "/?pay=abc");
  for (const bad of ["parkskopje://pay", "parkskopje://pay?place=", "parkskopje://pay?place=%E0%A4%A", `parkskopje://pay?place=${"x".repeat(201)}`]) assert.equal(widgetPayPath(bad), "/", bad);
  for (const other of ["parkskopje://settings", "parkskopje://payment?place=x", "https://example.com/pay?place=x/../", "parkskopje:///"]) assert.equal(redirectSystemPath({ path: other, initial: true }), other);
  assert.equal(redirectSystemPath({ path: "parkskopje://pay?place=D8", initial: false }), "/?pay=D8");
});
