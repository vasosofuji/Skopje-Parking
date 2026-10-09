/* Notifications only: do not cache live parking data or API credentials. */
self.addEventListener("push", event => {
  let message;
  try { message = event.data.json(); } catch { return; }
  if (message?.data?.kind !== "parking-destination-full" || typeof message.data.placeId !== "string") return;
  event.waitUntil(self.registration.showNotification(message.title, {
    body: message.body, tag: `destination-${message.data.placeId}`, data: message.data,
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
    // Persist arrival tap data until a newly opened page can consume it.
    const url = data?.kind === "parking-arrival" ? `/?arrival=${encodeURIComponent(data.placeId)}&arrivalAt=${data.createdAt}` : "/";
    await self.clients.openWindow(url);
  })());
});
