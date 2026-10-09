-- Durable counters prevent cold starts and multiple functions bypassing limits.
CREATE TABLE parkskopje.request_limits (
  key text PRIMARY KEY,
  count bigint NOT NULL CHECK (count > 0),
  expires bigint NOT NULL
);
CREATE INDEX request_limits_expiry ON parkskopje.request_limits(expires);
ALTER TABLE parkskopje.request_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON parkskopje.request_limits FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON parkskopje.request_limits FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON parkskopje.request_limits FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='parkino_api') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON parkskopje.request_limits TO parkino_api;
    CREATE POLICY api_access ON parkskopje.request_limits FOR ALL TO parkino_api USING (true) WITH CHECK (true);
  END IF;
END $$;
