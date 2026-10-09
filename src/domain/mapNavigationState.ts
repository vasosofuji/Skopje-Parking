import type { Coordinate, Destination } from "./types";
import type { ActiveParkingFilter } from "./parking-filters";
import { SKOPJE } from "./parking";

export type MapNavigationState = {
  destination: Destination | null;
  viewport: Coordinate;
  selected: string | null;
  anchor: Coordinate | null;
  sort: "nearest" | "cheapest";
  parkingFilters: ActiveParkingFilter[];
};
export const MAP_STATE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export function defaultMapNavigationState(): MapNavigationState {
  return { destination: null, viewport: SKOPJE, selected: null, anchor: null, sort: "nearest", parkingFilters: [] };
}
function coordinate(value: unknown): value is Coordinate {
  if (!value || typeof value !== "object") return false;
  const point = value as Coordinate;
  return Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
}
const filters: ActiveParkingFilter[] = ["free", "reviewed", "unreviewed", "spaces", "full", "surface", "garage", "underground", "street", "zone"];
export function parseMapNavigationState(raw: string | null, now = Date.now()): MapNavigationState | null {
  try {
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (value.version !== 1 || !Number.isFinite(value.savedAt) || now - value.savedAt > MAP_STATE_MAX_AGE || value.savedAt > now + 60000) return null;
    const state = defaultMapNavigationState(), input = value.state;
    if (!input || typeof input !== "object") return null;
    if (coordinate(input.viewport)) state.viewport = { latitude: input.viewport.latitude, longitude: input.viewport.longitude };
    if (input.destination && typeof input.destination.id === "string" && typeof input.destination.name === "string" && coordinate(input.destination.coordinate)) {
      state.destination = { id: input.destination.id.slice(0, 200), name: input.destination.name.slice(0, 300), coordinate: { latitude: input.destination.coordinate.latitude, longitude: input.destination.coordinate.longitude } };
    }
    if (typeof input.selected === "string" && input.selected.length <= 200) state.selected = input.selected;
    if (state.selected && coordinate(input.anchor)) state.anchor = { latitude: input.anchor.latitude, longitude: input.anchor.longitude };
    if (input.sort === "cheapest") state.sort = "cheapest";
    if (Array.isArray(input.parkingFilters)) state.parkingFilters = [...new Set(input.parkingFilters.filter((filter: unknown): filter is ActiveParkingFilter => filters.includes(filter as ActiveParkingFilter)))] as ActiveParkingFilter[];
    return state;
  } catch { return null; }
}

type Storage = { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<void> };
/** Each account gets an independent state; serialized writes cannot restore an older destination. */
export function createMapNavigationStore(storage: Storage, accountId: string) {
  const key = `parkskopje-map-navigation:${encodeURIComponent(accountId)}`;
  let snapshot = { ready: false, restored: false, state: defaultMapNavigationState() };
  let revision = 0, loading: Promise<void> | null = null, writes = Promise.resolve();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());
  const flush = () => {
    if (!snapshot.ready) return Promise.resolve();
    const raw = JSON.stringify({ version: 1, savedAt: Date.now(), state: snapshot.state });
    writes = writes.catch(() => {}).then(() => storage.setItem(key, raw));
    return writes;
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load: () => {
      if (snapshot.ready) return Promise.resolve();
      if (loading) return loading;
      const version = revision;
      loading = storage.getItem(key).catch(() => null).then(raw => {
        const saved = parseMapNavigationState(raw);
        snapshot = { ready: true, restored: Boolean(saved && version === revision), state: saved && version === revision ? saved : snapshot.state };
        notify();
        if (version !== revision) return flush();
      });
      return loading;
    },
    update: <K extends keyof MapNavigationState>(field: K, value: MapNavigationState[K] | ((previous: MapNavigationState[K]) => MapNavigationState[K])) => {
      const next = typeof value === "function" ? value(snapshot.state[field]) : value;
      if (Object.is(next, snapshot.state[field])) return;
      revision++;
      snapshot = { ...snapshot, state: { ...snapshot.state, [field]: next } };
      notify();
    },
    flush,
  };
}
