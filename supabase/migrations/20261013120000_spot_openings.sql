-- "A spot may open soon": when a driver's paid parking ends (or they tap "I'm leaving my spot"), drivers
-- with an active destination watch nearby get one push. Only the place and end time are stored, keyed by
-- the sharing session so it can be replaced, withdrawn and deleted with the account; rows expire 10 minutes
-- after the end time.
CREATE TABLE parkskopje.spot_openings (
  session_id text PRIMARY KEY REFERENCES parkskopje.sessions(id) ON DELETE CASCADE,
  place_id text NOT NULL REFERENCES parkskopje.places(id) ON DELETE CASCADE,
  ends_at bigint NOT NULL,
  notify_at bigint NOT NULL,
  expires bigint NOT NULL
);
CREATE INDEX spot_openings_due ON parkskopje.spot_openings(notify_at);
-- One row per opening and destination watch: the delivery lease and the "already told" marker.
CREATE TABLE parkskopje.spot_alerts (
  opening_id text NOT NULL REFERENCES parkskopje.spot_openings(session_id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES parkskopje.destination_watches(session_id) ON DELETE CASCADE,
  place_id text NOT NULL,
  alerted integer NOT NULL DEFAULT 0,
  retry_at bigint NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  PRIMARY KEY (opening_id, session_id)
);
CREATE INDEX spot_alerts_watch ON parkskopje.spot_alerts(session_id);
ALTER TABLE parkskopje.spot_openings ENABLE ROW LEVEL SECURITY;
ALTER TABLE parkskopje.spot_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON parkskopje.spot_openings, parkskopje.spot_alerts FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON parkskopje.spot_openings, parkskopje.spot_alerts FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON parkskopje.spot_openings, parkskopje.spot_alerts FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='parkino_api') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON parkskopje.spot_openings, parkskopje.spot_alerts TO parkino_api;
    CREATE POLICY api_access ON parkskopje.spot_openings FOR ALL TO parkino_api USING (true) WITH CHECK (true);
    CREATE POLICY api_access ON parkskopje.spot_alerts FOR ALL TO parkino_api USING (true) WITH CHECK (true);
  END IF;
END $$;
