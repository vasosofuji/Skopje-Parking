import { accentColor } from "./cosmetics";
import { currentAvailability, parkingPrice, SERVER_CLOCK_TOLERANCE_MS } from "./parking";
import type { ParkingKind, ParkingPlace } from "./types";

export const PARKING_TYPE_MARKS: Record<ParkingKind, string> = {
  surface: "P", garage: "G", underground: "U", street: "S", zone: "Z",
};

// Solid pins carry reviewed data; hollow (paper) pins still need a zone, price or sign.
// Status colors keep their meaning in both: green spaces, red full, teal free of charge.
export const MARKER_COLORS = {
  normal: "#2B211C", needsInfo: "#FFFFFF", needsInfoText: "#56483F", needsInfoBorder: "#A8957F",
  free: "#0B6F7C", spaces: "#0F7A55", full: "#B3312C", restricted: "#7A847F",
  cluster: "#FFFDF8", clusterText: "#2B211C", clusterBorder: "#D9CDBE",
} as const;

export function parkingReviewEvidence(place: ParkingPlace, now = Date.now()) {
  if (place.verification === "official") return "official";
  if (place.signInfo?.confirmedAt && Date.parse(place.signInfo.confirmedAt) <= now + SERVER_CLOCK_TOLERANCE_MS) return "sign";
  const price = parkingPrice(place, now);
  if (price?.evidence === "official" || price?.evidence === "community" && "observedAt" in price) return "price";
  if (place.zoneCode?.trim() && place.zoneCodeEvidence === "community") return "zone";
  // /confirmations records presence; the server returns its last 90 days of votes.
  // A positive majority confirms only that the parking exists, never price/sign data.
  const votes = place.locationReports;
  if (votes && Number.isInteger(votes.yes) && Number.isInteger(votes.no) && votes.no >= 0 && votes.yes > votes.no) return "presence";
  return null;
}

export function clusterMarker(count: number) {
  return {
    fill: MARKER_COLORS.cluster, text: MARKER_COLORS.clusterText, border: MARKER_COLORS.clusterBorder, state: MARKER_COLORS.clusterText,
    label: String(count), badge: null, round: true, hollow: false, needsInfo: false, freeOfCharge: false, spaces: false, full: false, cluster: true,
  } as const;
}

export function parkingMarker(place: ParkingPlace, count = 1, now = Date.now()) {
  if (count > 1) return clusterMarker(count);
  const review = parkingReviewEvidence(place, now), price = parkingPrice(place, now);
  const reliablePrice = price?.evidence === "official" || price?.evidence === "community" && "observedAt" in price || price?.evidence === "sign" && review === "sign";
  const freeOfCharge = Boolean(reliablePrice && price && price.firstHour === 0 && price.nextHour === 0);
  const availability = currentAvailability(place.availability, now);
  const restricted = place.access === "restricted";
  const spaces = !restricted && place.kind !== "zone" && place.capacity !== 0 && availability.status === "spaces";
  const full = !restricted && place.kind !== "zone" && availability.status === "full";
  const state = restricted ? MARKER_COLORS.restricted : full ? MARKER_COLORS.full : spaces ? MARKER_COLORS.spaces
    : freeOfCharge ? MARKER_COLORS.free : MARKER_COLORS.normal;
  const accent = accentColor(place.contributionAccent);
  const hollow = !review;
  return {
    fill: hollow ? MARKER_COLORS.needsInfo : state,
    text: hollow ? state === MARKER_COLORS.normal ? MARKER_COLORS.needsInfoText : state : "#FFFFFF",
    border: accent ?? (hollow ? state === MARKER_COLORS.normal ? MARKER_COLORS.needsInfoBorder : state : "#FFFFFF"),
    state, label: PARKING_TYPE_MARKS[place.kind], badge: freeOfCharge ? "0" : null,
    round: spaces, hollow, needsInfo: hollow, freeOfCharge, spaces, full, cluster: false,
  } as const;
}

export type MarkerAppearance = ReturnType<typeof parkingMarker>;

// Values originate in parkingMarker: fixed colors/labels or a numeric cluster count.
export function parkingMarkerHtml(marker: MarkerAppearance) {
  // Injected into the map WebView via toString(); Hermes keeps source only with this directive.
  "show source";
  const shape = (marker.round ? " round" : "") + (marker.hollow ? " hollow" : "") + (marker.cluster && Number(marker.label) >= 25 ? " large" : "");
  return `<span class="parking-pin-face${shape}" style="background:${marker.fill};color:${marker.text};border-color:${marker.border};--pin:${marker.state}">${marker.label}${marker.badge ? '<b class="parking-free-badge">0</b>' : ""}</span>`;
}

// Shared by the Android WebView map and the web map. Leaflet adds .selected, .cluster and
// .spaces to the icon; the face carries the shape. Dark maps use .dark or .parking-map-dark.
export const PARKING_PIN_CSS = `
.parking-pin{display:flex;align-items:center;justify-content:center;background:transparent;border:0}
.parking-pin-face{position:relative;box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:28px;height:28px;border:2px solid #fff;border-radius:9px;color:#fff;font:800 13px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;box-shadow:0 1px 2px rgba(29,22,19,.3),0 4px 10px rgba(29,22,19,.16);transition:transform .16s ease}
.parking-pin-face.hollow{border-width:1.5px;font-weight:700;box-shadow:0 1px 2px rgba(29,22,19,.16),0 3px 8px rgba(29,22,19,.1)}
.parking-pin-face.round{border-radius:50%}
.parking-pin.spaces .parking-pin-face{width:32px;height:32px;font-size:14px}
.parking-pin.spaces .parking-pin-face::before{content:'';position:absolute;inset:-6px;z-index:-1;border-radius:50%;background:var(--pin);opacity:.2;animation:parking-pin-pulse 2.4s ease-out infinite}
@keyframes parking-pin-pulse{0%{transform:scale(.8);opacity:.38}70%{transform:scale(1.35);opacity:0}100%{transform:scale(1.35);opacity:0}}
.parking-pin.cluster .parking-pin-face{width:auto;min-width:30px;height:30px;padding:0 8px;border-width:1px;border-radius:15px;font-size:13px;box-shadow:0 0 0 4px rgba(255,253,248,.55),0 2px 8px rgba(29,22,19,.2)}
.parking-pin.cluster .parking-pin-face.large{min-width:36px;height:36px;border-radius:18px;font-size:14px}
.parking-pin.selected .parking-pin-face{transform:scale(1.18);outline:2.5px solid #1D1613;outline-offset:2px}
.dark .parking-pin.selected .parking-pin-face,.parking-map-dark .parking-pin.selected .parking-pin-face{outline-color:#FFF6E8}
.parking-free-badge{position:absolute;top:-7px;right:-8px;box-sizing:border-box;min-width:16px;height:16px;padding:0 3px;border-radius:8px;background:#fff;color:${MARKER_COLORS.free};font:800 10px/16px system-ui,sans-serif;text-align:center;box-shadow:0 1px 3px rgba(29,22,19,.3)}
@media (prefers-reduced-motion:reduce){.parking-pin.spaces .parking-pin-face::before{animation:none;transform:scale(1.1)}.parking-pin-face{transition:none}}
`;
