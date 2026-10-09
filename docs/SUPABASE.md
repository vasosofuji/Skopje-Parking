# Shared Supabase database

## Configured development project

Parkino Database (`vkqxtqcuoobiijbnpxod`), in the Parkino organization, is configured in `eu-west-2`. The local server connects through the verified TLS session pooler using the dedicated `parkino_api` role. Its password is only in the ignored `.env`; the downloaded CA is in `data/runtime/supabase-ca.crt`. This role can read and write application tables but cannot create schemas, change roles, bypass RLS, or write migration metadata. Apply future schema migrations through an administrator connection, not this runtime login.

The database contains 914 imported parking records and the existing local profile, session and report. SQLite remains unchanged, with a backup in `data/runtime/parking-before-supabase-20261001.sqlite`. RLS is enabled on every application table; only the server role has application policies. Anonymous and authenticated Supabase Data API roles have no access to this private schema.

The shared API is deployed at https://parkino-api-vaso.vercel.app on Vercel. Connected APKs use this HTTPS address; a local server is still available for development.

The app uses one authenticated parking API. Every phone reads and writes the same database through that API. `DATABASE_URL` selects Supabase PostgreSQL; without it the local API uses SQLite. Nothing is silently switched to a local database after a cloud connection failure.

## Connect a project

1. Create a Supabase project and save its database password privately.
2. In the project's **Connect** dialog, select the **Session pooler** PostgreSQL connection string (port 5432). This supports IPv4 hosts and the persistent Node API. Copy the complete string into the API host's `DATABASE_URL` environment variable. URL-encode special characters in the password. Keep it out of Git and out of all `EXPO_PUBLIC_*` variables.
3. If the connection requires the project's CA certificate, download it from Supabase's database settings and set `DATABASE_CA_FILE` to its path. TLS certificate verification stays enabled.
4. From this repository, run `npm run db:migrate`. This applies the versioned SQL migrations once, inside transactions.
5. To carry over local demo data, **stop the API**, then run `npm run db:import-local` before starting the Supabase-backed API for the first time. The destination must be empty. If only the public catalog has already been seeded, use `npm run db:import-local -- --merge-catalog`; existing catalog IDs are retained, and every other application table must still be empty. It copies parking, boundaries, photos, prices, usernames and hashed device credentials in one transaction and leaves SQLite untouched. Skip this step for a fresh demo.
6. Run the Node API on a host with HTTPS, with `DATABASE_URL`, `HOST=0.0.0.0`, `PORT`, `DEMO_TRUST_INPUTS=true`, and the browser site's origin in `ALLOWED_ORIGINS`. Install with `npm ci --include=dev` because the current server entry uses `tsx`; start with `npm run api`.
7. Set the mobile build's `EXPO_PUBLIC_API_URL` to that HTTPS API URL and rebuild/update the Expo app. On a physical phone, `localhost` refers to that phone, not the development PC. For LAN development, omit this variable so the app uses Expo's development host and bind the local API to `0.0.0.0`.

No Supabase public/service-role key is needed in the app. The private `parkskopje` schema is used by the server, outside Supabase's public Data API. Do not add it to exposed schemas. The mobile app never receives database credentials. Photos currently live in PostgreSQL `BYTEA`, so all API instances share both images and extraction jobs; each upload is capped at 2 MB.

## Demo identity and contributions

On first launch, a user chooses a username and explicitly accepts the current Terms version. The server stores acceptance time and version. A unique database index on the normalized, case-insensitive username prevents concurrent registrations from taking the same name. Native devices store their random bearer credential in Expo SecureStore. Usernames identify device accounts; this demo does not yet offer email login or account recovery across devices.

Writes require a registered profile. Human reports are immediately trusted when `DEMO_TRUST_INPUTS=true`. Updates appear on other devices during the app's regular catalog refresh. Polygon edits are stored separately from imported source data, so restarting the API does not erase them.

For sign digitization, set the API's `GEMINI_API_KEY` and a comma-separated `GEMINI_MODELS` list containing models actually available to that key. Gemini is the only provider. Uploads are saved immediately; a leased background job extracts the sign. Without a key, photos remain viewable and jobs wait. The database worker uses row locks so multiple API instances cannot claim the same job simultaneously.

## Checks

Run `npm test`, `npm run typecheck`, and `npm run lint`. The PostgreSQL integration test runs the actual migration and SQL on an isolated PGlite PostgreSQL engine, exercises duplicate usernames, shared edits, photos and jobs. It does not verify connectivity to your hosted Supabase project. After connecting, register two test users on two devices and confirm that a zone/price edit from one appears on the other.

References: [Supabase PostgreSQL connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [Expo SecureStore SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/securestore/).
