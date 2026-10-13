import Constants from "expo-constants";
import { isRunningInExpoGo, requireOptionalNativeModule } from "expo";
import { AppState, Platform } from "react-native";
import type * as NotificationTypes from "expo-notifications";
import { notificationBehavior, PLACE_PUSH_KINDS } from "./notificationPresentation";

// Android builds without Firebase receive no server pushes, so nothing here runs or asks for anything.
const native = Platform.OS !== "web" && (Platform.OS !== "android" || Constants.expoConfig?.extra?.androidPush === true) &&
  !isRunningInExpoGo() && Boolean(requireOptionalNativeModule("ExpoPushTokenManager"));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Notifications: typeof NotificationTypes | null = native ? require("expo-notifications") : null;

/** Opens the app on the place a tapped push is about, including the tap that launched the app. */
export function listenForPlaceNotifications(open: (placeId: string) => void) {
  if (!Notifications) return () => {};
  // backgroundArrival installs the same rule when its native modules exist; builds with push only need this one.
  Notifications.setNotificationHandler({ handleNotification: async notification => notificationBehavior(notification.request, AppState.currentState === "active") });
  const respond = (response: NotificationTypes.NotificationResponse) => {
    const data = response.notification.request.content.data;
    if (!PLACE_PUSH_KINDS.includes(String(data?.kind)) || typeof data?.placeId !== "string") return;
    void Notifications.clearLastNotificationResponseAsync().catch(() => {});
    open(data.placeId);
  };
  const last = Notifications.getLastNotificationResponse();
  if (last) respond(last);
  const subscription = Notifications.addNotificationResponseReceivedListener(respond);
  return () => subscription.remove();
}
