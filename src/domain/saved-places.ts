import { distanceMeters } from "./parking";
import type { Coordinate, Destination } from "./types";

/** A driver's Home, Work or named place, kept on this device only. */
export type SavedPlace = { id: string; kind: "home" | "work" | "custom"; name: string; coordinate: Coordinate };
export const SAVED_PLACE_LIMIT = 20, SAVED_NAME_MAX = 60;
const KIND_ORDER = { home: 0, work: 1, custom: 2 } as const;
const point = (value: Coordinate | undefined) => Boolean(value) && Number.isFinite(value!.latitude) && Number.isFinite(value!.longitude) && Math.abs(value!.latitude) <= 90 && Math.abs(value!.longitude) <= 180;

/** Damaged entries, duplicate ids and a second Home or Work are dropped; Home and Work sort first. */
export function readSavedPlaces(raw: string | null): SavedPlace[] {
  let data: unknown;
  try { data = JSON.parse(raw ?? "[]"); } catch { return []; }
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>(), places: SavedPlace[] = [];
  for (const item of data as SavedPlace[]) {
    const name = typeof item?.name === "string" ? item.name.trim().slice(0, SAVED_NAME_MAX) : "";
    if (typeof item?.id !== "string" || !item.id || item.id.length > 100 || seen.has(item.id) || !["home", "work", "custom"].includes(item.kind) || !name || !point(item.coordinate)) continue;
    if (item.kind !== "custom" && places.some(place => place.kind === item.kind)) continue;
    seen.add(item.id);
    places.push({ id: item.id, kind: item.kind, name, coordinate: { latitude: item.coordinate.latitude, longitude: item.coordinate.longitude } });
  }
  return places.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]).slice(0, SAVED_PLACE_LIMIT);
}

/** Adds a place, replacing the old Home or Work. Null when the list is full. */
export function withSavedPlace(places: SavedPlace[], place: SavedPlace): SavedPlace[] | null {
  const rest = places.filter(item => item.id !== place.id && (place.kind === "custom" || item.kind !== place.kind));
  return rest.length >= SAVED_PLACE_LIMIT ? null : readSavedPlaces(JSON.stringify([...rest, place]));
}

/** The saved place at a destination: a search result and a saved pin rarely match exactly. */
export const savedPlaceAt = (places: SavedPlace[], at: Coordinate) => places.find(place => distanceMeters(place.coordinate, at) <= 30) ?? null;
export const savedDestination = (place: SavedPlace): Destination => ({ id: `saved:${place.id}`, name: place.name, coordinate: place.coordinate });
