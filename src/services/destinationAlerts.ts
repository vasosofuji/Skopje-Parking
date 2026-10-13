import Constants from "expo-constants";
import { isRunningInExpoGo, requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";
import { api } from "./api";
import { translate } from "../domain/language";
import type { ParkingPlace } from "../domain/types";

// The watch an Android push token belongs to, re-sent when Firebase rotates the token.
// ponytail: memory only; a rotation after an app restart waits for the next Go (watches last 90 minutes).
let watched: { placeId: string; language: "en" | "mk"; expiresAt: number } | null = null;
let tokenListener: { remove(): void } | null = null;

export async function startDestinationAlerts(place: ParkingPlace, language: "en" | "mk") {
  watched = null;
  const watcher = await api.destinationWatcher();
  await watcher.stop();
  // Builds without Firebase cannot get an Android push token; navigation works without alerts.
  if (Platform.OS === "android" && !Constants.expoConfig?.extra?.androidPush) return;
  if (isRunningInExpoGo() || !requireOptionalNativeModule("ExpoPushTokenManager")) throw new Error("Destination alerts need an updated development or production app build.");
  const Notifications = await import("expo-notifications");
  if (Platform.OS === "android") await Promise.all([
    Notifications.setNotificationChannelAsync("parking-destination", { name: "Destination availability", importance: Notifications.AndroidImportance.HIGH }),
    Notifications.setNotificationChannelAsync("parking-spots", { name: translate(language, "Spots opening nearby", "Места што се ослободуваат во близина"), importance: Notifications.AndroidImportance.HIGH }),
  ]);
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) throw new Error("Allow notifications in app settings to receive destination alerts.");
  if (Platform.OS === "android") {
    // The server sends straight to Firebase Cloud Messaging with this device token, not through Expo's push service.
    const result = await watcher.start(place.id, language, { type: "fcm", token: String((await Notifications.getDevicePushTokenAsync()).data) });
    watched = { placeId: place.id, language, expiresAt: result.expiresAt };
    tokenListener ??= Notifications.addPushTokenListener(({ data }) => {
      if (watched && watched.expiresAt > Date.now()) void api.watchDestination(watched.placeId, watched.language, { type: "fcm", token: String(data) }).catch(() => {});
    });
    return result;
  }
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error("Destination alerts need the app's EAS project configuration.");
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  return watcher.start(place.id, language, { type: "expo", token });
}
export const stopDestinationAlerts = () => { watched = null; return api.stopDestinationWatch(); };
