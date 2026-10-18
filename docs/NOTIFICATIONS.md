# Parking notifications

Destination monitoring is stored by the API for 90 minutes after **Go**. A full report from another account queues one warning, describing it as a driver report rather than guaranteed availability. Another destination replaces the watch. Reports from the navigating account do not notify that account. Delivery retries use a durable database lease, with a maximum of five attempts; expired subscriptions are removed.

Apply the new `destination_alerts` migration with the existing database migration workflow before deploying the API. SQLite creates its development table automatically. Push targets stay in the private API schema, with RLS and no anonymous/authenticated Data API access.

## Web

Set server-only `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, and `WEB_PUSH_SUBJECT` (a `mailto:` operator contact or HTTPS URL). Generate the VAPID pair once using `web-push.generateVAPIDKeys()`. Keep the private key stable and private. The API exposes only the public key. The site must serve `public/parking-sw.js` at `/parking-sw.js` over HTTPS. On iOS, install the website on the Home Screen before enabling notifications. Permission denial and missing server configuration are shown in the parking preview; directions still open.

The service worker shows destination and spot pushes; tapping one opens the map on its place. Web Push can deliver them while the page is suspended and another navigation app is open, subject to browser/OS permission, connectivity and notification policies. Arrival reminders use browser geolocation, which cannot reliably run after a tab is suspended or closed. Settings explicitly explain this distinction. No timer-based background guarantee is made.

## Native (Android)

The server sends straight to Firebase Cloud Messaging (HTTP v1, `server/fcm.ts`); Expo's push service is not used on Android. Firebase is only the delivery pipe. Builds without `google-services.json` (or the EAS file variable `GOOGLE_SERVICES_JSON`) set `extra.androidPush=false` and skip remote alerts silently: no permission prompt, no error.

1. Firebase console: create a project, add Android apps `com.vasojevich.parking` and `com.vasojevich.parking.dev`, download `google-services.json` (it covers both) to the repository root. It is gitignored; for EAS builds upload it as the file variable `GOOGLE_SERVICES_JSON`.
2. Project settings > Service accounts > Generate new private key. Store the whole JSON as the Edge Function secret `FIREBASE_SERVICE_ACCOUNT`.

Phones register their FCM device token (`{ "type": "fcm", "token": ... }`) when the driver taps Go and re-register when Firebase rotates it. Unregistered or invalid tokens drop their watch. Tapping a destination or spot push opens the map on that place.

## Spot openings

When a driver pays by SMS in the app for a known number of hours, the phone sends `POST /v1/spot-openings` with only `{ placeId, endsAt }` (or `{ placeId, leaving: true }` for "I'm leaving my spot" and for a start-stop zone's stop SMS). About 5 minutes before the end, drivers whose active destination watch is that place, or public parking within about 300 m of it, get one push per opening, and at most one spot push per watch every 10 minutes, however openings move. A watch moved to another destination is matched again against open spots. The sharer's own watch is never alerted. "I'm leaving my spot" also stops the session on the phone; the opening is shared from that change. Openings expire 10 minutes after the end time; `DELETE /v1/spot-openings` withdraws one (Settings, "Share when my parking time ends", default on).

## Delivery operations

Full-report requests flush queued alerts immediately, and every API response flushes due alerts in the background. Long-running API servers retry every 30 seconds. In production, pg_cron calls `/internal/maintenance` every minute (migration `20261013120100_maintenance_cron.sql`, reading the Vault secrets `api_maintenance_url` and `api_cron_secret`, the latter equal to the function secret `CRON_SECRET`), so spot alerts go out on time without traffic. Do not rely on serverless resident timers. Push delivery is best effort: OS settings, offline devices, or provider rejection can prevent it, and provider acceptance is not proof the device displayed a banner.

No push keys, cloud credentials, deployments, or physical-device delivery have been configured by this change. Verify with two distinct signed-in sessions: Go in session A, report full in B, background A, observe one warning; repeat B's report and confirm no duplicate; change A's destination and confirm the old lot no longer alerts.
