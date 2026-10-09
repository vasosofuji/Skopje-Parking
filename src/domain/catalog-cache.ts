import type { Catalog, ParkingPlace, Proposal } from "./types";

export type CatalogChanges = { cursor: number; full: boolean; places: ParkingPlace[]; removed: string[]; trustInputs?: boolean };

const MAX_CACHE_CHARACTERS = 8_000_000;
const MAX_CACHE_AGE = 7 * 24 * 60 * 60 * 1000;
/** Zones, destinations and coverage stay bundled; only places sync. A change wins over a removal. */
export function applyCatalogChanges(catalog: Catalog, changes: CatalogChanges): Catalog {
  const trust = changes.trustInputs === undefined ? {} : { trustInputs: changes.trustInputs };
  if (changes.full) return { ...catalog, ...trust, places: changes.places };
  const updated = new Map(changes.places.map(place => [place.id, place])), removed = new Set(changes.removed);
  const known = new Set(catalog.places.map(place => place.id));
  const places = catalog.places.filter(place => updated.has(place.id) || !removed.has(place.id)).map(place => updated.get(place.id) ?? place);
  return { ...catalog, ...trust, places: [...places, ...changes.places.filter(place => !known.has(place.id))] };
}
/** The cursor is saved with the places it describes, so a restart asks only for what came after. */
export function encodeCatalogCache(catalog: Catalog, proposals: Proposal[], now = Date.now(), cursor = 0): string | null {
  const serialized = JSON.stringify({ version: 2, savedAt: now, cursor, catalog, proposals: proposals.slice(0, 1000) });
  return serialized.length <= MAX_CACHE_CHARACTERS ? serialized : null;
}
export function decodeCatalogCache(raw: string | null, minimumGeneration: string, now = Date.now()): { catalog: Catalog; proposals: Proposal[]; cursor: number } | null {
  if (!raw || raw.length > MAX_CACHE_CHARACTERS) return null;
  try {
    const value = JSON.parse(raw);
    if (value.version !== 2 || !Number.isSafeInteger(value.cursor) || value.cursor < 0 || !Number.isFinite(value.savedAt) || value.savedAt > now + 60_000 || now - value.savedAt > MAX_CACHE_AGE) return null;
    const catalog = value.catalog;
    if (!Array.isArray(catalog?.places) || catalog.places.length > 20_000 || !Array.isArray(catalog.zones) || typeof catalog.generatedAt !== "string" || catalog.generatedAt < minimumGeneration) return null;
    if (!Array.isArray(catalog.destinations) || !catalog.destinations.every((destination: { id?: unknown; name?: unknown; coordinate?: { latitude?: unknown; longitude?: unknown } }) => typeof destination?.id === "string" && typeof destination.name === "string" && Number.isFinite(destination.coordinate?.latitude) && Number.isFinite(destination.coordinate?.longitude))) return null;
    if (catalog.coverage?.complete !== false || !Array.isArray(catalog.coverage.bounds) || catalog.coverage.bounds.length !== 4 || !catalog.coverage.bounds.every(Number.isFinite) || !Array.isArray(catalog.coverage.notes) || !catalog.coverage.notes.every((note: unknown) => typeof note === "string")) return null;
    if (!catalog.places.every((place: { id?: unknown; coordinate?: { latitude?: unknown; longitude?: unknown } }) => typeof place?.id === "string" && Number.isFinite(place.coordinate?.latitude) && Number.isFinite(place.coordinate?.longitude))) return null;
    return { catalog, cursor: value.cursor, proposals: Array.isArray(value.proposals) ? value.proposals.slice(0, 1000) : [] };
  } catch { return null; }
}
