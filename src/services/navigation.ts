import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import { Platform } from "react-native";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createNavigationPreferences, openDirections, type NavigationApp } from "../domain/navigation";
import type { Coordinate } from "../domain/types";

const preference = createNavigationPreferences(AsyncStorage);
export const prepareNavigationPreference = () => preference.load();
export const setNavigationPreference = (value: NavigationApp) => preference.set(value);
/** Finish hydration before exposing Go; a read failure still allows the phone default. */
export function useNavigationReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    void prepareNavigationPreference().catch(() => {}).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  return ready;
}
export function useNavigationPreference() {
  const current = useSyncExternalStore(preference.subscribe, preference.current, () => "default" as const);
  useEffect(() => { void prepareNavigationPreference().catch(() => {}); }, []);
  return current;
}
/** Call from the user's navigation press: the first URL opens without a storage await. */
export function openParkingDirections(point: Coordinate): Promise<void> {
  return openDirections(preference.current(), Platform.OS, point, Linking.openURL);
}
