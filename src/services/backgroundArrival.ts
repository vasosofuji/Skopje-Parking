import AsyncStorage from "@react-native-async-storage/async-storage";
import { isRunningInExpoGo, requireOptionalNativeModule } from "expo";
import Constants from "expo-constants";
import * as Location from "expo-location";
import { AppState, Platform } from "react-native";
import type * as NotificationTypes from "expo-notifications";
import type * as TaskManagerTypes from "expo-task-manager";
import type { Fix } from "../domain/arrival";
import {
  advanceArrival,
  acknowledgeArrivalReport,
  ARRIVAL_REMINDER_KIND,
  freshPendingArrival,
  openArrivalNotification,
} from "../domain/backgroundArrival";
import type { ParkingPlace } from "../domain/types";
import { isLanguage, translate, placeName, type Language } from "../domain/language";
import { startArrivalInForeground } from "./foregroundArrivalStart";
import { notificationBehavior } from "./notificationPresentation";
import { showWidgetZone } from "./parkingWidget";
import {
  arrivalTransaction,
  backgroundArrivalEnabled,
  clearArrivalStorage,
  readArrivalCatalog,
  readArrivalState,
  saveArrivalState,
  saveBackgroundArrivalEnabled,
} from "./arrivalStorage";

const TASK = "parkskopje-arrival-location-v1";
const CHANNEL = "parking-arrivals";
// Older installed builds must keep working until the new native build is installed.
// Store builds omit background location unless it was enabled for a Play-approved release.
export const backgroundLocationBuild = Platform.OS === "web" || Constants.expoConfig?.extra?.backgroundLocation === true;
const nativeAvailable = Platform.OS !== "web" && backgroundLocationBuild && !isRunningInExpoGo() &&
  Boolean(requireOptionalNativeModule("ExpoTaskManager")) &&
  Boolean(requireOptionalNativeModule("ExpoNotificationScheduler"));
// Synchronous imports are deliberate: defineTask must run before a headless task is delivered.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Tasks: typeof TaskManagerTypes | null = nativeAvailable ? require("expo-task-manager") : null;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Notifications: typeof NotificationTypes | null = nativeAvailable ? require("expo-notifications") : null;
const promptListeners = new Set<() => void>();
const settingsListeners = new Set<() => void>();
let preferenceGeneration = 0;
const savedLanguage = async (): Promise<Language> => { const saved = await AsyncStorage.getItem("parkskopje-language"); return isLanguage(saved) ? saved : "mk"; };

async function dismissReminder(notificationId: string) {
  if (!Notifications) return;
  await Promise.allSettled([
    Notifications.cancelScheduledNotificationAsync(notificationId),
    Notifications.dismissNotificationAsync(notificationId),
  ]);
}

// placeNotifications installs the same rule; whichever runs last, every notification shows the same way.
if (Notifications) Notifications.setNotificationHandler({ handleNotification: async notification => notificationBehavior(notification.request, AppState.currentState === "active") });

if (Tasks && !Tasks.isTaskDefined(TASK)) {
  Tasks.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error, executionInfo }) => {
    if (error || !data?.locations?.length || executionInfo.appState === "active" || AppState.currentState === "active") return;
    await arrivalTransaction(async () => {
      if (!Notifications || !await backgroundArrivalEnabled()) return;
      const places = await readArrivalCatalog();
      const before = await readArrivalState();
      const fixes = data.locations.map((location) => ({ ...location.coords, timestamp: location.timestamp }));
      const language = await savedLanguage();
      showWidgetZone(fixes.reduce((latest, fix) => fix.timestamp > latest.timestamp ? fix : latest), places, language, null);
      const result = advanceArrival(before, fixes, places, true);
      await saveArrivalState(result.state);
      if (before.pending && before.pending.notificationId !== result.state.pending?.notificationId)
        await dismissReminder(before.pending.notificationId);
      if (!result.place || !result.state.pending || !await backgroundArrivalEnabled()) return;
      const pending = result.state.pending;
      try {
        await Notifications.scheduleNotificationAsync({
          identifier: pending.notificationId,
          content: {
            title: translate(language, "Hey, is there parking here?", "Еј, има ли слободно место тука?"),
            body: `${placeName(result.place, language)} · ${translate(language, "One quick answer helps other drivers.", "Еден краток одговор им помага на возачите.")}`,
            data: { kind: ARRIVAL_REMINDER_KIND, placeId: pending.placeId, createdAt: pending.createdAt },
          },
          trigger: Platform.OS === "android" ? { channelId: CHANNEL } : null,
        });
      } catch {
        // Delivery failed: allow a later accurate fix to try again, without losing old cooldowns.
        await saveArrivalState({ ...before, detector: { ...before.detector, candidate: null } });
      }
    });
  });
}

