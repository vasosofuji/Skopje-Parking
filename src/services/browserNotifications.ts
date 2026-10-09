export function browserNotificationsSupported() {
  return typeof window !== "undefined" && window.isSecureContext && "Notification" in window && "serviceWorker" in navigator;
}
export async function browserNotificationWorker() {
  if (!browserNotificationsSupported()) throw new Error("This browser needs HTTPS and notification support. On iPhone, add Parking to your Home Screen first.");
  await navigator.serviceWorker.register("/parking-sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}
export async function requestBrowserNotifications() {
  if (!browserNotificationsSupported()) throw new Error("This browser needs HTTPS and notification support. On iPhone, add Parking to your Home Screen first.");
  // Request before awaiting any network/storage work: Safari requires a user gesture.
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Allow notifications in this site's browser settings to receive parking alerts.");
  return browserNotificationWorker();
}
