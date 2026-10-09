# Google Play release checklist

Checked against Play policy as of October 2026. Package `mk.parkskopje.app`, `targetSdkVersion` 36
(required for new apps and updates since 31 August 2026), `minSdkVersion` 24.

## Build

```bash
npx eas-cli@latest build --platform android --profile production
```

- `EXPO_PUBLIC_API_URL` must be the public HTTPS API (`eas.json` sets it; `app.config.ts` refuses anything else).
- Leave `PARKINO_BACKGROUND_LOCATION` unset. Store builds then contain no background location,
  no foreground location service and no background reminder setting (see "Background location").
- Check the merged manifest of the built AAB before uploading:
  `bundletool dump manifest --bundle app.aab | grep uses-permission`. The 2026-10-08 build has exactly:
  `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `CAMERA`, `INTERNET`, `ACCESS_NETWORK_STATE`,
  `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `VIBRATE`, `WAKE_LOCK`, the FCM `c2dm` receive
  permission, the Play install-referrer permission and launcher badge permissions (all normal,
  install-time permissions). It must **not** contain `ACCESS_BACKGROUND_LOCATION`,
  `FOREGROUND_SERVICE_LOCATION`, `SYSTEM_ALERT_WINDOW`, `READ_MEDIA_*`, `SEND_SMS` or `READ_SMS`
  (`app.config.ts` blocks them).

## Server release that must ship with this app version

1. Run `npm run db:migrate` (applies `20261009120000_sign_readings_sync.sql`, which keeps confirmed
   sign readings and **drops the old stored photos**, then seeds the catalog).
2. Deploy the API as the Supabase Edge Function: `npm run deploy:function` (see README, "Supabase-only
   backend"). `TERMS_VERSION` changed to `2026-10-09`, so existing users are asked to accept the
   updated Terms once; older app builds cannot create guests until updated.
3. The server needs no AI key. Sign photos are read on drivers' phones (ML Kit, or their own
   Gemini/Groq key) and are never uploaded.
4. Set `ADMIN_API_KEY` so reported sign details can be reviewed (see "User-generated content").

## Play Console declarations

**SMS / Call log permissions** — not needed. The app never requests `SEND_SMS`; it opens the phone's
own composer with the number and message filled in, and the driver presses Send.

**Location permissions declaration** — not needed while background location is off (foreground
"while using the app" only). If you later enable reminders with `PARKINO_BACKGROUND_LOCATION=1`, you
must submit the background-location declaration with a short video showing the in-app prominent
disclosure (Settings → Location & notifications → Enable parking reminders) and the core feature.

**Foreground service declaration** — not needed while background location is off.

**Financial features** — "My app doesn't provide any financial features". Parkino does not process
payments; parking is charged by the driver's mobile operator after the driver sends the SMS.

**Government apps / misrepresentation** — Parkino is not a government app. The store listing must
say it is independent and not affiliated with the City of Skopje, JP Gradski Parking or JP Parkinzi na
Opshtina Centar (the app says the same in Zones & sources and in the payment sheet). Do not use their
logos.

**Target audience** — 18+ (drivers). Not designed for children, so the Families policy does not apply.

**Content rating (IARC)** — no violence/sexual content; answer "Yes" to users sharing content (sign
details, parking reports) and "No" to user-to-user communication.

**Account deletion URL** — `https://<your web app domain>/delete-account` (public page in this repo,
`src/app/delete-account.tsx`). In-app: Settings → Privacy & data → Delete my contributor data.

**Sign reading** — text is recognised on the phone with Google ML Kit (no key, no AI). Optional AI
sign reading uses the driver's own Google Gemini or Groq API key; images go from the
device straight to that provider. The app does not generate content for others; every AI reading is
confirmed by the driver before it is published. Mention this in the listing ("optional AI sign
reading with your own free key").

## Data safety form

| Data type | Collected | Shared | Purpose | Notes |
|---|---|---|---|---|
| Precise location | Yes, optional | No | App functionality | Used on the device; coordinates leave the phone only when the driver adds a parking place or boundary. |
| Approximate location | Yes, optional | No | App functionality | Same as above. |
| User IDs (username) | Yes, optional | No | Account management | Guests have no username. |
| Photos | Only with the driver's own AI key; processed ephemerally | No | App functionality | Photos are read and deleted on the phone and never reach Parkino's servers. A driver who adds their own Gemini/Groq key sends the photo they are reading straight to that provider (user-initiated). Without a key, answer No. |
| Other user-generated content | Yes, optional | No | App functionality | Parking reports, prices, zone labels, sign details. |
| Device or other IDs | Yes, optional | No | App functionality | Push token, only when destination alerts are turned on. |
| App activity / interactions | No | No | — | No analytics SDKs. |
| App info and performance (diagnostics) | Yes | No | Analytics | Collected by Google's ML Kit SDK (device model, OS, app version, latency, error codes) when a sign photo is read on the phone. See https://developers.google.com/ml-kit/android-data-disclosure. |
| Financial info, contacts, messages | No | No | — | SMS is composed in the system app; the licence plate stays on the device. |

- Encrypted in transit: Yes (HTTPS only; cleartext is allowed only in `PARKINO_DEVICE_TEST` builds).
- Users can request deletion: Yes (in-app and the web URL above).
- Licence plate and the AI key are stored only on the device (keystore) and are not "collected".

## User-generated content

- Terms forbid faces, plates, private information and abusive content.
- Every public sign has **Report sign details** (wrong / offensive / personal information / spam).
  Two reports hide the details for everyone and remove them from the map data.
- Review reports: `GET /v1/admin/flags` with `Authorization: Bearer $ADMIN_API_KEY`.
  Delete sign details: `DELETE /v1/admin/signs/<reading id>`. Restore (clear reports):
  `DELETE /v1/admin/signs/<reading id>/flags`. Play expects reports to be acted on promptly.

## Store listing text to keep accurate

- Skopje only; prices and hours come from the community and the operators' published rules.
- "Pay by SMS opens your messaging app; standard SMS and parking charges apply."
- "Not affiliated with the City of Skopje, JP Gradski Parking or JP Parkinzi na Opshtina Centar."
- Optional AI sign reading needs your own free Gemini or Groq key.

## Yearly upkeep

`src/domain/skopje-rules.ts` holds the operators' SMS numbers, message formats, zone limits, paying
hours and public holidays (2026–2027). Its official SMS entries expire one year after
`SKOPJE_RULES_CHECKED`; re-check the operators' pages, update the file and the date before then.
