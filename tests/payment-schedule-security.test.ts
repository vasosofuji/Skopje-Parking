import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("payment schedules allow the server role through RLS while remaining private", async () => {
  const db = await PGlite.create();
  try {
    await db.exec("CREATE SCHEMA parkskopje; CREATE ROLE parkino_api; CREATE ROLE anon; CREATE ROLE authenticated; CREATE TABLE parkskopje.places(id text PRIMARY KEY); CREATE TABLE parkskopje.sessions(id text PRIMARY KEY); INSERT INTO parkskopje.places VALUES ('parking'); INSERT INTO parkskopje.sessions VALUES ('session'); GRANT USAGE ON SCHEMA parkskopje TO parkino_api;");
    await db.exec(readFileSync("supabase/migrations/20261003114043_payment_schedules.sql", "utf8"));
    await db.exec("SET ROLE parkino_api; INSERT INTO parkskopje.payment_schedules VALUES ('parking','session','{}',1);");
    assert.equal((await db.query("SELECT * FROM parkskopje.payment_schedules")).rows.length, 1);
    await db.exec("UPDATE parkskopje.payment_schedules SET updated=2; DELETE FROM parkskopje.payment_schedules; RESET ROLE;");
    const access = await db.query<{anon:boolean;authenticated:boolean}>("SELECT has_table_privilege('anon','parkskopje.payment_schedules','SELECT') AS anon, has_table_privilege('authenticated','parkskopje.payment_schedules','SELECT') AS authenticated");
    assert.deepEqual(access.rows[0], {anon:false,authenticated:false});
  } finally { await db.close(); }
});
