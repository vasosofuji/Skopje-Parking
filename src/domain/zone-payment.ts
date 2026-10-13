import { containsParkingFix, distanceToParkingBoundary, insidePolygon, parkingBoundaryBleedMeters, type Fix } from "./arrival";
import { distanceMeters, parkingPrice } from "./parking";
import { usableFix } from "./location";
import { isOfficialProtocol, isVerifiedSmsPayment, smsRuleKey, smsZoneMatches } from "./sms-payment";
import { isSkopjeHoliday, officiallyCharging, officialZoneRules, skopjeTime } from "./skopje-rules";
import { parsePayingHours } from "./payment-hours";
import type { Coordinate, ParkingPlace } from "./types";
import { isCompactLicensePlate } from "./license-plate";
import { isPocSector } from "./zone-interaction";

export const PAYMENT_DWELL_MS = 15_000;
export const PAYMENT_COOLDOWN_MS = 60 * 60 * 1000;
const polygonUsable = (place: ParkingPlace) => Boolean(place.geometry?.coordinates.length && place.geometry.coordinates.every(ring => ring.length >= 4 && ring.every(point => point.length === 2 && point.every(Number.isFinite)) && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1]));
const paymentRule = (place: ParkingPlace) => place.smsPayment ? smsRuleKey(place.smsPayment) : null;
/** A Gradski street zone is only a point, so it may run through a POC sector unseen. */
export const GRADSKI_STREET_RADIUS_M = 300;
export function knownFreeTime(place: ParkingPlace, now: number) {
  const price = parkingPrice(place, now);
  if (price?.firstHour === 0 && price.nextHour === 0) return true;
  const sign = place.signInfo;
  if (sign?.confirmedAt) {
    if (sign.firstHour === 0 && sign.nextHour === 0) return true;
    const { day, minute } = skopjeTime(now);
    if ((sign.freeWeekends === "both" && day >= 5) || (sign.freeWeekends === "sunday" && day === 6)) return true;
    const periods = parsePayingHours(sign.chargingHours);
    const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    if (periods?.length) return !periods.some(period => {
      const from = minutes(period.from), to = minutes(period.to);
      return from < to ? period.days.includes(day) && minute >= from && minute < to : (period.days.includes(day) && minute >= from) || (period.days.includes((day + 6) % 7) && minute < to);
    });
  }
  // Without readable sign hours, only the operator's published timetable can say it is free.
  return officiallyCharging(place, now) === false;
}
/** No published Skopje timetable charges on Sundays, holidays or 23:00-07:00 (Vodno aside). */
function quietHours(now: number) {
  const { day, minute } = skopjeTime(now);
  return day === 6 || isSkopjeHoliday(now) || minute < 7 * 60 || minute >= 23 * 60;
}
/** Account for imprecise community outlines while keeping the GPS circle out of holes. */
export function safelyInsideZone(fix: Fix, place: ParkingPlace) {
  if (!polygonUsable(place) || !place.geometry || place.locationPrecision === "area" || !containsParkingFix(fix, place)) return false;
  const bleed = parkingBoundaryBleedMeters(place), inside = insidePolygon(fix, place.geometry);
  const exteriorDistance = distanceToParkingBoundary(fix, place.geometry);
  if ((inside ? exteriorDistance + bleed : bleed - exteriorDistance) <= (fix.accuracy ?? Infinity)) return false;
  const scale = Math.cos(fix.latitude * Math.PI / 180);
  for (const ring of place.geometry.coordinates.slice(1)) {
    if (ring.length < 4 || ring.some(point => point.length !== 2 || point.some(value => !Number.isFinite(value)))) return false;
    for (let i = 0; i < ring.length - 1; i++) {
      const a = { x: (ring[i][0] - fix.longitude) * 111320 * scale, y: (ring[i][1] - fix.latitude) * 111320 };
      const b = { x: (ring[i + 1][0] - fix.longitude) * 111320 * scale, y: (ring[i + 1][1] - fix.latitude) * 111320 };
      const dx = b.x - a.x, dy = b.y - a.y;
      const fraction = dx || dy ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / (dx * dx + dy * dy))) : 0;
      if (Math.hypot(a.x + fraction * dx, a.y + fraction * dy) <= (fix.accuracy ?? Infinity)) return false;
    }
  }
  return true;
}
/** A recent, precise fix from a driver who is not moving. */
const steadyFix = (fix: Fix | null, now: number): fix is Fix => Boolean(fix && usableFix(fix, now) && now - fix.timestamp <= 20_000 && fix.accuracy! <= 20 &&
  (fix.speed === null || (Number.isFinite(fix.speed) && fix.speed >= 0 && fix.speed <= 0.8)));
