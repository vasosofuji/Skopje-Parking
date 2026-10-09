import { api } from "./api";
import type { ParkingPlace } from "../domain/types";
import { requestBrowserNotifications } from "./browserNotifications";

// Learn once per app load whether this server can send Web Push, so Go never asks for a
// notification permission the server cannot use (Safari needs the request inside the tap).
let serverKey: string | null | undefined;
void api.notificationConfig().then(config => { serverKey = config.webPushPublicKey; }, () => {});

export async function startDestinationAlerts(place: ParkingPlace, language: "en" | "mk") {
  if (serverKey === null) return null;
  const [worker, watcher] = await Promise.all([requestBrowserNotifications(), api.destinationWatcher().then(async client => { await client.stop(); return client; })]);
  if (!("PushManager" in window)) throw new Error("This browser does not support background destination alerts. On iPhone, add Parking to your Home Screen first.");
  const config = serverKey ? { webPushPublicKey: serverKey } : await api.notificationConfig();
  if (!config.webPushPublicKey) throw new Error("Web notifications are not configured on this server yet.");
  const key = Uint8Array.from(atob(config.webPushPublicKey.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  const subscription = await worker.pushManager.getSubscription() ?? await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const value = subscription.toJSON();
  if (!value.endpoint || !value.keys?.p256dh || !value.keys.auth) throw new Error("This browser could not register notifications. Try again in browser settings.");
  return watcher.start(place.id, language, { type: "web", subscription: { endpoint: value.endpoint, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } } });
}
export const stopDestinationAlerts = () => api.stopDestinationWatch();
