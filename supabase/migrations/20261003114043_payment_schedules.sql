CREATE TABLE parkskopje.payment_schedules (
  place_id text NOT NULL REFERENCES parkskopje.places(id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES parkskopje.sessions(id) ON DELETE CASCADE,
  details text NOT NULL,
  updated bigint NOT NULL,
  PRIMARY KEY(place_id, session_id)
);
ALTER TABLE parkskopje.payment_schedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON parkskopje.payment_schedules FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON parkskopje.payment_schedules FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON parkskopje.payment_schedules FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='parkino_api') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON parkskopje.payment_schedules TO parkino_api;
    CREATE POLICY api_access ON parkskopje.payment_schedules FOR ALL TO parkino_api USING (true) WITH CHECK (true);
  END IF;
END $$;
