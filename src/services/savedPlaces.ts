import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useSyncExternalStore } from "react";
import { readSavedPlaces, type SavedPlace } from "../domain/saved-places";
import { serialQueue } from "./serial";

const KEY = "parkskopje-saved-places-v1";
const listeners = new Set<() => void>();
let places: SavedPlace[] = [], loading: Promise<void> | null = null;
const publish = (next: SavedPlace[]) => { places = next; listeners.forEach(listener => listener()); };
const serial = serialQueue();
// A failed read retries later and blocks writes, so an unreadable list is never overwritten.
const load = () => loading ??= AsyncStorage.getItem(KEY).then(raw => publish(readSavedPlaces(raw))).catch(error => { loading = null; throw error; });

/** Serialized: each change starts from the last saved list. */
export const changeSavedPlaces = (change: (current: SavedPlace[]) => SavedPlace[]) => serial(async () => {
  await load();
  const next = readSavedPlaces(JSON.stringify(change(places)));
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  publish(next);
});
/** Sign-out and "delete my data" clear saved places with the plate: they can reveal a home address. */
export const clearSavedPlaces = () => serial(async () => { await load().catch(() => {}); await AsyncStorage.removeItem(KEY); publish([]); });
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useSavedPlaces() {
  useEffect(() => { void load().catch(() => {}); }, []);
  return useSyncExternalStore(subscribe, () => places, () => places);
}
