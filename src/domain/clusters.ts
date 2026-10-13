import type { ParkingPlace } from "./types";
import { currentAvailability } from "./parking";
import { isPocSector } from "./zone-interaction";

/** Overview cells are 120px wide; from zoom 18 every place keeps its own marker. */
export function clusterSteps(zoom: number, latitude: number): [number, number] {
  // Injected into the map WebView via toString(); Hermes keeps source only with this directive.
  "show source";
  const longitude = zoom < 18 ? (120 * 360) / (256 * Math.pow(2, zoom)) : 0;
  return [longitude * Math.cos((latitude * Math.PI) / 180), longitude];
}

/** The selected place, and open places with reported spaces on the overview, are never grouped. */
export function keepsOwnMarker(place: ParkingPlace, selectedId: string | null, now: number, filtered: boolean) {
  return place.id === selectedId || !filtered && place.access !== "restricted" && currentAvailability(place.availability, now).status === "spaces";
}

/** Groups [latitude, longitude] points; the Android map page runs this on every zoom step. */
export function groupMarkers<T extends { point: number[]; alone?: boolean }>(items: T[], latitudeStep: number, longitudeStep: number, filtered: boolean): T[][] {
  // Injected into the map WebView via toString(); Hermes keeps source only with this directive.
  "show source";
  const groups: T[][] = [];
  if (filtered && latitudeStep > 0 && longitudeStep > 0) {
    // The ordinary overview groups 120px cells. Filtered results only group
    // overlapping marker footprints (about 40px), including across cell edges.
    const lat = latitudeStep / 3, lon = longitudeStep / 3;
    const buckets = new Map<string, T[][]>();
    for (const item of items) {
      if (item.alone) { groups.push([item]); continue; }
      const x = Math.floor(item.point[0] / lat), y = Math.floor(item.point[1] / lon);
      let match: T[] | undefined;
      for (let dx = -1; dx <= 1 && !match; dx++) for (let dy = -1; dy <= 1 && !match; dy++) {
        const near = buckets.get((x + dx) + ":" + (y + dy));
        if (near) match = near.find(group => Math.hypot((group[0].point[0] - item.point[0]) / lat, (group[0].point[1] - item.point[1]) / lon) < 1);
      }
      if (match) { match.push(item); continue; }
      const group = [item], key = x + ":" + y, bucket = buckets.get(key);
      groups.push(group);
      if (bucket) bucket.push(group); else buckets.set(key, [group]);
    }
    return groups;
  }
  const cells = new Map<string, T[]>();
  for (const item of items) {
    if (!latitudeStep || item.alone) { groups.push([item]); continue; }
    const key = Math.floor(item.point[0] / latitudeStep) + ":" + Math.floor(item.point[1] / longitudeStep), cell = cells.get(key);
    if (cell) cell.push(item); else { const group = [item]; cells.set(key, group); groups.push(group); }
  }
  return groups;
}

export function groupParking(
  places: ParkingPlace[],
  latitudeStep: number,
  longitudeStep: number,
  selectedId: string | null,
  now = Date.now(),
  filtered = false,
): ParkingPlace[][] {
  const items = places.filter(place => !isPocSector(place)).map(place => ({ place, point: [place.coordinate.latitude, place.coordinate.longitude], alone: keepsOwnMarker(place, selectedId, now, filtered) }));
  return groupMarkers(items, latitudeStep, longitudeStep, filtered).map(group => group.map(item => item.place));
}
