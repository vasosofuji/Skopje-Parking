import { distanceMeters, estimateCost, parkingPrice } from "./parking";
import { parkingMarker, parkingReviewEvidence } from "./marker-appearance";
import type { ParkingPlace, Coordinate } from "./types";
export type ParkingFilter = "all" | "free" | "reviewed" | "unreviewed" | "spaces" | "full" | "surface" | "garage" | "underground" | "street" | "zone";
export type ActiveParkingFilter = Exclude<ParkingFilter, "all">;
const filterGroups: ActiveParkingFilter[][] = [["free"], ["reviewed", "unreviewed"], ["spaces", "full"], ["surface", "garage", "underground", "street", "zone"]];
export function toggleParkingFilter(filters: ActiveParkingFilter[], filter: ActiveParkingFilter): ActiveParkingFilter[] {
  return filters.includes(filter) ? filters.filter(value => value !== filter) : [...filters, filter];
}
/** Combine distinct criteria, allowing alternatives within each criterion. Empty means all. */
export function matchesParkingFilters(place: ParkingPlace, filters: ActiveParkingFilter[], now = Date.now()) {
  return filterGroups.every(group => {
    const selected = group.filter(filter => filters.includes(filter));
    return !selected.length || selected.some(filter => matchesParkingFilter(place, filter, now));
  });
}
export function matchesParkingFilter(place: ParkingPlace, filter: ParkingFilter, now = Date.now()) {
  if (filter === "all") return true;
  if (filter === "reviewed") return Boolean(parkingReviewEvidence(place, now));
  if (filter === "unreviewed") return !parkingReviewEvidence(place, now);
  if (filter === "free" || filter === "spaces" || filter === "full") {
    const marker = parkingMarker(place, 1, now);
    return filter === "free" ? marker.freeOfCharge : marker[filter];
  }
  return place.kind === filter;
}

/** Filter lists include zones and restricted facilities too, matching the map exactly. */
export function filteredParkingRows(places: ParkingPlace[], origin: Coordinate, now = Date.now()) {
  return places.map(place => {
    const price = parkingPrice(place, now);
    const cost = price ? estimateCost({ ...price, maxStayMinutes: place.tariff?.maxStayMinutes ?? place.signInfo?.maxStayMinutes ?? null }, 60) : null;
    return { place, distance: distanceMeters(place.coordinate, origin), cost, costEvidence: cost !== null ? price!.evidence : null };
  }).sort((a, b) => a.distance - b.distance || a.place.id.localeCompare(b.place.id));
}
