import Constants from "expo-constants";
import { isRunningInExpoGo, requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";
import { api } from "./api";
import type { ParkingPlace } from "../domain/types";

export async function startDestinationAlerts(place: ParkingPlace, language: "en" | "mk") {
  const watcher = await api.destinationWatcher();
  await watcher.stop();
  if (isRunningInExpoGo() || !requireOptionalNativeModule("ExpoPushTokenManager")) throw new Error("Destination alerts need an updated development or production app build.");
  const Notifications = await import("expo-notifications");
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("parking-destination", { name: "Destination availability", importance: Notifications.AndroidImportance.HIGH });
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) throw new Error("Allow notifications in app settings to receive destination alerts.");
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error("Destination alerts need the app's EAS project configuration.");
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  return watcher.start(place.id, language, { type: "expo", token });
}
export const stopDestinationAlerts = () => api.stopDestinationWatch();
