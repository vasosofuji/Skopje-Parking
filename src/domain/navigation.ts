import type { Coordinate } from "./types";

export const NAVIGATION_APPS = ["default", "google", "waze"] as const;
export type NavigationApp = typeof NAVIGATION_APPS[number];
export function isNavigationApp(value: unknown): value is NavigationApp {
  return value === "default" || value === "google" || value === "waze";
}
export function directionUrls(preference: NavigationApp, platform: string, point: Coordinate): string[] {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180)
    throw new Error("This parking location is invalid.");
  const coordinate = `${point.latitude},${point.longitude}`;
  const googleWeb = `https://www.google.com/maps/dir/?api=1&destination=${coordinate}&travelmode=driving`;
  const wazeWeb = `https://waze.com/ul?ll=${coordinate}&navigate=yes`;
  if (platform === "web") return [preference === "waze" ? wazeWeb : googleWeb];
  if (preference === "waze") return [`waze://?ll=${coordinate}&navigate=yes`, wazeWeb];
  if (preference === "google") return [platform === "ios" ? `comgooglemaps://?daddr=${coordinate}&directionsmode=driving` : `google.navigation:q=${coordinate}&mode=d`, googleWeb];
  return platform === "ios"
    ? [`https://maps.apple.com/?daddr=${coordinate}&dirflg=d`, googleWeb]
    : [`geo:0,0?q=${coordinate}`, googleWeb];
}

export async function openDirections(preference: NavigationApp, platform: string, point: Coordinate, open: (url: string) => Promise<unknown>): Promise<void> {
  const urls = directionUrls(preference, platform, point);
  for (const url of urls) {
    try { await open(url); return; }
    catch { /* The selected app may not be installed; its web route is next. */ }
  }
  throw new Error("Could not open navigation. Please try again.");
}

const KEY = "parkskopje-navigation-app";
type PreferenceStorage = { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<void> };
export function createNavigationPreferences(storage: PreferenceStorage) {
  let current: NavigationApp = "default", revision = 0, loaded = false;
  let pending: Promise<void> | null = null, writes = Promise.resolve();
  const listeners = new Set<() => void>();
  function update(value: NavigationApp) { if (current !== value) { current = value; listeners.forEach(listener => listener()); } }
  return {
    current: () => current,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load: () => {
      if (loaded) return Promise.resolve();
      if (pending) return pending;
      const version = revision;
      pending = storage.getItem(KEY).then(value => { if (version === revision && isNavigationApp(value)) update(value); loaded = true; }).finally(() => { pending = null; });
      return pending;
    },
    set: (value: NavigationApp) => {
      if (!isNavigationApp(value)) return Promise.reject(new Error("Choose a supported navigation app."));
      const work = writes.catch(() => {}).then(async () => {
        await storage.setItem(KEY, value);
        revision++; loaded = true; update(value);
      });
      writes = work;
      return work;
    },
  };
}
