import { accentColor } from "./cosmetics";
import { currentAvailability, parkingPrice } from "./parking";
import type { ParkingKind, ParkingPlace } from "./types";

export const PARKING_TYPE_MARKS: Record<ParkingKind, string> = {
  surface: "P", garage: "G", underground: "U", street: "S", zone: "Z",
};

export const MARKER_COLORS = {
  normal: "#392C25", needsInfo: "#65529A", free: "#087184",
  spaces: "#087958", full: "#B83A36", restricted: "#63746C",
  cluster: "#F4E8D4", clusterText: "#392C25", clusterBorder: "#947459",
} as const;

export function parkingReviewEvidence(place: ParkingPlace, now = Date.now()) {
  if (place.verification === "official") return "official";
  if (place.signInfo?.confirmedAt && Date.parse(place.signInfo.confirmedAt) <= now) return "sign";
  const price = parkingPrice(place, now);
  if (price?.evidence === "official" || price?.evidence === "community" && "observedAt" in price) return "price";
  if (place.zoneCode?.trim() && place.zoneCodeEvidence === "community") return "zone";
  // /confirmations records presence; the server returns its last 90 days of votes.
  // A positive majority confirms only that the parking exists, never price/sign data.
  const votes = place.locationReports;
  if (votes && Number.isInteger(votes.yes) && Number.isInteger(votes.no) && votes.no >= 0 && votes.yes > votes.no) return "presence";
  return null;
}

export function parkingMarker(place: ParkingPlace, count = 1, now = Date.now()) {
  if (count > 1) return {
    fill: MARKER_COLORS.cluster, text: MARKER_COLORS.clusterText, border: MARKER_COLORS.clusterBorder,
    label: String(count), badge: null, stateBadge: null, stateColor: undefined, needsInfo: false, freeOfCharge: false, spaces: false, full: false, cluster: true,
  } as const;
  const review = parkingReviewEvidence(place, now), price = parkingPrice(place, now);
  const reliablePrice = price?.evidence === "official" || price?.evidence === "community" && "observedAt" in price || price?.evidence === "sign" && review === "sign";
  const freeOfCharge = Boolean(reliablePrice && price && price.firstHour === 0 && price.nextHour === 0);
  const availability = currentAvailability(place.availability, now);
  const restricted = place.access === "restricted";
  const spaces = !restricted && place.kind !== "zone" && place.capacity !== 0 && availability.status === "spaces";
  const full = !restricted && place.kind !== "zone" && availability.status === "full";
  const fill = !review ? MARKER_COLORS.needsInfo : restricted ? MARKER_COLORS.restricted : full ? MARKER_COLORS.full : spaces ? MARKER_COLORS.spaces
    : freeOfCharge ? MARKER_COLORS.free : MARKER_COLORS.normal;
  return {
    fill, text: "#FFFFFF", border: accentColor(place.contributionAccent) ?? "#FFFFFF",
    label: spaces && review ? `${PARKING_TYPE_MARKS[place.kind]} ✓` : PARKING_TYPE_MARKS[place.kind],
    badge: freeOfCharge ? "0" : null,
    stateBadge: !review && (spaces || full) ? full ? "×" : "✓" : null,
    stateColor: full ? MARKER_COLORS.full : spaces ? MARKER_COLORS.spaces : undefined,
    needsInfo: !review, freeOfCharge, spaces, full, cluster: false,
  } as const;
}

export type MarkerAppearance = ReturnType<typeof parkingMarker>;

// Values originate in parkingMarker: fixed colors/labels or a numeric cluster count.
export function parkingMarkerHtml(marker: MarkerAppearance) {
  return `<span class="parking-pin-face" style="background:${marker.fill};color:${marker.text};border-color:${marker.border}">${marker.label}${marker.needsInfo ? '<b class="parking-review-badge">?</b>' : ""}${marker.badge ? '<b class="parking-free-badge">0</b>' : ""}${marker.stateBadge ? `<b class="parking-state-badge" style="background:${marker.stateColor}">${marker.stateBadge}</b>` : ""}</span>`;
}
