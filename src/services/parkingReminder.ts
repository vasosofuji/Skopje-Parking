import { isRunningInExpoGo } from "expo";
import { Platform } from "react-native";

export const PARKING_LIMIT_REMINDER = "parking-sms-limit";
/** Best effort: Play forbids exact alarms here, so Android may deliver it a few minutes late. */
export async function scheduleParkingLimitReminder(at: number, channel: string, title: string, body: string) {
  if (Platform.OS === "web" || isRunningInExpoGo() || !(at > Date.now())) return false;
  try {
    const Notifications = await import("expo-notifications");
    if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("parking-limit", { name: channel, importance: Notifications.AndroidImportance.HIGH });
    if (!(await Notifications.requestPermissionsAsync()).granted) return false;
    await Notifications.cancelScheduledNotificationAsync(PARKING_LIMIT_REMINDER).catch(() => {});
    await Notifications.scheduleNotificationAsync({ identifier: PARKING_LIMIT_REMINDER, content: { title, body }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: "parking-limit" } });
    return true;
  } catch { return false; }
}
export async function cancelParkingLimitReminder() {
  if (Platform.OS === "web" || isRunningInExpoGo()) return;
  try { await (await import("expo-notifications")).cancelScheduledNotificationAsync(PARKING_LIMIT_REMINDER); } catch {}
}