export function observeBackgroundArrivalSettings(listener: () => void) {
  settingsListeners.add(listener);
  return () => { settingsListeners.delete(listener); };
}
export function observePendingArrival(listener: () => void) {
  promptListeners.add(listener);
  return () => { promptListeners.delete(listener); };
}

export async function getBackgroundArrivalStatus() {
  const enabled = await backgroundArrivalEnabled();
  if (!nativeAvailable) return { supported: false, enabled: false, running: false };
  const running = enabled && await Location.hasStartedLocationUpdatesAsync(TASK);
  return { supported: true, enabled, running };
}

async function startMonitoring(generation: number) {
  const language = await savedLanguage();
  return startArrivalInForeground({
    active: () => AppState.currentState === "active",
    allowed: () => generation === preferenceGeneration,
    // Register again on every activation: that restarts a foreground service the OS dropped
    // (a killed process gets back only throttled updates) and refreshes its language.
    running: async () => false,
    start: () => Location.startLocationUpdatesAsync(TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 5000,
    distanceInterval: 0,
    deferredUpdatesInterval: 0,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: translate(language, "Parking reminders are on", "Потсетниците за паркирање се вклучени"),
      notificationBody: translate(language, "Skopje Parking notices when you stop in a parking area. Turn this off anytime in Settings.", "Skopje Parking забележува кога ќе застанете на паркинг. Исклучете го ова во секое време во Поставки."),
      notificationColor: "#25785B",
      // Keep watching after the app is swiped away from Recents; only the opt-out stops it.
      killServiceOnDestroy: false,
    },
    }),
  });
}

/**
 * Settings opt-in. Android order: location, then `explain` (Play's prominent disclosure) before
 * "Allow all the time", which Android 11+ grants only on its settings page, then notifications.
 * Returns without enabling when the driver declines the explanation.
 */
export async function enableBackgroundArrival(explain: () => Promise<boolean> = async () => true) {
  const generation = ++preferenceGeneration;
  const language = await savedLanguage(), t = (en: string, mk: string) => translate(language, en, mk);
  if (!Notifications || !Tasks || !await Tasks.isAvailableAsync())
    throw new Error(t("Install the updated Skopje Parking app to enable background reminders.", "Инсталирајте ја ажурираната Skopje Parking апликација за потсетници во заднина."));
  if (!await Location.hasServicesEnabledAsync()) throw new Error(t("Turn on your phone's location services first.", "Прво вклучете ја локацијата на телефонот."));
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) throw new Error(t("Allow location access to use parking reminders.", "Дозволете пристап до локацијата за потсетниците за паркирање."));
  // Arrivals need a fix within 25 m; approximate location never gives one.
  if (foreground.android?.accuracy === "coarse") throw new Error(t("Turn on Precise location for Skopje Parking. Reminders cannot tell parking areas apart without it.", "Вклучете Прецизна локација за Skopje Parking. Без неа потсетниците не можат да ги разликуваат паркинзите."));
  if (!(await Location.getBackgroundPermissionsAsync()).granted) {
    if (!await explain() || generation !== preferenceGeneration) return;
    const background = await Location.requestBackgroundPermissionsAsync();
    if (!background.granted) throw new Error(t("Choose Allow all the time in the location settings for Skopje Parking.", "Изберете Дозволи цело време во поставките за локација за Skopje Parking."));
  }
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: t("Parking arrival reminders", "Потсетници при пристигнување на паркинг"),
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: null,
  });
  const permission = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: false } });
  if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL)
    throw new Error(t("Allow notifications to receive a reminder when the app is in the background.", "Дозволете известувања за да добиете потсетник кога апликацијата е во заднина."));
  await arrivalTransaction(async () => {
    // Logout/opt-out may have happened while the OS permission screens were open.
    if (generation !== preferenceGeneration) return;
    await saveBackgroundArrivalEnabled(true);
    try { await startMonitoring(generation); }
    catch {
      await saveBackgroundArrivalEnabled(false);
      throw new Error(t("Parking reminders could not start. Check location permissions and try again.", "Потсетниците не можеа да започнат. Проверете ги дозволите за локација и обидете се повторно."));
    }
  });
  settingsListeners.forEach((listener) => listener());
}

