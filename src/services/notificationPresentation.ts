import type { NotificationBehavior, NotificationRequest } from "expo-notifications";

export const PARKING_LIMIT_REMINDER = "parking-sms-limit";
/** Server pushes about a place: "destination reported full" and "a spot may open soon". */
export const PLACE_PUSH_KINDS = ["parking-destination-full", "parking-spot-opening"];

/**
 * The one rule for showing notifications, whichever module installs the handler: banners while the app
 * is in the background; in the foreground only place pushes (with sound) and the time-limit reminder.
 */
export function notificationBehavior(request: Pick<NotificationRequest, "identifier" | "content">, appActive: boolean): NotificationBehavior {
  const place = PLACE_PUSH_KINDS.includes(String(request.content.data?.kind));
  return { shouldShowBanner: place || request.identifier === PARKING_LIMIT_REMINDER || !appActive, shouldShowList: true, shouldPlaySound: place, shouldSetBadge: false };
}
