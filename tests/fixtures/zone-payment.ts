import type { Fix } from "../../src/domain/arrival";
import type { ParkingPlace, VerifiedSmsPayment } from "../../src/domain/types";
import { officialSmsPayment } from "../../src/domain/skopje-rules";
// Monday 12:00 in Skopje: Gradski Parking's Aerodrom zones (D1-D9) charge 07:00-23:00.
export const paymentNow = Date.parse("2026-10-05T10:00:00Z");
// The only SMS rules the app uses are the operators' published ones (start-stop, 144144, "D8 PLATE", stop "S").
export const verified: VerifiedSmsPayment = officialSmsPayment({ id: "gradski:zone:D8", kind: "zone" })!;
// A Gradski street zone drawn by a contributor, so GPS can tell when a driver parks inside it.
export const paymentZone: ParkingPlace = { id: "gradski:zone:D8", name: "Zone D8", kind: "zone", coordinate: { latitude: 42, longitude: 21 }, geometry: { type: "Polygon", coordinates: [[[20.999, 41.999], [21.001, 41.999], [21.001, 42.001], [20.999, 42.001], [20.999, 41.999]]] }, zoneCode: "D8", operator: "gradski", access: "public", tariff: null, capacity: null, openingHours: null, verification: "official", source: { label: "Gradski Parking", url: "", retrievedAt: "" }, smsPayment: verified };
export const paymentFix = (offset = 0): Fix => ({ latitude: 42, longitude: 21, accuracy: 5, speed: 0, timestamp: paymentNow + offset });
