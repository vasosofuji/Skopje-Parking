import test from "node:test";
import assert from "node:assert/strict";
import { arrivalQuestion, availabilityReportTime, hasSignDetails } from "../src/domain/report-feedback";
import type { Availability, ParkingPlace, SignInfo } from "../src/domain/types";
import { PRICE_REPORT_TTL_MS } from "../src/domain/parking";

const now = Date.parse("2026-10-03T12:10:30Z");
const place: ParkingPlace = { id: "p", name: "Parking", kind: "surface", coordinate: { latitude: 42, longitude: 21 }, access: "public", verification: "community", zoneCode: null, operator: null, tariff: null, capacity: null, openingHours: null, source: { label: "Driver", url: "", retrievedAt: "" } };
const blank: SignInfo = { isParkingSign: true, confidence: 1, zoneCode: null, operator: null, currency: "MKD", firstHour: null, nextHour: null, maxStayMinutes: null, chargingHours: null, paymentInstructions: null, restrictions: null, rawText: "" };
const report: Availability = { status: "spaces", source: "community", observedAt: new Date(now - 60000).toISOString(), expiresAt: new Date(now + 840000).toISOString(), reports: 1 };

test("arrival asks yes/no availability then only asks missing pricing, including zero tariffs and current reports", () => {
  assert.equal(arrivalQuestion(place, false, now), "availability");
  assert.equal(arrivalQuestion(place, true, now), "price");
  const known: ParkingPlace[] = [
    { ...place, tariff: { firstHour: 25, nextHour: 25, maxStayMinutes: null, evidence: "official", source: place.source } },
    { ...place, tariff: { firstHour: 0, nextHour: 0, maxStayMinutes: null, evidence: "community", source: place.source } },
    { ...place, communityPrice: { firstHour: 0, nextHour: 0, observedAt: new Date(now - 10).toISOString(), reports: 1 } },
    { ...place, signInfo: { ...blank, firstHour: 25, nextHour: 25, confirmedAt: new Date(now - 10).toISOString(), observedAt: new Date(now - 10).toISOString(), readingId: "s", model: "model" } },
  ];
  for (const priced of known) {
    assert.equal(arrivalQuestion(priced, false, now), "availability");
    assert.equal(arrivalQuestion(priced, true, now), null);
    assert.equal(arrivalQuestion({ ...priced, kind: "zone" }, false, now), null, "zones never take availability reports");
    assert.equal(arrivalQuestion({ ...priced, id: "poc:zone:1:0", kind: "zone", operator: "poc", zoneCode: "POC 1" }, false, now), null);
  }
  assert.equal(arrivalQuestion({ ...place, communityPrice: { firstHour: 0, nextHour: 0, observedAt: new Date(now - PRICE_REPORT_TTL_MS).toISOString(), reports: 1 } }, true, now), "price");
  assert.equal(arrivalQuestion({ ...place, kind: "zone" }, false, now), "price");
  assert.equal(arrivalQuestion(null, false, now), null);
});

test("availability shows exact original local clock time and hides expired or missing observations", () => {
  for (const [language, locale] of [["en", "en-GB"], ["mk", "mk-MK"], ["tr", "tr-TR"], ["sq", "sq-AL"]] as const) {
    const expected = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(report.observedAt!));
    assert.equal(availabilityReportTime(report, language, now), expected);
    assert.equal(availabilityReportTime(report, language, now + 20000), expected, "refreshing never resets report time");
  }
  for (const value of [{ ...report, observedAt: null }, { ...report, observedAt: "invalid" }, { ...report, observedAt: new Date(now + 1).toISOString() }, { ...report, expiresAt: new Date(now).toISOString() }, { ...report, expiresAt: "invalid" }, { ...report, status: "unknown" as const }]) assert.equal(availabilityReportTime(value, "en", now), null);
  assert.equal(availabilityReportTime(undefined, "en", now), null);
});

test("thank-you sign feedback requires actual details and accepts zero prices", () => {
  assert.equal(hasSignDetails(blank), false);
  assert.equal(hasSignDetails({ ...blank, rawText: "  " }), false);
  assert.equal(hasSignDetails({ ...blank, firstHour: 0 }), true);
  assert.equal(hasSignDetails({ ...blank, freeWeekends: "neither" }), true);
  assert.equal(hasSignDetails({ ...blank, zoneCode: "D8" }), true);
  assert.equal(hasSignDetails({ ...blank, chargingHours: "Mon-Sat 07:00-23:00" }), true);
  assert.equal(hasSignDetails({ ...blank, isParkingSign: false, rawText: "a shop" }), false);
});
