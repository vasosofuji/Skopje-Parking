# Parking notifications

Destination monitoring is stored by the API for 90 minutes after **Go**. A full report from another account queues one warning, describing it as a driver report rather than guaranteed availability. Another destination replaces the watch. Reports from the navigating account do not notify that account. Delivery retries use a durable database lease, with a maximum of five attempts; expired subscriptions are removed.

Apply the new `destination_alerts` migration with the existing database migration workflow before deploying the API. SQLite creates its development table automatically. Push targets stay in the private API schema, with RLS and no anonymous/authenticated Data API access.

## Web

Set server-only `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, and `WEB_PUSH_SUBJECT` (a `mailto:` operator contact or HTTPS URL). Generate the VAPID pair once using `web-push.generateVAPIDKeys()`. Keep the private key stable and private. The API exposes only the public key. The site must serve `public/parking-sw.js` at `/parking-sw.js` over HTTPS. On iOS, install the website on the Home Screen before enabling notifications. Permission denial and missing server configuration are shown in the parking preview; directions still open.

Web Push can deliver destination warnings while the page is suspended and another navigation app is open, subject to browser/OS permission, connectivity and notification policies. Arrival reminders use browser geolocation, which cannot reliably run after a tab is suspended or closed. Settings explicitly explain this distinction. No timer-based background guarantee is made.

## Native

Use a development or production build containing Expo Notifications, an EAS project ID in app configuration, and configured FCM/APNs push credentials for that project. Expo Go cannot register these alerts. The existing notification config plugin applies on the next native build. Optional Expo enhanced push security uses the server-only `EXPO_ACCESS_TOKEN`.

## Delivery operations

Full-report requests flush queued alerts immediately. Long-running API servers retry every 30 seconds. Vercel attaches retries to request lifecycles; the existing authenticated `/internal/sign-jobs` endpoint also flushes them. Configure an external scheduler to invoke that endpoint every minute using its existing cron secret for retries during periods without traffic (the repository's daily sign-job cron is insufficient for timely retries). Do not rely on serverless resident timers. Push delivery is best effort: OS settings, offline devices, or provider rejection can prevent it, and provider acceptance is not proof the device displayed a banner.

No push keys, cloud credentials, deployments, or physical-device delivery have been configured by this change. Verify with two distinct signed-in sessions: Go in session A, report full in B, background A, observe one warning; repeat B's report and confirm no duplicate; change A's destination and confirm the old lot no longer alerts.
