import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createMapNavigationStore, type MapNavigationState } from "../domain/mapNavigationState";
import { SKOPJE } from "../domain/parking";
import type { Coordinate } from "../domain/types";

export function useMapNavigationState(accountId: string | null) {
  const store = useMemo(() => createMapNavigationStore(AsyncStorage, accountId ?? "signed-out"), [accountId]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [camera, setCamera] = useState({ store, point: SKOPJE });
  useEffect(() => {
    let active = true;
    void store.load().then(() => {
      const loaded = store.getSnapshot();
      if (active && loaded.restored) setCamera({ store, point: loaded.state.viewport });
    }).catch(() => {});
    return () => { active = false; };
  }, [store]);
  useEffect(() => {
    if (!snapshot.ready || !accountId) return;
    const timer = setTimeout(() => { void store.flush().catch(() => {}); }, 200);
    return () => clearTimeout(timer);
  }, [snapshot, store, accountId]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => { if (state !== "active" && accountId) void store.flush().catch(() => {}); });
    return () => { subscription.remove(); if (accountId) void store.flush().catch(() => {}); };
  }, [store, accountId]);
  const setters = useMemo(() => {
    const setter = <K extends keyof MapNavigationState>(field: K) => (value: MapNavigationState[K] | ((previous: MapNavigationState[K]) => MapNavigationState[K])) => store.update(field, value);
    return { setDestination: setter("destination"), setSelected: setter("selected"), setAnchor: setter("anchor"), setSort: setter("sort"), setParkingFilters: setter("parkingFilters"), rememberViewport: setter("viewport") };
  }, [store]);
  const setCenter = useCallback((point: Coordinate) => { store.update("viewport", point); setCamera({ store, point }); }, [store]);
  return { ...snapshot.state, ...setters, ready: snapshot.ready, restored: snapshot.restored, center: camera.store === store ? camera.point : SKOPJE, setCenter };
}