/** Resumes an existing opt-in without showing any permission prompts. */
export async function resumeBackgroundArrival() {
  if (!Notifications) return;
  const generation = preferenceGeneration;
  if (!await backgroundArrivalEnabled()) {
    // Retry cleanup if Android interrupted a previous opt-out while stopping the service.
    await arrivalTransaction(async () => {
      if (generation !== preferenceGeneration || await backgroundArrivalEnabled()) return;
      if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
    });
    return;
  }
  const [location, notifications] = await Promise.all([Location.getBackgroundPermissionsAsync(), Notifications.getPermissionsAsync()]);
  if (generation !== preferenceGeneration) return;
  if (!location.granted || (!notifications.granted && notifications.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL)) {
    await disableBackgroundArrival();
    return;
  }
  await arrivalTransaction(async () => {
    if (generation !== preferenceGeneration || !await backgroundArrivalEnabled()) return;
    await startMonitoring(generation);
  });
  settingsListeners.forEach((listener) => listener());
}

export async function disableBackgroundArrival() {
  // Cancel in-flight permission/start work immediately, before awaiting the storage queue.
  preferenceGeneration++;
  await arrivalTransaction(async () => {
    await saveBackgroundArrivalEnabled(false);
    const state = await readArrivalState();
    // Complete local cleanup even when the OS has already removed a task or notification.
    await Promise.allSettled([
      (async () => { if (nativeAvailable && await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK); })(),
      (async () => {
        if (Notifications) {
          const [scheduled, presented] = await Promise.all([
            Notifications.getAllScheduledNotificationsAsync(),
            Notifications.getPresentedNotificationsAsync(),
          ]);
          const reminders = new Set([
            ...scheduled.filter((item) => item.content.data?.kind === ARRIVAL_REMINDER_KIND).map((item) => item.identifier),
            ...presented.filter((item) => item.request.content.data?.kind === ARRIVAL_REMINDER_KIND).map((item) => item.request.identifier),
            ...(state.pending ? [state.pending.notificationId] : []),
          ]);
          await Promise.all([...reminders].map(dismissReminder));
        }
        Notifications?.clearLastNotificationResponse();
      })(),
    ]);
    await clearArrivalStorage();
  });
  settingsListeners.forEach((listener) => listener());
}

export async function recordForegroundArrival(fix: Fix, places: ParkingPlace[], accountId?: string | null) {
  return arrivalTransaction(async () => {
    const before = await readArrivalState(accountId);
    const result = advanceArrival(before, [fix], places, false);
    await saveArrivalState(result.state, accountId);
    if (before.pending && !result.state.pending) await dismissReminder(before.pending.notificationId);
    return result.place;
  });
}

export async function resetArrivalCandidate(accountId?: string | null) {
  return arrivalTransaction(async () => {
    const state = await readArrivalState(accountId);
    await saveArrivalState({ ...state, detector: { ...state.detector, candidate: null } }, accountId);
  });
}

export async function consumePendingArrival(places: ParkingPlace[], accountId?: string | null) {
  return arrivalTransaction(async () => {
    const state = await readArrivalState(accountId);
    const pending = freshPendingArrival(state.pending);
    if (!pending?.opened) return null;
    const place = places.find((item) => item.id === pending.placeId) ?? (await readArrivalCatalog()).find((item) => item.id === pending.placeId);
    if (!place) return null;
    await saveArrivalState({ ...state, pending: null }, accountId);
    await dismissReminder(pending.notificationId);
    return place;
  });
}

/** Only our stored reminder can route into the app; arbitrary notification URLs are ignored. */
export function listenForArrivalNotifications(onOpen: () => void) {
  if (!Notifications) return () => {};
  let active = true;
  const respond = (response: NotificationTypes.NotificationResponse) => {
    void arrivalTransaction(async () => {
      if (!active || !await backgroundArrivalEnabled()) return;
      const before = await readArrivalState();
      const after = openArrivalNotification(before, response.notification.request.content.data);
      if (after === before) return;
      await saveArrivalState(after);
      Notifications.clearLastNotificationResponse();
      if (active) {
        onOpen();
        promptListeners.forEach((listener) => listener());
      }
    }).catch(() => {});
  };
  const response = Notifications.getLastNotificationResponse();
  if (response) respond(response);
  const subscription = Notifications.addNotificationResponseReceivedListener(respond);
  return () => { active = false; subscription.remove(); };
}

export async function markArrivalReported(placeId: string, accountId: string | null) {
  if (!accountId) return;
  await arrivalTransaction(async () => {
    const before = await readArrivalState(accountId);
    await saveArrivalState(acknowledgeArrivalReport(before, placeId), accountId);
  });
}
