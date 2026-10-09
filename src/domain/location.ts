import type { Fix } from "./arrival";
import type { Coordinate } from "./types";
import { distanceMeters } from "./parking";
/** Faster than any car in a city (250 km/h) between two fixes means a multipath jump, not travel. */
const MAX_TRAVEL_MPS = 70;
export function nearbyOrigin(
  destination: Coordinate | null,
  fix: Fix | null,
  now = Date.now(),
): Coordinate | null {
  return (
    destination ??
    (fix && usableFix(fix, now) && fix.accuracy! <= 50 ? fix : null)
  );
}
export function canAddAtLocation(fix: Fix | null, now = Date.now()) {
  return Boolean(
    fix &&
      usableFix(fix, now) &&
      fix.accuracy! <= 25 &&
      (fix.speed === null || fix.speed <= 1.5),
  );
}
export function usableFix(fix: Fix, now = Date.now()) {
  return (
    Number.isFinite(fix.latitude) &&
    Math.abs(fix.latitude) <= 90 &&
    Number.isFinite(fix.longitude) &&
    Math.abs(fix.longitude) <= 180 &&
    fix.accuracy !== null &&
    Number.isFinite(fix.accuracy) &&
    fix.accuracy >= 0 &&
    Number.isFinite(fix.timestamp) &&
    now - fix.timestamp <= 30000 &&
    fix.timestamp <= now + 5000
  );
}
export function preferFix(previous: Fix | null, next: Fix) {
  if (!previous) return true;
  if (next.timestamp < previous.timestamp) return false;
  if (next.timestamp === previous.timestamp) return next.accuracy! < previous.accuracy!;
  // Within 10 s, reject a jump that even both accuracy circles cannot explain. After a longer
  // gap (tunnel, garage exit) any fix is accepted, so a single bad fix cannot pin the map.
  const seconds = (next.timestamp - previous.timestamp) / 1000;
  if (seconds < 10 && distanceMeters(previous, next) - previous.accuracy! - next.accuracy! > MAX_TRAVEL_MPS * Math.max(1, seconds)) return false;
  // Keep walking/driving updates live through ordinary GPS degradation. Briefly
  // hold extreme network drift, then show its true (approximate) accuracy rather
  // than leaving a precise-looking marker at a location the driver has left.
  return (
    next.timestamp - previous.timestamp >= 5000 ||
    next.accuracy! <= Math.max(250, previous.accuracy! * 2)
  );
}
