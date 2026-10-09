SET search_path TO parkskopje;

-- 1. Sign photos are no longer stored. Drivers read signs on their phones and upload only the
--    details they confirm. Keep every confirmed reading, then delete the photos and photo tables.
CREATE TABLE sign_readings (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  info TEXT NOT NULL,
  model TEXT,
  created BIGINT NOT NULL
);
CREATE INDEX sign_readings_by_place ON sign_readings(place_id, created DESC);
INSERT INTO sign_readings(id, place_id, session_id, info, model, created)
  SELECT p.id, p.place_id, c.session_id, c.info, COALESCE(p.model, 'manual'), c.confirmed
  FROM sign_photos p JOIN sign_confirmations c ON c.photo_id = p.id;
DROP TABLE IF EXISTS content_flags, sms_confirmations, sign_uploaders, sign_confirmations, sign_photos CASCADE;

-- 2. Reports of objectionable public sign details (Google Play user-generated content policy).
--    Two reports hide a reading from everyone until an admin deletes it or clears the reports.
CREATE TABLE content_flags (
  reading_id TEXT NOT NULL REFERENCES sign_readings(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created BIGINT NOT NULL,
  PRIMARY KEY (reading_id, session_id)
);

-- 3. Every write that changes how a place looks marks it here, so phones download only changed
--    places (GET /v1/changes). Triggers also catch cascades such as an account deletion.
CREATE TABLE place_changes (
  place_id TEXT PRIMARY KEY,
  changed BIGINT NOT NULL,
  removed BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX place_changes_by_time ON place_changes(changed);

CREATE FUNCTION parkskopje.track_place_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  changed_row jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
BEGIN
  INSERT INTO parkskopje.place_changes(place_id, changed, removed)
  VALUES (changed_row ->> TG_ARGV[0], (extract(epoch FROM clock_timestamp()) * 1000)::bigint, TG_TABLE_NAME = 'places' AND TG_OP = 'DELETE')
  ON CONFLICT (place_id) DO UPDATE SET changed = excluded.changed, removed = excluded.removed;
  RETURN NULL;
END $$;

CREATE FUNCTION parkskopje.track_flag_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO parkskopje.place_changes(place_id, changed, removed)
  SELECT place_id, (extract(epoch FROM clock_timestamp()) * 1000)::bigint, false FROM parkskopje.sign_readings
  WHERE id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.reading_id ELSE NEW.reading_id END)
  ON CONFLICT (place_id) DO UPDATE SET changed = excluded.changed, removed = false;
  RETURN NULL;
END $$;

CREATE FUNCTION parkskopje.track_accent_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO parkskopje.place_changes(place_id, changed, removed)
  SELECT place_id, (extract(epoch FROM clock_timestamp()) * 1000)::bigint, false FROM parkskopje.contribution_details WHERE session_id = NEW.session_id
  ON CONFLICT (place_id) DO UPDATE SET changed = excluded.changed, removed = false;
  RETURN NULL;
END $$;

DO $triggers$
DECLARE
  tracked text[][] := ARRAY[
    ['places', 'id'], ['reports', 'place_id'], ['price_reports', 'place_id'], ['location_reports', 'place_id'],
    ['observations', 'place_id'], ['labels', 'place_id'], ['boundaries', 'place_id'], ['payment_schedules', 'place_id'],
    ['capacity_reports', 'place_id'], ['sign_readings', 'place_id']];
  item text[];
BEGIN
  FOREACH item SLICE 1 IN ARRAY tracked LOOP
    EXECUTE format('CREATE TRIGGER track_%1$s AFTER INSERT OR UPDATE OR DELETE ON parkskopje.%1$I FOR EACH ROW EXECUTE FUNCTION parkskopje.track_place_change(%2$L)', item[1], item[2]);
  END LOOP;
END
$triggers$;
CREATE TRIGGER track_content_flags AFTER INSERT OR DELETE ON content_flags FOR EACH ROW EXECUTE FUNCTION parkskopje.track_flag_change();
CREATE TRIGGER track_account_cosmetics AFTER INSERT OR UPDATE ON account_cosmetics FOR EACH ROW EXECUTE FUNCTION parkskopje.track_accent_change();

ALTER TABLE sign_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE place_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE sign_readings, content_flags, place_changes FROM PUBLIC;
DO $security$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE parkskopje.sign_readings, parkskopje.content_flags, parkskopje.place_changes FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE parkskopje.sign_readings, parkskopje.content_flags, parkskopje.place_changes FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='parkino_api') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE parkskopje.sign_readings, parkskopje.content_flags, parkskopje.place_changes TO parkino_api;
    CREATE POLICY api_access ON parkskopje.sign_readings TO parkino_api USING (true) WITH CHECK (true);
    CREATE POLICY api_access ON parkskopje.content_flags TO parkino_api USING (true) WITH CHECK (true);
    CREATE POLICY api_access ON parkskopje.place_changes TO parkino_api USING (true) WITH CHECK (true);
  END IF;
END
$security$;
