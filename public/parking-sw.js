/* Notifications only: do not cache live parking data or API credentials. */
// Server pushes about a place: "destination reported full" and "a spot may open soon".
const PLACE_KINDS = ["parking-destination-full", "parking-spot-opening"];
self.addEventListener("push", event => {
  let message;
  try { message = event.data.json(); } catch { return; }
  if (!PLACE_KINDS.includes(message?.data?.kind) || typeof message.data.placeId !== "string") return;
  event.waitUntil(self.registration.showNotification(message.title, {
    body: message.body, tag: `${message.data.kind}:${message.data.placeId}`, data: message.data,
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const data = event.notification.data;
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      client.postMessage({ type: "parking-notification", data });
      await client.focus();
      return;
    }
    // Persist arrival tap data until a newly opened page can consume it; a place push opens the map on its place.
    const url = data?.kind === "parking-arrival" ? `/?arrival=${encodeURIComponent(data.placeId)}&arrivalAt=${data.createdAt}`
      : PLACE_KINDS.includes(data?.kind) ? `/?placeId=${encodeURIComponent(data.placeId)}` : "/";
    await self.clients.openWindow(url);
  })());
});
