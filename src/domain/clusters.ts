import type { ParkingPlace } from "./types";
import { currentAvailability } from "./parking";
import { isPocSector } from "./zone-interaction";
export function groupParking(
  places: ParkingPlace[],
  latitudeStep: number,
  longitudeStep: number,
  selectedId: string | null,
  now = Date.now(),
  filtered = false,
): ParkingPlace[][] {
  if (filtered && latitudeStep > 0 && longitudeStep > 0) {
    // The ordinary overview groups 120px cells. Filtered results only group
    // overlapping marker footprints (about 40px), including across cell edges.
    const lat = latitudeStep / 3, lon = longitudeStep / 3;
    const buckets = new Map<string, ParkingPlace[][]>();
    const groups: ParkingPlace[][] = [];
    for (const place of places) {
      if (isPocSector(place)) continue;
      if (place.id === selectedId) { groups.push([place]); continue; }
      const x = Math.floor(place.coordinate.latitude / lat), y = Math.floor(place.coordinate.longitude / lon);
      let match: ParkingPlace[] | undefined;
      for (let dx = -1; dx <= 1 && !match; dx++) for (let dy = -1; dy <= 1 && !match; dy++) {
        match = buckets.get(`${x + dx}:${y + dy}`)?.find(group => {
          const anchor = group[0].coordinate;
          return Math.hypot((anchor.latitude - place.coordinate.latitude) / lat, (anchor.longitude - place.coordinate.longitude) / lon) < 1;
        });
      }
      if (match) match.push(place);
      else {
        const group = [place], key = `${x}:${y}`;
        groups.push(group);
        buckets.set(key, [...(buckets.get(key) ?? []), group]);
      }
    }
    return groups;
  }
  const cells = new Map<string, ParkingPlace[]>();
  for (const place of places) {
    if (isPocSector(place)) continue;
    const key =
      !latitudeStep ||
      place.id === selectedId ||
      (place.access !== "restricted" &&
        currentAvailability(place.availability, now).status === "spaces")
        ? place.id
        : `${Math.floor(place.coordinate.latitude / latitudeStep)}:${Math.floor(place.coordinate.longitude / longitudeStep)}`;
    const group = cells.get(key) ?? [];
    group.push(place);
    cells.set(key, group);
  }
  return [...cells.values()];
}
