SET search_path TO parkskopje;
-- Separate authority from editable tariff confirmations. Only the private API writes this table.
CREATE TABLE sms_confirmations (
  photo_id TEXT PRIMARY KEY REFERENCES sign_photos(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  protocol TEXT NOT NULL,
  photo_hash TEXT NOT NULL,
  confirmed BIGINT NOT NULL
);
ALTER TABLE sms_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE sms_confirmations FROM PUBLIC;
DO $security$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE parkskopje.sms_confirmations FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE parkskopje.sms_confirmations FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='parkino_api') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE parkskopje.sms_confirmations TO parkino_api;
    CREATE POLICY api_access ON parkskopje.sms_confirmations TO parkino_api USING (true) WITH CHECK (true);
  END IF;
END
$security$;
