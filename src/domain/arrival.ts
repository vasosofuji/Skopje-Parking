import { distanceMeters, parkingPrice } from "./parking";
import { isPocSector } from "./zone-interaction";
import type { Coordinate, Geometry, ParkingPlace } from "./types";

export function insidePolygon(point: Coordinate, geometry: Geometry): boolean {
  const insideRing = (ring: number[][]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x, y] = ring[i],
        [px, py] = ring[j];
      if (
        y > point.latitude !== py > point.latitude &&
        point.longitude < ((px - x) * (point.latitude - y)) / (py - y) + x
      )
        inside = !inside;
    }
    return inside;
  };
  return (
    insideRing(geometry.coordinates[0]) &&
    !geometry.coordinates.slice(1).some(insideRing)
  );
}

export type Fix = Coordinate & {
  accuracy: number | null;
  speed: number | null;
  timestamp: number;
};
export const ARRIVAL_DWELL_MS = 10000;
export const ARRIVAL_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export type ArrivalSnapshot = {
  candidate: { id: string; since: number; last: number; anchor: Coordinate } | null;
  /** Successful reports only. Showing a question never starts this cooldown. */
  prompted: [string, number][];
  visit?: { id: string; last: number } | null;
};
/** Only user-created outlines receive tolerance; imported/official geometry stays exact. */
export function parkingBoundaryBleedMeters(place: ParkingPlace) {
  return place.boundaryEvidence === "community" || place.id.startsWith("community:") && place.verification === "community" ? 20 : 0;
}
function insideRing(point: Coordinate, ring: number[][]) {
  return insidePolygon(point, { type: "Polygon", coordinates: [ring] });
}
/** Distance to the exterior outline in meters; interior holes never receive a buffer. */
export function distanceToParkingBoundary(point: Coordinate, geometry: Geometry) {
  const ring = geometry.coordinates[0];
  if (!ring?.length) return Infinity;
  const scaleY = 111195, scaleX = scaleY * Math.cos(point.latitude * Math.PI / 180);
  let nearest = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = (ring[j][0] - point.longitude) * scaleX, ay = (ring[j][1] - point.latitude) * scaleY;
    const bx = (ring[i][0] - point.longitude) * scaleX, by = (ring[i][1] - point.latitude) * scaleY;
    const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
    nearest = Math.min(nearest, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return nearest;
}
export function containsParkingFix(fix: Coordinate, place: ParkingPlace) {
  if (place.access === "restricted") return false;
  if (!place.geometry) return place.kind !== "zone" && place.locationPrecision !== "area" && distanceMeters(fix, place.coordinate) <= 25;
  if (place.geometry.coordinates.slice(1).some(ring => insideRing(fix, ring))) return false;
  return insidePolygon(fix, place.geometry) || distanceToParkingBoundary(fix, place.geometry) <= parkingBoundaryBleedMeters(place);
}
/** Exact footprints beat buffered neighbors. Ambiguous physical lots never choose arbitrarily. */
export function arrivalParkingAtFix(fix: Coordinate, places: ParkingPlace[]) {
  // A tariff zone only has a question to ask while its price is unknown.
  const candidates = places.filter(p => !isPocSector(p) && !(p.kind === "zone" && parkingPrice(p)) && containsParkingFix(fix, p));
  const exact = candidates.filter(p => p.geometry && insidePolygon(fix, p.geometry));
  const physical = candidates.filter(p => p.kind !== "zone");
  const exactPhysical = physical.filter(p => p.geometry && insidePolygon(fix, p.geometry));
  const matches = exactPhysical.length ? exactPhysical : physical.length ? physical : exact.length ? exact : candidates;
  return matches.length === 1 ? matches[0] : null;
}
export class ArrivalDetector {
  private candidate: ArrivalSnapshot["candidate"] = null;
  private prompted = new Map<string, number>();
  private visit: ArrivalSnapshot["visit"] = null;
  constructor(snapshot?: ArrivalSnapshot) {
    if (snapshot) {
      this.candidate = snapshot.candidate ? { ...snapshot.candidate, anchor: { ...snapshot.candidate.anchor } } : null;
      this.prompted = new Map(snapshot.prompted);
      this.visit = snapshot.visit ? { ...snapshot.visit } : null;
    }
  }
  snapshot(now = Date.now()): ArrivalSnapshot {
    return {
      candidate: this.candidate ? { ...this.candidate, anchor: { ...this.candidate.anchor } } : null,
      prompted: [...this.prompted].filter(([, at]) => now >= at && now - at < ARRIVAL_COOLDOWN_MS),
      visit: this.visit ? { ...this.visit } : null,
    };
  }
  reported(placeId: string, now = Date.now()) {
    this.prompted.set(placeId, now);
    this.candidate = null;
  }
  reset() {
    this.candidate = null;
  }
  update(
    fix: Fix,
    places: ParkingPlace[],
    now = Date.now(),
  ): ParkingPlace | null {
    if (
      !Number.isFinite(fix.latitude) ||
      !Number.isFinite(fix.longitude) ||
      !Number.isFinite(fix.timestamp) ||
      Math.abs(fix.latitude) > 90 ||
      Math.abs(fix.longitude) > 180 ||
      fix.accuracy === null ||
      !Number.isFinite(fix.accuracy) ||
      fix.accuracy < 0 ||
      fix.accuracy > 25 ||
      now - fix.timestamp > 20000 ||
      fix.timestamp > now + 5000
    ) {
      this.reset();
      return null;
    }
    // A weak fix cannot claim departure. Reliable fixes release an unanswered visit
    // immediately after leaving, without imposing the report cooldown on re-entry.
    if (this.visit) {
      const visited = places.find(p => p.id === this.visit!.id);
      if (visited && containsParkingFix(fix, visited) && now - this.visit.last < 30 * 60 * 1000) {
        this.visit.last = now;
        this.reset();
        return null;
      }
      this.visit = null;
    }
    if (fix.speed !== null && (!Number.isFinite(fix.speed) || fix.speed < 0 || fix.speed > 0.8)) { this.reset(); return null; }
    const place = arrivalParkingAtFix(fix, places);
    if (
      !place ||
      now - (this.prompted.get(place.id) ?? -Infinity) < ARRIVAL_COOLDOWN_MS
    ) {
      this.reset();
      return null;
    }
    const c = this.candidate;
    if (
      !c ||
      c.id !== place.id ||
      fix.timestamp - c.last > 25000 ||
      distanceMeters(fix, c.anchor) > 15
    ) {
      this.candidate = {
        id: place.id,
        since: fix.timestamp,
        last: fix.timestamp,
        anchor: fix,
      };
      return null;
    }
    if (fix.timestamp <= c.last) return null;
    c.last = fix.timestamp;
    if (fix.timestamp - c.since < ARRIVAL_DWELL_MS) return null;
    this.visit = { id: place.id, last: now };
    this.reset();
    return place;
  }
}