const verifiedPayment = (place: ParkingPlace, now: number) => Boolean(place.smsPayment && isVerifiedSmsPayment(place.smsPayment, now) && smsZoneMatches(place.zoneCode, place.smsPayment.zoneCode));
const nearGradskiStreet = (fix: Fix, places: ParkingPlace[], zone: ParkingPlace) =>
  places.some(other => other.id !== zone.id && officialZoneRules(other)?.operator === "gradski" && !polygonUsable(other) && distanceMeters(fix, other.coordinate) <= GRADSKI_STREET_RADIUS_M);
export function eligibleSmsZone(fix: Fix | null, places: ParkingPlace[], plate: string | null, now: number) {
  if (!isCompactLicensePlate(plate) || !steadyFix(fix, now)) return null;
  const zone = outlineSmsZone(fix, places, now);
  // Published rules are not a photo of this street: stay quiet where a Gradski street zone may run through the sector.
  return zone && !(isOfficialProtocol(zone.smsPayment) && nearGradskiStreet(fix, places, zone)) ? zone : null;
}
/** The one payable outline a steady fix is clearly inside. */
function outlineSmsZone(fix: Fix, places: ParkingPlace[], now: number) {
  // A photographed payment rule can belong to a drawn parking area, not just a tariff zone.
  const overlapping = places.filter(place => polygonUsable(place) && containsParkingFix(fix, place.access === "restricted" ? { ...place, access: "public" } : place));
  const exact = overlapping.filter(place => insidePolygon(fix, place.geometry!));
  const verified = (place: ParkingPlace) => verifiedPayment(place, now);
  const physicalPaymentAreas = overlapping.filter(place => !isPocSector(place) && verified(place));
  const exactPaymentAreas = exact.filter(place => !isPocSector(place) && verified(place));
  const candidates = exactPaymentAreas.length ? exactPaymentAreas : physicalPaymentAreas.length ? physicalPaymentAreas : overlapping.filter(place => verified(place));
  if (candidates.length !== 1) return null;
  const zone = candidates[0], protocol = zone.smsPayment;
  // An exact outline wins over a neighboring bleed. A matching tariff sector is
  // contextual; a conflicting or unverified second physical area remains ambiguous.
  const conflicts = overlapping.filter(other => other.id !== zone.id && (insidePolygon(fix, other.geometry!) || !insidePolygon(fix, zone.geometry!)) &&
    !(isPocSector(other) && smsZoneMatches(other.zoneCode, protocol?.zoneCode) && (!other.smsPayment || (isVerifiedSmsPayment(other.smsPayment, now) && paymentRule(other) === paymentRule(zone)))));
  if (conflicts.length || zone.capacity === 0) return null;
  if (zone.access === "restricted" || !safelyInsideZone(fix, zone) || !protocol || !isVerifiedSmsPayment(protocol, now) || !smsZoneMatches(zone.zoneCode, protocol.zoneCode) || knownFreeTime(zone, now)) return null;
  // Unknown official hours at night are not worth an SMS prompt.
  if (isOfficialProtocol(protocol) && officiallyCharging(zone, now) === null && quietHours(now)) return null;
  return zone;
}
/** Gradski street zones are catalog points near the middle of their street; a parked car can be this far from one. */
export const STREET_ZONE_REACH_M = 150;
const MAX_CHOICES = 3;
const offerable = (place: ParkingPlace, now: number) => place.access !== "restricted" && place.capacity !== 0 && verifiedPayment(place, now) &&
  !knownFreeTime(place, now) && !(officiallyCharging(place, now) === null && quietHours(now));
const streetZonesNear = (fix: Fix, places: ParkingPlace[], now: number, radius: number) => places
  .flatMap(place => place.kind === "zone" && !polygonUsable(place) && offerable(place, now) ? [{ place, distance: distanceMeters(fix, place.coordinate) }] : [])
  .filter(row => row.distance <= radius).sort((a, b) => a.distance - b.distance);
/**
 * Zones a stopped driver may be parked in, for a one-tap payment offer. An outline the fix is
 * clearly inside keeps the exact checks above; street zones are matched by distance. Several
 * similarly close zones are all returned so the driver picks the one on the sign.
 */
