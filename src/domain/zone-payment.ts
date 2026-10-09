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
export function eligibleSmsZone(fix: Fix | null, places: ParkingPlace[], plate: string | null, now: number) {
  if (!isCompactLicensePlate(plate) || !fix || !usableFix(fix, now) || now - fix.timestamp > 20_000 || fix.accuracy! > 20 || (fix.speed !== null && (!Number.isFinite(fix.speed) || fix.speed < 0 || fix.speed > 0.8))) return null;
  // A photographed payment rule can belong to a drawn parking area, not just a tariff zone.
  const overlapping = places.filter(place => polygonUsable(place) && containsParkingFix(fix, place.access === "restricted" ? { ...place, access: "public" } : place));
  const exact = overlapping.filter(place => insidePolygon(fix, place.geometry!));
  const verified = (place: ParkingPlace) => place.smsPayment && isVerifiedSmsPayment(place.smsPayment, now) && smsZoneMatches(place.zoneCode, place.smsPayment.zoneCode);
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
  // Published rules are not a photo of this street: stay quiet where a Gradski
  // street zone may run through the sector, and when hours are unknown at night.
  if (isOfficialProtocol(protocol) && (
    places.some(other => other.id !== zone.id && officialZoneRules(other)?.operator === "gradski" && !polygonUsable(other) && distanceMeters(fix, other.coordinate) <= GRADSKI_STREET_RADIUS_M) ||
    (officiallyCharging(zone, now) === null && quietHours(now)))) return null;
  return zone;
}
const identity = (place: ParkingPlace, plate: string) => JSON.stringify([place.id, plate, place.geometry, place.smsPayment]);
export class ZonePaymentDwell {
  private candidate: { key: string; id: string; since: number; last: number; count: number; anchor: Coordinate } | null = null;
  private cooldown = new Map<string, number>();
  reset() { this.candidate = null; }
  update(fix: Fix | null, places: ParkingPlace[], plate: string | null, foreground: boolean, now = Date.now()) {
    const place = foreground ? eligibleSmsZone(fix, places, plate, now) : null;
    if (!place || !fix || !plate) { this.reset(); return null; }
    const key = identity(place, plate), previous = this.candidate;
    if (!previous || previous.key !== key || fix.timestamp - previous.last > 25000 || fix.timestamp < previous.last || distanceMeters(fix, previous.anchor) > 15) {
      this.candidate = { key, id: place.id, since: fix.timestamp, last: fix.timestamp, count: 1, anchor: fix };
      return null;
    }
    if (fix.timestamp > previous.last) { previous.last = fix.timestamp; previous.count++; }
    return previous.count >= 3 && previous.last - previous.since >= PAYMENT_DWELL_MS ? place : null;
  }
  canPrompt(place: ParkingPlace, plate: string, now = Date.now()) { return now - (this.cooldown.get(`${place.id}:${plate}`) ?? -Infinity) >= PAYMENT_COOLDOWN_MS; }
  prompted(place: ParkingPlace, plate: string, now = Date.now()) {
    this.cooldown.set(`${place.id}:${plate}`, now);
    for (const [key, at] of this.cooldown) if (now - at >= PAYMENT_COOLDOWN_MS) this.cooldown.delete(key);
    if (this.cooldown.size > 128) this.cooldown.delete(this.cooldown.keys().next().value!);
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
