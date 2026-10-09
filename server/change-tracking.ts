// Every write that changes how a place looks marks it in place_changes, so phones download only
// changed places. Triggers also catch cascades (an account deletion removing its reports).
// PostgreSQL has the same triggers in supabase/migrations/20261009120000_sign_readings_sync.sql.
export const TRACKED: [table: string, column: string][] = [
  ["places", "id"], ["reports", "place_id"], ["price_reports", "place_id"], ["location_reports", "place_id"],
  ["observations", "place_id"], ["labels", "place_id"], ["boundaries", "place_id"], ["payment_schedules", "place_id"],
  ["capacity_reports", "place_id"], ["sign_readings", "place_id"],
];
const NOW = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const UPSERT = "ON CONFLICT(place_id) DO UPDATE SET changed=excluded.changed,removed=excluded.removed";
export const SQLITE_CHANGE_TRACKING = [
  "CREATE TABLE IF NOT EXISTS place_changes(place_id TEXT PRIMARY KEY, changed INTEGER NOT NULL, removed INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS place_changes_by_time ON place_changes(changed)",
  ...TRACKED.flatMap(([table, column]) => ([["INSERT", "NEW"], ["UPDATE", "NEW"], ["DELETE", "OLD"]] as const).map(([event, row]) =>
    `CREATE TRIGGER IF NOT EXISTS track_${table}_${event.toLowerCase()} AFTER ${event} ON ${table} BEGIN ` +
    `INSERT INTO place_changes(place_id,changed,removed) VALUES (${row}.${column},${NOW},${table === "places" && event === "DELETE" ? 1 : 0}) ${UPSERT}; END`)),
  // Hiding a reported sign reading changes its place.
  ...(["INSERT", "DELETE"] as const).map(event => `CREATE TRIGGER IF NOT EXISTS track_content_flags_${event.toLowerCase()} AFTER ${event} ON content_flags BEGIN ` +
    `INSERT INTO place_changes(place_id,changed,removed) SELECT place_id,${NOW},0 FROM sign_readings WHERE id=${event === "INSERT" ? "NEW" : "OLD"}.reading_id AND true ${UPSERT}; END`),
  // A contributor's accent colours every place they added.
  ...(["INSERT", "UPDATE"] as const).map(event => `CREATE TRIGGER IF NOT EXISTS track_account_cosmetics_${event.toLowerCase()} AFTER ${event} ON account_cosmetics BEGIN ` +
    `INSERT INTO place_changes(place_id,changed,removed) SELECT place_id,${NOW},0 FROM contribution_details WHERE session_id=NEW.session_id AND true ${UPSERT}; END`),
];