export function smsZoneChoices(fix: Fix | null, places: ParkingPlace[], now: number): ParkingPlace[] {
  if (!steadyFix(fix, now)) return [];
  const zone = outlineSmsZone(fix, places, now);
  if (zone) {
    if (!isOfficialProtocol(zone.smsPayment) || !nearGradskiStreet(fix, places, zone)) return [zone];
    // A Gradski street may run through the sector: offer both, never one silently.
    const streets = streetZonesNear(fix, places, now, GRADSKI_STREET_RADIUS_M);
    return streets.length ? [zone, ...streets.map(row => row.place)].slice(0, MAX_CHOICES) : [];
  }
  // Inside a parking lot, or an outline the exact checks could not settle: no guess.
  if (places.some(place => containsParkingFix(fix, { ...place, access: "public" }) && (place.kind === "surface" || place.kind === "garage" || place.kind === "underground" || (polygonUsable(place) && verifiedPayment(place, now))))) return [];
  const streets = streetZonesNear(fix, places, now, STREET_ZONE_REACH_M + fix.accuracy!);
  // GPS error moves both distances, and the catalog points are approximate.
  const margin = 30 + 2 * fix.accuracy!;
  return streets.filter(row => row.distance - streets[0].distance <= margin).slice(0, MAX_CHOICES).map(row => row.place);
}
/** Choices are a set: GPS jitter between similarly close zones only reorders them. The order is for display. */
export const choiceKey = (ids: string[]) => [...ids].sort().join(" ");
const identity = (zones: ParkingPlace[], plate: string | null) =>
  JSON.stringify([[...zones].sort((a, b) => a.id < b.id ? -1 : 1).map(place => [place.id, place.geometry, place.smsPayment]), plate]);
const cooldownKey = (id: string, plate: string | null) => `${id}:${plate ?? ""}`;
export class ZonePaymentDwell {
  private candidate: { key: string; since: number; last: number; count: number; anchor: Coordinate } | null = null;
  private cooldown = new Map<string, number>();
  reset() { this.candidate = null; }
  /** The zone choices once the driver has stayed put long enough, else null. */
  update(fix: Fix | null, places: ParkingPlace[], plate: string | null, foreground: boolean, now = Date.now()): ParkingPlace[] | null {
    const zones = foreground ? smsZoneChoices(fix, places, now) : [];
    if (!zones.length || !fix) { this.reset(); return null; }
    const key = identity(zones, plate), previous = this.candidate;
    if (!previous || previous.key !== key || fix.timestamp - previous.last > 25000 || fix.timestamp < previous.last || distanceMeters(fix, previous.anchor) > 15) {
      this.candidate = { key, since: fix.timestamp, last: fix.timestamp, count: 1, anchor: fix };
      return null;
    }
    if (fix.timestamp > previous.last) { previous.last = fix.timestamp; previous.count++; }
    return previous.count >= 3 && previous.last - previous.since >= PAYMENT_DWELL_MS ? zones : null;
  }
  /** A dismissed zone stays quiet for an hour, also when offered alongside another. */
  canPrompt(ids: string[], plate: string | null, now = Date.now()) { return ids.every(id => now - (this.cooldown.get(cooldownKey(id, plate)) ?? -Infinity) >= PAYMENT_COOLDOWN_MS); }
  prompted(ids: string[], plate: string | null, now = Date.now()) {
    for (const id of ids) this.cooldown.set(cooldownKey(id, plate), now);
    for (const [key, at] of this.cooldown) if (now - at >= PAYMENT_COOLDOWN_MS) this.cooldown.delete(key);
    while (this.cooldown.size > 128) this.cooldown.delete(this.cooldown.keys().next().value!);
  }
}
/** Zones a driver can pay by SMS near a point, nearest first; the driver picks the one on the sign. */
export function payableZones(places: ParkingPlace[], origin: Coordinate, now = Date.now(), limit = 8, radius = 2000) {
  return places.flatMap(place => {
    if (place.access === "restricted" || place.capacity === 0 || !place.smsPayment || !isVerifiedSmsPayment(place.smsPayment, now) || !smsZoneMatches(place.zoneCode, place.smsPayment.zoneCode)) return [];
    const outline = polygonUsable(place) ? place.geometry! : null, inside = Boolean(outline && insidePolygon(origin, outline));
    const distance = Math.round(inside ? 0 : outline ? distanceToParkingBoundary(origin, outline) : distanceMeters(origin, place.coordinate));
    return distance <= radius ? [{ place, distance, inside }] : [];
  }).sort((a, b) => a.distance - b.distance).slice(0, limit);
}
