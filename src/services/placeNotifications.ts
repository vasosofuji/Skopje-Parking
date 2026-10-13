import Constants from "expo-constants";
import { isRunningInExpoGo, requireOptionalNativeModule } from "expo";
import { AppState, Platform } from "react-native";
import type * as NotificationTypes from "expo-notifications";

/** Server pushes about a place: "destination reported full" and "a spot may open soon". */
const KINDS = ["parking-destination-full", "parking-spot-opening"];
// Android builds without Firebase receive no server pushes, so nothing here runs or asks for anything.
const native = Platform.OS !== "web" && (Platform.OS !== "android" || Constants.expoConfig?.extra?.androidPush === true) &&
  !isRunningInExpoGo() && Boolean(requireOptionalNativeModule("ExpoPushTokenManager"));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Notifications: typeof NotificationTypes | null = native ? require("expo-notifications") : null;

/** Opens the app on the place a tapped push is about, including the tap that launched the app. */
export function listenForPlaceNotifications(open: (placeId: string) => void) {
  if (!Notifications) return () => {};
  // Runs after backgroundArrival installed its handler at import, so this replaces it: the same rule
  // (banners while the app is in the background) plus a banner and sound for these pushes in the foreground.
  Notifications.setNotificationHandler({
    handleNotification: async notification => {
      const remote = KINDS.includes(String(notification.request.content.data?.kind));
      return { shouldShowBanner: remote || AppState.currentState !== "active", shouldShowList: true, shouldPlaySound: remote, shouldSetBadge: false };
    },
  });
  const respond = (response: NotificationTypes.NotificationResponse) => {
    const data = response.notification.request.content.data;
    if (!KINDS.includes(String(data?.kind)) || typeof data?.placeId !== "string") return;
    void Notifications.clearLastNotificationResponseAsync().catch(() => {});
    open(data.placeId);
  };
  const last = Notifications.getLastNotificationResponse();
  if (last) respond(last);
  const subscription = Notifications.addNotificationResponseReceivedListener(respond);
  return () => subscription.remove();
}
