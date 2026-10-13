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

const placeOf = (data: { kind?: unknown; placeId?: unknown } | null | undefined) =>
  PLACE_PUSH_KINDS.includes(String(data?.kind)) && typeof data?.placeId === "string" ? data.placeId : null;

/** Opens the app on the place a tapped push is about, including the tap that launched the app. */
export function listenForPlaceNotifications(open: (placeId: string) => void) {
  if (Platform.OS === "web") {
    // The web push worker (public/parking-sw.js) hands a tap to an open page; otherwise it opens /?placeId=.
    const worker = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
    if (!worker) return () => {};
    const message = (event: MessageEvent) => { const placeId = event.data?.type === "parking-notification" ? placeOf(event.data.data) : null; if (placeId) open(placeId); };
    worker.addEventListener("message", message);
    return () => worker.removeEventListener("message", message);
  }
  if (!Notifications) return () => {};
  // backgroundArrival installs the same rule when its native modules exist; builds with push only need this one.
  Notifications.setNotificationHandler({ handleNotification: async notification => notificationBehavior(notification.request, AppState.currentState === "active") });
  const respond = (response: NotificationTypes.NotificationResponse) => {
    const placeId = placeOf(response.notification.request.content.data);
    if (!placeId) return;
    void Notifications.clearLastNotificationResponseAsync().catch(() => {});
    open(placeId);
  };
  const last = Notifications.getLastNotificationResponse();
  if (last) respond(last);
  const subscription = Notifications.addNotificationResponseReceivedListener(respond);
  return () => subscription.remove();
}
