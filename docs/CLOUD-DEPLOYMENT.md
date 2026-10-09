# Vercel API deployment

The browser app opens at https://parking.vasojevich.com/ (also https://parkino-api-vaso.vercel.app/ and https://parkino-api.vercel.app/). Cloudflare manages the domain's DNS and Vercel serves HTTPS. The same `vaso/parkino-api` project serves its API using Vercel Node.js 24 functions in Frankfurt and the existing Supabase database. Android/iOS remain separate mobile builds. The portfolio website is separate.

## Configuration and deployment

`api/index.ts` reuses an initialized Fastify app per function instance without opening a listening socket. `vercel.json` routes `/health`, `/v1/*` and `/internal/*` to it, installs the lockfile, runs typecheck and all tests, and exports the Expo browser app to `dist`. App paths use the SPA entry point so direct links and refresh work; JavaScript, CSS and assets remain static files. The API bundles the catalog, partner imports and public TLS CA. `.vercelignore` excludes credentials, stale local exports, generated projects, runtime databases and APKs. Apply migrations explicitly before deployment.

Private production/preview environment settings:

- `DATABASE_URL`: the existing dedicated `parkino_api` Supabase transaction pooler connection on port 6543. Never expose it in an Expo public variable.
- `DATABASE_POOL_MODE=transaction`: every independent query runs with `SET LOCAL search_path TO parkskopje` inside its transaction. Multi-query transactions stay on one connection. Session pooling remains available locally.
- `DATABASE_CA_FILE=certs/supabase-ca.crt`: verified TLS.
- `ALLOWED_ORIGINS=https://parkino-api-vaso.vercel.app,https://parkino-api.vercel.app,https://vasojevich.com,https://www.vasojevich.com,http://localhost:8081,http://127.0.0.1:8081,https://parking.vasojevich.com`.
- `DEMO_TRUST_INPUTS=true` for the current demo policy.
- `CRON_SECRET`: random server-only secret authorizing `/internal/sign-jobs`.
- `GEMINI_API_KEY` and optional `GEMINI_MODELS` / `SIGN_AI_TIMEOUT_MS`: server-only sign reading.
- Optional existing `ADMIN_API_KEY`, `OPERATOR_FEED_KEYS`, `GEOCODER_URL`.

The new `20261003101436_shared_request_limits.sql` migration adds private counters for IP, route, account, upload and username-login limits shared by all Vercel instances. Keys are hashed and the daily worker removes expired counters. Function database pools use at most three connections and register with `attachDatabasePool` to release idle connections before suspension.

Vercel Standard Protection protects previews and individual deployment URLs. The production alias is public so phones and CORS preflights connect without Vercel login. Application authentication and Terms consent still apply. Vercel overwrites forwarded IP headers; Fastify trusts only the immediate platform hop.

```powershell
npx vercel@latest link --project parkino-api --scope vaso
npx vercel@latest deploy --prod --scope vaso
```

The GitHub repository is connected. CLI deploys include the working directory; commit the migration/configuration changes before relying on future Git-triggered builds.

## Sign processing and limits

Uploads and durable job leases remain in Supabase. Each response registers up to two queued readings with Vercel `waitUntil` instead of a permanent interval. The response returns promptly; the function has a 180-second limit and each AI fallback chain has a 75-second budget, with up to 45 seconds per model. Concurrent requests share a drain within one instance; PostgreSQL `SKIP LOCKED` leases coordinate separate instances. Interrupted leases recover on later requests.

Retries run on later API traffic while the app polls. A protected daily cron at 03:00 UTC drains a small batch and prunes expired counters. This Hobby-compatible fallback does not guarantee immediate unattended processing of a large backlog; a dedicated queue or more frequent scheduler is needed for that requirement. Missing/invalid provider keys leave photos available for manual review.

Photo uploads are capped at 3 MiB JSON, below Vercel's 4.5 MB payload limit. Catalog and image responses must stay below that limit as data grows. Local development retains SQLite and the continuous worker; production requires PostgreSQL and does not write an ephemeral database.

## Mobile cutover

The default release URL, both EAS release profiles and local `.env` use `https://parkino-api-vaso.vercel.app`. Keep EAS preview/production `EXPO_PUBLIC_API_URL` aligned for cloud builds and updates.

```powershell
.\scripts\build-apk.ps1 -TestPackage -ApiUrl https://parkino-api-vaso.vercel.app
# Main package:
.\scripts\build-apk.ps1 -ApiUrl https://parkino-api-vaso.vercel.app
```

Already installed APKs embed the old Render URL and need a signed update to move to Vercel. Keep Render available until those clients are replaced; authenticated clients deliberately refuse redirects, so redirects cannot migrate them. Preserve the signing key and do not uninstall to bypass a mismatch. Both backends use the same Supabase data, so named accounts and sessions remain valid.

Check public `/health`, catalog, allowed-origin preflight, unauthorized writes, shared reports and photo upload/readback before distributing a rebuilt APK. Native behavior still requires physical testing.

References: [Fastify on Vercel](https://vercel.com/docs/frameworks/backend/fastify), [Background work and pooling](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package), [Function limits](https://vercel.com/docs/functions/limitations), [Supabase pooling](https://supabase.com/docs/guides/database/connecting-to-postgres), [EAS environment variables](https://docs.expo.dev/eas/environment-variables/).
