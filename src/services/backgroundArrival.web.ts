import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Fix } from "../domain/arrival";
import { advanceArrival, acknowledgeArrivalReport, ARRIVAL_REMINDER_KIND, freshPendingArrival, openArrivalNotification } from "../domain/backgroundArrival";
import type { ParkingPlace } from "../domain/types";
import { arrivalTransaction, backgroundArrivalEnabled, clearArrivalStorage, readArrivalCatalog, readArrivalState, saveArrivalState, saveBackgroundArrivalEnabled } from "./arrivalStorage";
import { browserNotificationWorker, browserNotificationsSupported, requestBrowserNotifications } from "./browserNotifications";
import { createReminderWatch } from "../domain/reminderWatch";

const settings = new Set<() => void>();
const prompts = new Set<() => void>();
let generation = 0;
export function observeBackgroundArrivalSettings(listener: () => void) { settings.add(listener); return () => { settings.delete(listener); }; }
export function observePendingArrival(listener: () => void) { prompts.add(listener); return () => { prompts.delete(listener); }; }
export async function getBackgroundArrivalStatus() {
  const enabled = await backgroundArrivalEnabled();
  return { supported: browserNotificationsSupported() && Boolean(navigator.geolocation), enabled, running: watch.running() };
}
async function notify(place: ParkingPlace, data: { placeId: string; createdAt: number; notificationId: string }) {
  const worker = await browserNotificationWorker();
  const english = await AsyncStorage.getItem("parkskopje-language") === "en";
  await worker.showNotification(english ? "Hey, is there parking here?" : "Еј, има ли слободно место тука?", {
    body: english ? `${place.nameEn ?? place.name} · One quick answer helps other drivers.` : `${place.name} · Еден краток одговор им помага на возачите.`,
    tag: data.notificationId, data: { kind: ARRIVAL_REMINDER_KIND, placeId: data.placeId, createdAt: data.createdAt },
  });
}
const watch = createReminderWatch(backgroundArrivalEnabled, () => navigator.geolocation.watchPosition(position => {
    // A browser can pause geolocation when hidden. Web Push destination alerts are independent.
    if (document.visibilityState !== "hidden") return;
    void arrivalTransaction(async () => {
      if (!await backgroundArrivalEnabled()) return;
      const before = await readArrivalState();
      const result = advanceArrival(before, [{ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, speed: position.coords.speed, timestamp: position.timestamp }], await readArrivalCatalog(), true);
      await saveArrivalState(result.state);
      if (result.place && result.state.pending) {
        try { await notify(result.place, result.state.pending); }
        catch { await saveArrivalState({ ...before, detector: { ...before.detector, candidate: null } }); }
      }
    }).catch(() => {});
  }, error => { if (error.code === 1) void disableBackgroundArrival().catch(() => {}); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }), id => navigator.geolocation.clearWatch(id));
async function monitor(version: number) {
  if (version !== generation) return;
  await watch.resume();
  settings.forEach(listener => listener());
}
export async function enableBackgroundArrival() {
  const version = ++generation;
  await requestBrowserNotifications();
  if (!navigator.geolocation) throw new Error("Location is unavailable in this browser.");
  await new Promise<void>((resolve, reject) => navigator.geolocation.getCurrentPosition(() => resolve(), error => reject(new Error(error.code === 1 ? "Allow location in this site's browser settings to enable arrival reminders." : "Your browser could not get a location. Try again near a window or outdoors.")), { enableHighAccuracy: true, timeout: 20000 }));
  await arrivalTransaction(async () => {
    if (version !== generation) return;
    await saveBackgroundArrivalEnabled(true);
    await monitor(version);
  });
  settings.forEach(listener => listener());
}
export async function resumeBackgroundArrival() {
  const version = generation;
  if (!browserNotificationsSupported() || !await backgroundArrivalEnabled()) return;
  if (version !== generation) return;
  if (Notification.permission !== "granted") return disableBackgroundArrival();
  await monitor(version);
}
export async function disableBackgroundArrival() {
  generation++;
  watch.stop();
  await arrivalTransaction(async () => {
    await saveBackgroundArrivalEnabled(false);
    await clearArrivalStorage();
    if (browserNotificationsSupported()) {
      const worker = await navigator.serviceWorker.getRegistration("/");
      const notifications = await worker?.getNotifications();
      notifications?.filter(item => item.data?.kind === ARRIVAL_REMINDER_KIND).forEach(item => item.close());
    }
  });
  settings.forEach(listener => listener());
}
export async function recordForegroundArrival(fix: Fix, places: ParkingPlace[], accountId?: string | null) {
  return arrivalTransaction(async () => {
    const result = advanceArrival(await readArrivalState(accountId), [fix], places, false);
    await saveArrivalState(result.state, accountId);
    return result.place;
  });
}
export async function resetArrivalCandidate(accountId?: string | null) {
  return arrivalTransaction(async () => { const state = await readArrivalState(accountId); await saveArrivalState({ ...state, detector: { ...state.detector, candidate: null } }, accountId); });
}
export async function consumePendingArrival(places: ParkingPlace[], accountId?: string | null) {
  return arrivalTransaction(async () => {
    const state = await readArrivalState(accountId), pending = freshPendingArrival(state.pending);
    if (!pending?.opened) return null;
    const place = places.find(item => item.id === pending.placeId) ?? (await readArrivalCatalog()).find(item => item.id === pending.placeId);
    if (!place) return null;
    await saveArrivalState({ ...state, pending: null }, accountId);
    return place;
  });
}
export function listenForArrivalNotifications(onOpen: () => void) {
  if (!browserNotificationsSupported()) return () => {};
  let active = true;
  const respond = (data: unknown) => {
    void arrivalTransaction(async () => {
      if (!active || !await backgroundArrivalEnabled()) return;
      const before = await readArrivalState(), after = openArrivalNotification(before, data);
      if (before === after) return;
      await saveArrivalState(after);
      if (active) { onOpen(); prompts.forEach(listener => listener()); }
    }).catch(() => {});
  };
  const handler = (event: MessageEvent) => { if (event.data?.type === "parking-notification") respond(event.data.data); };
  navigator.serviceWorker.addEventListener("message", handler);
  const query = new URL(window.location.href);
  if (query.searchParams.has("arrival")) {
    respond({ kind: ARRIVAL_REMINDER_KIND, placeId: query.searchParams.get("arrival"), createdAt: Number(query.searchParams.get("arrivalAt")) });
    query.searchParams.delete("arrival"); query.searchParams.delete("arrivalAt");
    window.history.replaceState(window.history.state, "", query);
  }
  return () => { active = false; navigator.serviceWorker.removeEventListener("message", handler); };
}

export async function markArrivalReported(placeId: string, accountId: string | null) {
  if (!accountId) return;
  await arrivalTransaction(async () => {
    const before = await readArrivalState(accountId);
    await saveArrivalState(acknowledgeArrivalReport(before, placeId), accountId);
  });
}
export const backgroundLocationBuild = true;
