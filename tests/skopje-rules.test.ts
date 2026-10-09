import test from "node:test";
import assert from "node:assert/strict";
import { isSkopjeHoliday, officialChargingHours, officiallyCharging, officialSmsPayment } from "../src/domain/skopje-rules";
import { isVerifiedSmsPayment } from "../src/domain/sms-payment";
import { eligibleSmsZone, knownFreeTime, payableZones } from "../src/domain/zone-payment";
import { enrichSigns } from "../server/sign-catalog";
import { paymentFix, paymentNow, paymentZone, verified } from "./fixtures/zone-payment";
import type { ParkingPlace } from "../src/domain/types";

const zone = (id: string): Pick<ParkingPlace, "id" | "kind"> => ({ id, kind: "zone" });
const at = (iso: string) => Date.parse(iso);

test("operator registry: Gradski start-stop to 144144 with A/B limits, POC 1–2 hours to 141414, nothing else", () => {
  const a3 = officialSmsPayment(zone("gradski:zone:A3"))!;
  assert.deepEqual([a3.destination, a3.mode, a3.zoneCode, a3.startTemplate, a3.stopTemplate, a3.maxStayMinutes], ["144144", "start-stop", "A3", "{zone} {plate}", "S", 120]);
  assert.equal(officialSmsPayment(zone("gradski:zone:B10"))!.maxStayMinutes, 240);
  for (const code of ["A0", "A01", "C8", "D42"]) assert.equal(officialSmsPayment(zone(`gradski:zone:${code}`))!.maxStayMinutes, null, code);
  const poc = officialSmsPayment(zone("poc:zone:1:3"))!;
  assert.deepEqual([poc.destination, poc.mode, poc.zoneCode, poc.startTemplate, poc.stopTemplate, poc.allowedHours], ["141414", "fixed-hours", "1", "{zone} {plate} {hours}", null, [1, 2]]);
  for (const other of [zone("community:abc"), zone("gradski:zone:E1"), zone("poc:zone:3:0"), { id: "gradski:zone:A3", kind: "street" as const }]) assert.equal(officialSmsPayment(other), null);
  // The registry is accepted without a photo, but only exactly as published and until it is rechecked.
  assert.equal(isVerifiedSmsPayment(a3, paymentNow), true);
  assert.equal(isVerifiedSmsPayment(poc, paymentNow), true);
  for (const tampered of [{ destination: "144145" }, { maxStayMinutes: 240 }, { startTemplate: "{plate} {zone}" }, { zoneCode: "Z9" }, { expiresAt: "2030-01-01T00:00:00.000Z" }, { photoId: "official:other" }])
    assert.equal(isVerifiedSmsPayment({ ...a3, ...tampered }, paymentNow), false, JSON.stringify(tampered));
  assert.equal(isVerifiedSmsPayment(a3, at("2027-10-08T00:00:01Z")), false, "stale rules stop instead of misleading");
});

test("published Skopje timetables: Centar seasons, Aerodrom, Vodno weekends, Sundays and public holidays", () => {
  const centre = zone("gradski:zone:C17"), aerodrom = zone("gradski:zone:D1"), vodno = zone("gradski:zone:A0");
  assert.equal(officiallyCharging(centre, at("2026-10-05T10:00:00Z")), true, "Monday 12:00");
  assert.equal(officiallyCharging(centre, at("2026-10-05T19:30:00Z")), false, "Monday 21:30 in winter");
  assert.equal(officiallyCharging(centre, at("2026-10-10T11:00:00Z")), true, "Saturday 13:00");
  assert.equal(officiallyCharging(centre, at("2026-10-10T12:30:00Z")), false, "Saturday 14:30 in winter");
  assert.equal(officiallyCharging(centre, at("2026-07-11T20:00:00Z")), true, "summer Saturday 22:00");
  assert.equal(officiallyCharging(centre, at("2026-10-11T10:00:00Z")), false, "Sunday");
  assert.equal(isSkopjeHoliday(at("2026-10-12T10:00:00Z")), true, "11 October falls on Sunday and moves to Monday");
  assert.equal(officiallyCharging(centre, at("2026-10-12T10:00:00Z")), false, "public holiday");
  assert.equal(officiallyCharging(aerodrom, at("2026-10-10T20:00:00Z")), true, "Aerodrom Saturday 22:00");
  assert.equal(officiallyCharging(vodno, at("2026-10-11T10:00:00Z")), true, "Vodno Sunday noon");
  assert.equal(officiallyCharging(vodno, at("2026-10-11T15:00:00Z")), false, "Vodno Sunday 17:00");
  assert.equal(officiallyCharging(vodno, at("2026-10-12T10:00:00Z")), true, "Vodno holiday");
  assert.equal(officiallyCharging(vodno, at("2026-10-07T10:00:00Z")), null, "Vodno weekday hours are unpublished");
  assert.equal(officiallyCharging(zone("gradski:zone:D62"), at("2026-10-05T10:00:00Z")), null);
  assert.equal(officiallyCharging(zone("poc:zone:1:0"), at("2026-10-05T10:00:00Z")), null);
  assert.equal(officialChargingHours(centre, at("2026-10-05T10:00:00Z")), "Mon–Fri 07:00–21:00; Sat 07:00–14:00");
  assert.equal(officialChargingHours(centre, at("2026-06-01T10:00:00Z")), "Mon–Sat 07:00–23:00");
  // A confirmed sign with readable hours stays the authority over the published timetable.
  const place = { ...paymentZone, id: "gradski:zone:C17", zoneCode: "C17" };
  assert.equal(knownFreeTime(place, at("2026-10-11T10:00:00Z")), true);
  assert.equal(knownFreeTime(place, at("2026-10-05T10:00:00Z")), false);
  const signed = { ...place, signInfo: { isParkingSign: true, confidence: 1, zoneCode: "C17", operator: null, currency: null, firstHour: 25, nextHour: 25, maxStayMinutes: null, chargingHours: "Daily 00:00–24:00", paymentInstructions: null, restrictions: null, rawText: "", readingId: "p", model: "manual", observedAt: "", confirmedAt: "2026-10-01T00:00:00Z" } };
  assert.equal(knownFreeTime(signed, at("2026-10-11T10:00:00Z")), false);
});

