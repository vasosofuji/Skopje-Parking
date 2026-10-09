import { containsParkingFix, insidePolygon, type Fix } from "./arrival";
import { distanceMeters } from "./parking";
import type { Coordinate, ParkingPlace } from "./types";

// JP Parkinzi na Opstina Centar 2026 price list supplied with this request.
// null means not listed, never free. Reserved spaces are not ordinary cards.
export const POC_PRICES = {
  O: { hourly: 100, weekly: null, multiWeekly: null, monthly: null, yearly: null, guestDaily: null, entryDaily: null, daily: null, reservedMonthly: 18000, blocker: 1500 },
  X: { hourly: 80, weekly: null, multiWeekly: null, monthly: null, yearly: null, guestDaily: null, entryDaily: 800, daily: 1600, reservedMonthly: null, blocker: null },
  I: { hourly: 70, weekly: 1200, multiWeekly: 2000, monthly: 2500, yearly: null, guestDaily: 300, entryDaily: 800, daily: 1600, reservedMonthly: 12000, blocker: 1500 },
  II: { hourly: 60, weekly: 1200, multiWeekly: 2000, monthly: 2500, yearly: null, guestDaily: 300, entryDaily: 700, daily: 1400, reservedMonthly: 12000, blocker: 1500 },
} as const;
export type PocCardZone = "I" | "II";
export function pocCardZone(place: ParkingPlace, places: ParkingPlace[]): PocCardZone | null {
  if (place.access !== "public" || !["surface", "street", "zone"].includes(place.kind)) return null;
  const code = (place.zoneCode ?? "").toUpperCase().replace(/\s/g, "");
  const poc = place.operator?.toLowerCase() === "poc" || place.id.startsWith("poc:") || code.startsWith("POC");
  if (poc) {
    if (/^(POC)?(1|I)$/.test(code)) return "I";
    if (/^(POC)?(2|II)$/.test(code)) return "II";
    if (/^(POC)?(0|O|X)$/.test(code)) return null;
  }
  // Do not recommend public street cards for private/customer garages within a sector.
  if (place.operator && place.operator.toLowerCase() !== "poc" || place.access !== "public" || !["surface", "street"].includes(place.kind)) return null;
  const sectors = places.filter(p => p.kind === "zone" && p.geometry && (p.operator?.toLowerCase() === "poc" || p.id.startsWith("poc:zone:")) && insidePolygon(place.coordinate, p.geometry));
  if (sectors.length !== 1) return null;
  return pocCardZone(sectors[0], []);
}
export type PocVisit = { placeId: string; zone: PocCardZone; at: number; areaId?: string; anchor?: Coordinate };
export type PocVisitHistory = { visits: PocVisit[]; prompted: Record<string, number> };
export const POC_WEEK_MS = 7 * 86400000;
export function readPocVisits(raw: string | null, now: number): PocVisitHistory {
  try {
    const data = JSON.parse(raw ?? "null");
    if (!data || !Array.isArray(data.visits)) return { visits: [], prompted: {} };
    return {
      visits: data.visits.filter((v: PocVisit) => typeof v?.placeId === "string" && ["I", "II"].includes(v.zone) && Number.isFinite(v.at) && v.at <= now && now - v.at < POC_WEEK_MS && (!v.anchor || (Number.isFinite(v.anchor.latitude) && Number.isFinite(v.anchor.longitude)))).slice(-200),
      prompted: Object.fromEntries(Object.entries(data.prompted ?? {}).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] <= now && now - entry[1] < POC_WEEK_MS)),
    };
  } catch { return { visits: [], prompted: {} }; }
}
export function recordPocVisit(history: PocVisitHistory, placeId: string, zone: PocCardZone, now: number, anchor?: Coordinate) {
  const next = readPocVisits(JSON.stringify(history), now);
  // A tariff area spans many spots: retain a parking-sized anchor, not its sector center.
  const existing = anchor ? next.visits.find(v => v.areaId === placeId && v.anchor && distanceMeters(v.anchor, anchor) <= 25) : undefined;
  const key = anchor ? existing?.placeId ?? `${placeId}@${anchor.latitude.toFixed(5)},${anchor.longitude.toFixed(5)}` : placeId;
  if (next.visits.some(v => v.placeId === key && now - v.at < 6 * 3600000)) return { history: next, suggest: false };
  next.visits.push({ placeId: key, zone, at: now, ...(anchor ? { areaId: placeId, anchor: existing?.anchor ?? anchor } : {}) });
  const suggest = next.visits.filter(v => v.placeId === key && v.zone === zone).length >= 3 && !(key in next.prompted);
  if (suggest) next.prompted[key] = now;
  return { history: next, suggest };
}

/** Include known-price tariff areas, which the availability-question detector skips. */
export class PocVisitDetector {
  private candidate: { id: string; since: number; last: number; anchor: Fix; recorded: boolean } | null = null;
  update(fix: Fix | null, places: ParkingPlace[], now: number): ParkingPlace | null {
    if (!fix || !Number.isFinite(fix.timestamp) || now - fix.timestamp > 20000 || fix.timestamp > now + 5000 || fix.accuracy === null || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > 20 || (fix.speed !== null && (!Number.isFinite(fix.speed) || fix.speed < 0 || fix.speed > 0.8))) { this.candidate = null; return null; }
    const containing = places.filter(p => p.geometry ? insidePolygon(fix, p.geometry) : p.kind !== "zone" && distanceMeters(fix, p.coordinate) <= 25);
    const facilities = containing.filter(p => p.kind !== "zone");
    const sectors = containing.filter(p => p.kind === "zone" && (p.operator?.toLowerCase() === "poc" || p.id.startsWith("poc:zone:")));
    if (facilities.some(p => !pocCardZone(p, places)) || sectors.length > 1) { this.candidate = null; return null; }
    const place = (facilities.length ? facilities : sectors).filter(p => containsParkingFix(fix, p) && pocCardZone(p, places)).sort((a, b) => distanceMeters(fix, a.coordinate) - distanceMeters(fix, b.coordinate))[0];
    if (!place) { this.candidate = null; return null; }
    const previous = this.candidate;
    if (!previous || previous.id !== place.id || fix.timestamp - previous.last > 25000 || fix.timestamp < previous.last || distanceMeters(fix, previous.anchor) > 15) {
      this.candidate = { id: place.id, since: fix.timestamp, last: fix.timestamp, anchor: fix, recorded: false }; return null;
    }
    if (fix.timestamp === previous.last) return null;
    previous.last = fix.timestamp;
    // Require two minutes stopped at the same location; merely driving through never counts.
    if (previous.recorded || fix.timestamp - previous.since < 120000) return null;
    previous.recorded = true;
    return place.kind === "zone" ? { ...place, coordinate: { latitude: previous.anchor.latitude, longitude: previous.anchor.longitude } } : place;
  }
}
