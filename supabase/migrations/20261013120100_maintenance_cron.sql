-- Calls the API's /internal/maintenance every minute, so destination and spot alerts go out (and expired
-- rate-limit rows are pruned) even when no phone is using the API. Supabase only: skipped where pg_cron or
-- pg_net is unavailable (local Postgres, PGlite tests).
--
-- Create these two Vault secrets (SQL editor) before or after applying this:
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/api/internal/maintenance', 'api_maintenance_url');
--   select vault.create_secret('<the CRON_SECRET Edge Function secret>', 'api_cron_secret');
-- Until both exist the job runs every minute and its request fails without effect.
DO $cron$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='pg_cron') AND EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='pg_net') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
    CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
    -- Scheduling under an existing name replaces that job, so re-running this is harmless.
    PERFORM cron.schedule('api-maintenance', '* * * * *', $job$
      SELECT net.http_get(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'api_maintenance_url'),
        headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'api_cron_secret')),
        timeout_milliseconds := 20000
      );
    $job$);
  END IF;
END $cron$;
