# Skopje Parking

[parking.vasojevich.com](https://parking.vasojevich.com/) is the app's website: the static pages in `website/` (home, `/privacy`, `/terms` and a working `/delete-account` form), deployed by Vercel. The API health check is https://vkqxtqcuoobiijbnpxod.supabase.co/functions/v1/api/health.

When the APK is uploaded, put its URL in the `href` of the two download buttons in `website/index.html` (`#apk-hero` and `#apk-download`) and remove `aria-disabled` from the second one.

Android/iOS parking application built with Expo 57 and React Native, with a browser preview and a shared API backed by SQLite locally or Supabase PostgreSQL when configured. All code lives in this folder; the website project was not edited.

## Run locally

Use Node.js 24 LTS (the API uses built-in SQLite).

```powershell
npm install
npm run api
```

In another terminal in the same folder:

```powershell
npm run web
```

Open http://localhost:8081 (HTTP, not HTTPS). `npm run web` uses localhost explicitly. The hosted API allows the browser origins `http://localhost:8081` and `http://127.0.0.1:8081`; HTTPS, LAN addresses, and other ports require an explicit matching entry in the API host's `ALLOWED_ORIGINS`. A rejected browser origin can show a server connection error even when the API is healthy. The local API runs at http://localhost:3001. First launch walks through language, appearance, account creation/sign-in or guest access, then Terms of Service. Initial access requires a connection; returning users can browse the saved catalog offline. Contributions require a connection.

For a physical Android or iPhone, run `npm start` and open the project with the matching Expo Go version. Set `EXPO_PUBLIC_API_URL` to your computer's LAN address, such as `http://192.168.1.10:3001`, in `.env`. Start the API with `$env:HOST='0.0.0.0'; npm run api` on a trusted local network. Allow the API port through the firewall if needed. Restart Expo after changing `.env`. The phone and computer must be on the same network. The default localhost API is not a public deployment.

## Implemented

- Skopje map with 866 geocoded OSM parking features: surface lots, garages, underground facilities and street parking, plus 13 official POC sector polygons.
- 36 published Gradski sign codes, with 34 approximate street/landmark labels on the map; exact boundaries remain unverified.
- One destination search field, offline street/landmark lookup, submitted online address search, map-picked destinations, automatic foreground location and a draggable action drawer.
- Nearest parking within 1.5 km, with published first-hour prices and separate dated driver reports.
- Spaces/full reports, conflicting-report display, expiry after 15 minutes, and refresh every 30 seconds.
- Immediate community parking and polygon contributions, zone labels, free/paid price reports, and confirmed sign details. Demo proposals also publish immediately, without session-age or vote requirements.
- Shared SQLite/PostgreSQL persistence, username/password onboarding, recorded Terms consent, native SecureStore credentials, request validation, rate limits, contributor-data deletion, and operator-scoped occupancy ingestion.
- Offline catalog cache, per-location and per-tariff source links, explicit coverage/access labels, Google Maps navigation handoff.
- 10-second arrival detection using fresh stationary GPS fixes, with availability first and an optional missing-price question. Opt-in background reminders use native location updates and local notifications; notification taps restore the same prompt.
- Persistent price reporting for facilities and zones, including free parking.

## Important data limits

This is a working first version, not a complete municipal parking register. OSM returned 867 features; one relation did not have importable coordinates, leaving 866 mapped features. OSM features can overlap and may represent private lots or grouped parking areas rather than distinct facilities. OSM coordinates may be feature centres rather than verified vehicle entrances. Exact Gradski sign locations and boundaries have not been established from the public text inventory. A42 was an example in the brief; no official record supporting it was found, so it was not invented.

Only three individual facilities currently have an independently matched official price: Beko, 26 July and Dom na Gradezhnici. POC sector prices and Gradski inventory prices are also shown, but sector centres are excluded from parking recommendations because they are not verified parking entrances. Unknown prices do not mean free parking. The latest driver price is labeled as reported; published tariffs remain available under Details. Clear MKD sign prices fill missing prices and are labeled as AI readings.

Prices are baseline estimates, not payment quotes: billing schedules, seasonal hours, holidays, pollution surcharges, permit exemptions and site-specific exceptions still need authoritative modeling. Walking distances are straight-line estimates. Availability reports are observations, not reservations. Government live feeds are supported but none is connected.

Usernames are unique across the shared database. New accounts use a password; existing device accounts can save a password under Account to preserve their username, points and contribution history after reinstalling. Passwords use salted scrypt hashes; login sessions are random, hashed on the server, expiring bearer tokens. Email password reset is not implemented. There is no proof of distinct people. The first demo trusts human contributions immediately. Set `DEMO_TRUST_INPUTS=false` to restore the legacy proposal confirmation policy; a production review policy for direct contributions still needs to be designed.

## Data refresh and operator integration

```powershell
python scripts/import-data.py --refresh
```

Without `--refresh`, the script rebuilds from `data/raw`. A refresh fetches public OSM/POC source snapshots, not a complete city inventory. Source data is in `data/catalog.json`, and operational data is in `data/runtime/parking.sqlite`. OSM data is ODbL; attribution is shown in the app. Confirm reuse permission for POC geometry and operator data before commercial publication. Leaflet CSS retains its upstream BSD license and uses custom marker graphics.

`npm run import:operator -- path/to/operator.json` validates a partner register and saves it under `data/partners`. Restart the API to load it. Imported operator records must use stable IDs; reconcile them with existing OSM records before delivery to avoid duplicate facilities. See [GOVERNMENT-INTEGRATION.md](docs/GOVERNMENT-INTEGRATION.md) for the exact format and occupancy endpoint.

See [RESEARCH.md](docs/RESEARCH.md) for competitors, sources and coverage findings, and [VALIDATION.md](docs/VALIDATION.md) for checks and limitations.

## Build Android and iOS

`eas.json` includes preview APK and production profiles. Configure your Expo/EAS project and developer accounts, set a deployed HTTPS API URL, and configure `GOOGLE_MAPS_ANDROID_KEY` as an EAS environment variable. Restrict the key to `mk.parkskopje.app` and its signing certificate. iOS uses Apple Maps by default. Android uses a bundled Leaflet/OpenStreetMap fallback when no Google Maps key is configured; it reuses the existing parking clustering and availability logic. Read the current [Expo map setup](https://docs.expo.dev/versions/v57.0.0/sdk/map-view/) before building.

```powershell
npx eas-cli@latest build --platform android --profile preview
npx eas-cli@latest build --platform ios --profile production
```

The phone-preview workflow produces a test-signed release APK; it is not an app-store release. The separate APK-only download server serves exactly one file and does not expose the API. See [ANDROID-PREVIEW.md](docs/ANDROID-PREVIEW.md). Development-client builds also require `expo-dev-client` through `npx expo install expo-dev-client`. A public launch needs the full operator register, verified tariffs/access, stronger identity/moderation, licensed production tiles, deployed API backups and actual device testing. The Android map ships a downloaded Skopje street map (see "Supabase-only backend" below); no tile server is used.

## Checks

```powershell
npm run test
npm run typecheck
npm run lint
npx expo-doctor
npx expo export --platform all
```

## Map-first update (2026-10-01)

The main screen is a full map, destination field and recenter control. The bottom drawer contains destination/add actions, drawn zones and nearby suggestions; the top-right menu contains settings. Parking is ranked within 1.5 km of the destination, or the current foreground location when no destination is chosen. Selecting a destination does not filter parking by its name. Clearing it returns to nearby mode.

The catalog contains 866 parking features, 13 POC sector polygons, 36 Gradski codes and 35 Gradski map labels (30 using operator map coordinates). Gradski's published list confirms D42 (MIDA), not A42. A02 remains in the inventory without a map anchor; A01 now uses the operator's published map point. Approximate labels are never used as parking entrances or arrival geofences. The offline street index uses an OSM snapshot. Online address lookup happens only on explicit submission, through the API's cached, throttled Nominatim search; configure server-only GEOCODER_URL to switch providers. No autocomplete requests are sent to Nominatim.

A GPS watch asks about availability after at least 10 seconds of fresh, accurate, stationary fixes inside a facility polygon (excluding holes), or within 25 m of a point-only facility. It resets for inaccurate fixes, large gaps, movement and departure. Cooldowns persist across restarts: six hours per location and 30 minutes between prompts. Background reminders are opt-in in Settings and need the rebuilt native app, Always/background location and notifications. The OS may delay location delivery; force-stop and some vendor task killers prevent reminders. Real GPS/background delivery still needs field testing.

Driver price reports accept first/subsequent-hour MKD amounts, including zero. They persist separately from official tariffs, are dated, and stay visible for 90 days. Reports for a zone are shared across its sectors with the same operator and code. Presence confirmations are separate from spaces/full reports. In the trusted demo, the latest No hides the location from the catalog without deleting it; a later Yes restores it. Contributor deletion removes both report types. Sharing requires the connected API; the offline-preview APK cannot submit reports.

Sources: https://www.gradskiparking.com.mk/zonsko-parking-zoni.nspx and https://www.gradskiparking.com.mk/javni-parkiralishta-i-zonsko.nspx. Street reference points come from OpenStreetMap, not surveyed sign positions.

## Community zones and sign reading

The API stores contributions, polygons, reports and confirmed sign details. Coordinates and polygon crossings are validated, and retries of the same submission do not duplicate records.

Sign photos never leave the phone. ML Kit (or the driver's own Gemini/Groq key) reads the photo, the driver checks every field against it, and only the confirmed details are sent (`POST /v1/places/:id/signs`, at most 64 KB, photos refused). The photo is deleted from the phone afterwards. Confirmed tariff-zone signs are inherited by contained parking areas when there is a single matching zone; conflicting overlaps are not guessed. Scalar prices are used only for explicitly read MKD hourly rates. Official source tariffs and human reports are retained; human label edits take precedence. Session deletion removes that session's sign details, label edits and reports, while published locations remain on the map.

Relevant endpoints: `POST /v1/contributions`, `POST /v1/places/:id/labels`, `POST /v1/places/:id/prices`, `POST /v1/places/:id/signs`, `POST /v1/signs/:id/flag` and `GET /v1/changes?since=`. Writes require an authenticated guest or named account with current Terms consent. `POST /v1/auth/guest`, `POST /v1/auth/login`, `GET/POST /v1/profile` and `GET /v1/usernames/availability` support onboarding.

### Zone editing and demo policy

Tap the map to add zone corners and drag a corner to correct it. Finish zone opens the name, label, price and photo form. To adjust a published zone, open its details → Edit price or zone → Edit boundary on map → Save zone. Edits use `PUT /v1/places/:id/boundary` and persist in SQLite independently of the source catalog. Everyone connected to the same API sees them on the next refresh (at most 60 seconds while the app is open); the saving client refreshes immediately. Public availability still requires hosting this API at a shared address, not each user's localhost.

`DEMO_TRUST_INPUTS=true` is the server default for this first demo. It removes proposal vote/age requirements and applies the latest human availability/presence report. Contributions, free prices, labels and boundaries publish immediately. This is intentionally not a production moderation policy. `false` restores the older proposal and availability consensus rules; direct-contribution review is future work.

The map requests fresh high-accuracy GPS. Desktop browsers may provide only a coarse network location; its accuracy circle makes that visible. The location button requests a fresh fix. The default Skopje center is never displayed as the user's location. A destination has a distinct red pin and name label; parking markers cluster until closer zoom.

## Supabase and mobile onboarding

Follow [SUPABASE.md](docs/SUPABASE.md) to connect a project, run `npm run db:migrate`, optionally migrate the existing SQLite demo data, and configure the hosted API. The Skopje Parking Supabase project is connected, with verified TLS, shared application tables and preserved demo accounts. The API runs as a Supabase Edge Function; see "Supabase-only backend" below.

Native GPS checks foreground permission and system location services, prompts Android to enable its location provider when needed, requests an initial fix for stationary devices, and restarts after returning from Settings. Denied permissions, disabled GPS, timeouts and browser-provider failures have distinct recovery messages. Browser previews require HTTPS (or localhost) and a functioning browser/OS location provider; retries cannot supply a provider the host does not have. Native GPS and camera behavior still require physical-device testing.

All native scroll indicators and web scrollbars are hidden while touch scrolling remains available. Parking forms use compact layouts and fixed Save buttons. Sign photo selection uses a custom in-app Camera/Gallery popup on every platform; the selected native camera or photo browser then opens. The current app requires onboarding even in a catalog-preview build; an offline-only APK is no longer a substitute for the connected multi-user demo.


## Contributions, accounts and rewards update

Every new parking and Details & update starts with manual entry or a sign photograph. Manual entry offers simple (zone, then price/free) and detailed (zone, price/free, total/free spaces, perimeter) paths. Optional steps can be skipped. Each completed step saves independently in the background; account-scoped drafts retain unfinished work and explicit retries. Sign capture needs no prior zone or price entry, and its local camera/gallery popup remains available offline. Upload and AI reading require a connection. Every reading has a digital preview and manual corrections before confirmation.

A facility with a boundary remains a facility; a tariff zone is explicitly selected. Draft fields survive drawing on the map. Settings opens one category at a time. Guest accounts can be upgraded to a password account while keeping their points and contributions. Guest identities alone are not recoverable after reinstalling.

Community free-space counts expire after 15 minutes; total capacity is durable. Full parking details offer the nearest accessible parking with a fresh spaces report. These are observations, not live sensors or reservations. Unknown counts never imply zero spaces.

Points are server-authoritative and recorded once per account and parking detail: parking 10, boundary 20, price 10, capacity 10, confirmed sign 25. Availability earns 3 points per parking per UTC day. Retried submissions cannot duplicate points. Account shows the total and recent events; points have no monetary value.

Rewards unlock without spending points: Ocean palette at 40, Plum at 120, Gold contribution accents at 100, and Violet at 250. The server validates unlocks and only applies a contribution accent to parking created by that account. Availability colors remain separate. Selections survive guest upgrades and password sign-in.

Apply every checked-in migration before deploying the updated API. The new tables remain in the private `parkskopje` schema. Run `npm test`, `npm run typecheck`, `npm run lint`, and `npx expo-doctor`. Implementation plans and review notes are in `docs/plans/`.

A separate USB test build can be installed alongside the existing app:

```powershell
node --env-file-if-exists=.env --import tsx scripts/device-test-api.ts
# Another terminal:
.\scripts\build-apk.ps1 -DeviceTest -ApiUrl http://127.0.0.1:3002
adb reverse tcp:3002 tcp:3002
adb install -r preview/SkopjeParking-device-test.apk
```

The isolated test server uses SQLite under `data/runtime/device-test.sqlite`, never the shared database. That explicit `-DeviceTest` build needs USB forwarding. For the normal **Parking Test** app (`mk.parkskopje.app.dev`) use `scripts/build-apk.ps1 -TestPackage -ApiUrl https://vkqxtqcuoobiijbnpxod.supabase.co/functions/v1/api`, producing `preview/SkopjeParking-test-connected.apk`. It works over Wi-Fi/mobile data without USB. Preserve its signing identity when updating an existing installation.

Local builds use a single-use Gradle process and compile Kotlin in that process. The script also requests Gradle shutdown on success or failure, so builders do not stay resident after compilation. Generated projects and caches remain on disk for inspection.

## Load and field-test hardening (2026-10-07)

A 300-driver simulation (onboarding, reports, prices, contributions with retries, signs, removals, account lifecycle, hostile input) and headless phone-sized UI runs found and fixed the following. Server behavior:

- Rate limits for requests with a valid session are keyed by account, not IP, because Macedonian mobile carriers put many drivers behind one public IP (CGNAT). Unknown tokens and anonymous requests are still limited per IP; sign-in stays IP-limited. The former process-wide 3,000 requests/minute cap was removed: 300 simultaneous drivers locked out everyone, `/health` included, and on Vercel it was a single hot Postgres row. `/health` is no longer rate limited.
- Phones sync only changed places (`/v1/changes`, see "Supabase-only backend"); a driver's own write triggers an immediate sync.
- The catalog is built with a fixed number of queries on SQLite as on PostgreSQL (about 6x faster); photo and reward lookups no longer scan whole tables per parking.
- Address searches wait up to about 4.5 s for the one-per-second Nominatim slot instead of failing. Deliberate 503 messages are shown instead of "Server error".
- Removing your own parking also removes every point earned on it, so create-collect-remove cannot be repeated for points.
- Up to 64 password hashes queue during a sign-up burst instead of failing with "Authentication is busy".

App behavior:

- At a parking (precise GPS within 150 m), its popup offers "At this parking now? Has spaces / Full". Drivers who find a lot full usually leave before the 10-second arrival question, so full lots were under-reported.
- Tariff zones never ask about free spaces (the API rejects zone availability); they only ask for a missing price. Previously the unanswerable question also blocked the SMS payment offer.
- Search matches Cyrillic and Latin spellings, with or without diacritics or digraphs (`plostad`, `ploshtad`, `Плоштад`).
- Drawing the perimeter during a new detailed entry keeps the typed zone, price and spaces.
- Confirmed sign prices count in the nearby list and Cheapest sort.
- Without network, the app reports offline after three failed checks (a few seconds) instead of 75 s; a server that answers but is still waking keeps the longer wait.
- Saving a guest account or renewing Terms does not re-offer the optional license plate.
- Web "Go" no longer asks for notification permission when the server has no Web Push keys.
- The offline catalog copy is written at most every 5 minutes, and immediately after the driver's own change, instead of 1 MB on every 30-second refresh.
- Background arrival notifications and the rewards "points to go" label are translated for Turkish and Albanian.
- A drawn tariff zone's pin is placed inside the zone instead of on its first corner.

Android (verified on an API 36 emulator with an x86_64 QA build against an isolated local API):

- The Leaflet/OpenFreeMap map was blank in release builds: the WebView HTML injects helper functions with `toString()`, and Hermes returns `{ [bytecode] }` for them, so the whole map script failed (no basemap, no pins). Each injected function now starts with Hermes' `"show source"` directive; `tests/webview-injection.test.ts` guards new ones.
- Declining Google's "Location Accuracy" dialog brought it back about every 5 seconds. It is now offered once per launch; GPS works without it.
- Back closes the parking popup or leaves zone/perimeter drawing before it leaves the app.
- If Android kills the map WebView's renderer (low memory, often while another navigation app is open), the map reloads instead of staying blank.
- The native map no longer loads OSM's public raster tiles underneath the vector basemap on every launch (OSM's tile policy does not allow distributed apps to use them by default). Raster tiles remain the fallback when the vector map cannot load; set `EXPO_PUBLIC_TILE_URL` to use a licensed raster provider instead.
- The emulator runs x86_64; the release build lists only ARM ABIs, so QA used `-PreactNativeArchitectures=x86_64` on the generated project.

## Skopje SMS payment, own-key sign reading and Play readiness (2026-10-08)

SMS payment:

- `src/domain/skopje-rules.ts` holds the operators' published rules (checked 2026-10-08, sources inline): Gradski Parking zones send `ZONE PLATE` to 144144 and end with `S`; POC zones send `zone PLATE hours` to 141414 (1–2 hours; POC sends its own reminder). A3–A8 allow 2 hours and B zones 4 hours. Paying hours follow Gradski Parking's Centar (seasonal), Aerodrom and Sredno Vodno timetables; Sundays and the 2026–2027 public holidays are free except at Vodno. The rules expire a year after checking, so stale rules stop rather than mislead.
- All 48 operator zones get the official protocol from the catalog id (a community relabel cannot change the SMS). SMS rules come only from the operators' published rules: sign photos are not kept, so a protocol read from a photo could never be checked again.
- "Pay parking" (map, bottom right) lists nearby payable zones, nearest first; a zone's popup has "Pay by SMS". The driver must tick "The sign at my car shows zone …" before the composer opens, can add a licence plate there (kept on the device), and gets a reminder 15 minutes before an A/B zone's time limit.
- Automatic offers inside a POC sector stay quiet within 300 m of a Gradski street zone (GPS cannot tell the two operators' streets apart) and on Sundays, holidays and 23:00–07:00 when POC hours are unknown.
- Licence plates accept the older three-digit series (`SK123AB`).

Sign reading is bring-your-own-key: Settings → Sign reading (AI) stores a Google Gemini or Groq key in the phone's keystore. Photos go straight from the phone to that provider (`gemini-3.8-flash`, falling back to 3.7; Groq `qwen/qwen3.8-27b` with strict JSON); only the confirmed details reach the server. The server no longer uses `GEMINI_API_KEY` unless `SERVER_SIGN_READER=1`. Without a key, drivers enter the details by hand.

GPS: Android's approximate-only permission is detected and explained, with an "Allow precise location" upgrade; jumps that no car could make within 10 s are ignored; in garages and underground lots the last precise fix from 10 minutes earlier still allows "Has spaces / Full".

Sign-in limits count only failed attempts: 8 per username and 100 per IP in 15 minutes, so drivers behind one carrier IP never block each other. New sessions allow 300 per IP per hour.

Smaller fixes: a second tap is required for prices above 300 MKD/hour; generated "Parking near …" names are translated for Turkish and Albanian; dialog Close/Back labels follow the app language.

Google Play: store builds omit background location (set `SKOPJE_PARKING_BACKGROUND_LOCATION=1` only after Play approves the declaration), and unused permissions are blocked. Public sign details can be reported; two reports hide them until an admin decides (`GET /v1/admin/flags`, `DELETE /v1/admin/signs/:id`). `/delete-account` is the public deletion page. Terms changed (version 2026-10-08). See `docs/PLAY-STORE.md` for the release checklist, declarations and Data safety answers.

### Sign reading without any key (2026-10-09)

Sign photos are read on the phone with Google ML Kit text recognition (`expo-text-extractor`, model delivered by Play services and requested at install by `plugins/with-mlkit-ocr.js`). `src/domain/sign-ocr.ts` turns the text into zone, operator, hourly price, paying hours, weekend rule and time limit. ML Kit's Latin model reads Cyrillic as look-alike letters ("Недела" → "HEAEnA"), so lines are matched by letter shape; unlabelled time rows follow the Skopje order (weekdays, then Saturday). OCR readings always open in "compare every field" review. A driver's own Gemini/Groq key, if added, is tried first for hard signs. Nothing is sent to a server for reading.

## Supabase-only backend, bandwidth and the offline map (2026-10-09)

Nothing runs on Vercel any more except the static website (`vercel.json`, including `/delete-account`). The phone app talks only to Supabase.

- **API**: the same Fastify API runs as the Supabase Edge Function `api` (`server/edge.ts`, served by `supabase/functions/api/index.ts`). `npm run build:function` bundles it with esbuild into one file (catalog and database CA included, local SQLite stubbed out). Deploy with `npm run deploy:function` (`--no-verify-jwt`: the app uses its own session tokens). The phone URL is `https://vkqxtqcuoobiijbnpxod.supabase.co/functions/v1/api`. Function secrets: `DATABASE_URL` (transaction pooler, port 6543, `parkino_api` role), `DATABASE_POOL_MODE=transaction`, `NODE_ENV=production`, `ALLOWED_ORIGINS` (the website), `ADMIN_API_KEY`, and optionally `CRON_SECRET`, `WEB_PUSH_*`, `EXPO_ACCESS_TOKEN`.
- **Seeding**: the function never seeds on cold start. `npm run db:migrate` applies migrations and then upserts `data/catalog.json`; run it whenever the catalog changes. Changed places reach phones as deltas.
- **Delta sync**: database triggers mark every changed place in `place_changes` (one row per place). Phones keep the whole map and call `GET /v1/changes?since=<cursor>` every 60 seconds while open (not in the background) and right after their own writes; an unchanged map costs about 80 bytes. The first launch downloads everything once (about 100 KB gzipped). The cursor trails the clock by 15 seconds so a write committed late is never skipped. Zone price changes also send the zone's other sectors and the parkings inside it. Proposals refresh every 5 minutes.
- **Compression**: the function gzips JSON responses (846 KB → 99 KB for the full map).
- **Photos**: never uploaded or stored (no Supabase Storage). The picker's cache copy and the resized working copy are deleted after review. Migration `20261009120000_sign_readings_sync.sql` keeps confirmed readings and drops the old photo tables.
- **Offline map**: `node scripts/update-offline-map.mjs` downloads Skopje's OpenFreeMap vector tiles (zoom 0–14, the map overzooms) and the Noto Sans glyphs into `assets/offline-map` (about 16 MB). `plugins/with-offline-map.js` copies them into the APK; the map reads them through an `offline://` protocol, with no tile server and no network. Run the script and rebuild the app when you want fresher streets. A build without the files falls back to OpenFreeMap online. OpenStreetMap's licence requires visible credit: it shows for 6 seconds when the map opens, then folds into an ⓘ button.
- **Checked locally**: the bundled function under Deno 2.9 against PGlite, with 300 simulated drivers (60 sharing one carrier IP): all requests succeeded and every phone's delta-built map matched a fresh download.

