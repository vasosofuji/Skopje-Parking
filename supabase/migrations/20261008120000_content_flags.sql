SET search_path TO parkskopje;
-- Reports of objectionable public sign photos (Google Play user-generated content policy).
-- Two reports hide a photo from everyone until an admin deletes it or clears the reports.
CREATE TABLE content_flags (
  photo_id TEXT NOT NULL REFERENCES sign_photos(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created BIGINT NOT NULL,
  PRIMARY KEY (photo_id, session_id)
);
ALTER TABLE content_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE content_flags FROM PUBLIC;
DO $security$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE parkskopje.content_flags FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE parkskopje.content_flags FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='parkino_api') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE parkskopje.content_flags TO parkino_api;
    CREATE POLICY api_access ON parkskopje.content_flags TO parkino_api USING (true) WITH CHECK (true);
  END IF;
END
$security$;
