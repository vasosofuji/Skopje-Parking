CREATE TABLE parkskopje.destination_watches (
  session_id text PRIMARY KEY REFERENCES parkskopje.sessions(id) ON DELETE CASCADE,
  place_id text NOT NULL REFERENCES parkskopje.places(id) ON DELETE CASCADE,
  target_key text UNIQUE NOT NULL,
  target text NOT NULL,
  language text NOT NULL CHECK (language IN ('en','mk')),
  expires bigint NOT NULL,
  pending bigint NOT NULL DEFAULT 0,
  alerted integer NOT NULL DEFAULT 0,
  retry_at bigint NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX destination_watches_place ON parkskopje.destination_watches(place_id,expires);
ALTER TABLE parkskopje.destination_watches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON parkskopje.destination_watches FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON parkskopje.destination_watches FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON parkskopje.destination_watches FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='parkino_api') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON parkskopje.destination_watches TO parkino_api;
    CREATE POLICY api_access ON parkskopje.destination_watches FOR ALL TO parkino_api USING (true) WITH CHECK (true);
  END IF;
END $$;