test("official POC prompts stay quiet near Gradski street zones and outside the citywide paying window", () => {
  const sector: ParkingPlace = { ...paymentZone, id: "poc:zone:1:9", zoneCode: "POC 1", operator: "poc", verification: "official", smsPayment: officialSmsPayment(zone("poc:zone:1:9"))! };
  assert.equal(eligibleSmsZone(paymentFix(), [sector], "SK1234FF", paymentNow)?.id, sector.id);
  const street = (meters: number): ParkingPlace => ({ ...paymentZone, id: "gradski:zone:C17", zoneCode: "C17", operator: "gradski", geometry: undefined, locationPrecision: "area", coordinate: { latitude: 42 + meters / 111195, longitude: 21 }, smsPayment: officialSmsPayment(zone("gradski:zone:C17"))! });
  assert.equal(eligibleSmsZone(paymentFix(), [sector, street(120)], "SK1234FF", paymentNow), null, "the driver may be on the Gradski street");
  assert.equal(eligibleSmsZone(paymentFix(), [sector, street(450)], "SK1234FF", paymentNow)?.id, sector.id);
  const sunday = at("2026-10-11T10:00:00Z"), night = at("2026-10-05T22:30:00Z");
  assert.equal(eligibleSmsZone({ ...paymentFix(), timestamp: sunday }, [sector], "SK1234FF", sunday), null);
  assert.equal(eligibleSmsZone({ ...paymentFix(), timestamp: night }, [sector], "SK1234FF", night), null);
  // The manual chooser lists every payable zone nearby, nearest first, inside zones at 0 m.
  const rows = payableZones([street(120), sector, { ...street(5000), id: "gradski:zone:D1", zoneCode: "D1", smsPayment: officialSmsPayment(zone("gradski:zone:D1"))! }], paymentFix(), paymentNow);
  assert.deepEqual(rows.map(row => [row.place.id, row.distance, row.inside]), [["poc:zone:1:9", 0, true], ["gradski:zone:C17", 120, false]]);
});

test("catalog enrichment publishes official protocols only, and not for a relabelled zone", () => {
  const base: ParkingPlace = { ...paymentZone, id: "gradski:zone:B2", zoneCode: "B2", operator: "gradski", smsPayment: undefined };
  assert.equal(enrichSigns([base], [], [], [])[0].smsPayment?.photoId, "official:gradski");
  assert.equal(enrichSigns([base], [], [{ place_id: base.id, code: "B3" }], [])[0].smsPayment, undefined, "a relabelled zone needs a person");
  // A confirmed sign reading shows its details but can never set SMS rules.
  const reading = { id: "r1", place_id: base.id, created: paymentNow, model: "ocr:mlkit-text-v2",
    info: JSON.stringify({ isParkingSign: true, confidence: 0.8, zoneCode: "B2", operator: "Gradski", currency: "MKD", firstHour: 30, nextHour: 30, maxStayMinutes: 240, chargingHours: "Mon–Fri 07:00–21:00", paymentInstructions: "SMS B2 to 141515", restrictions: null, rawText: "" }) };
  const signed = enrichSigns([base], [], [], [reading])[0];
  assert.equal(signed.signInfo?.readingId, "r1"); assert.equal(signed.smsPayment?.destination, "144144");
  const community: ParkingPlace = { ...paymentZone, id: "community:x", smsPayment: undefined };
  assert.equal(enrichSigns([community], [], [], [{ ...reading, place_id: "community:x" }])[0].smsPayment, undefined);
});
