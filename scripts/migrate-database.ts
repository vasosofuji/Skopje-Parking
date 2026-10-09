import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PgDatabase } from "../server/postgres/database";
import { PostgresParkingStore } from "../server/postgres/store";
import { readCatalog } from "../server/bootstrap";

const migrations = () => readdirSync(resolve("supabase/migrations")).filter((name) => name.endsWith(".sql")).sort();

/** The API's database role does not own the tables, so with SUPABASE_ACCESS_TOKEN (and the project ref
 * from supabase/project.json) migrations run as the owner through Supabase's Management API. */
async function migrateWithManagementApi(token: string) {
  const ref = process.env.SUPABASE_PROJECT_REF ?? JSON.parse(readFileSync(resolve("supabase/project.json"), "utf8")).projectRef;
  const sql = async (query: string) => {
    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }),
    });
    if (!response.ok) throw new Error(`Management API ${response.status}: ${(await response.text()).slice(0, 500)}`);
    return response.json() as Promise<Record<string, unknown>[]>;
  };
  await sql("CREATE SCHEMA IF NOT EXISTS parkskopje; CREATE TABLE IF NOT EXISTS parkskopje.schema_migrations(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  const applied = new Set((await sql("SELECT name FROM parkskopje.schema_migrations")).map((row) => String(row.name)));
  for (const name of migrations().filter((name) => !applied.has(name))) {
    // One request is one transaction: a failing migration leaves nothing half-applied.
    await sql(`BEGIN; SET LOCAL search_path TO parkskopje; ${readFileSync(resolve("supabase/migrations", name), "utf8")}
;INSERT INTO parkskopje.schema_migrations(name) VALUES ('${name.replace(/'/g, "''")}'); COMMIT;`);
    console.log("Applied " + name);
  }
}

async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error("Set the server-only DATABASE_URL in .env first.");
  const db = new PgDatabase(process.env.DATABASE_URL);
  try {
    if (process.env.SUPABASE_ACCESS_TOKEN) await migrateWithManagementApi(process.env.SUPABASE_ACCESS_TOKEN);
    else {
      await db.exec("CREATE SCHEMA IF NOT EXISTS parkskopje");
      await db.exec(
        "CREATE TABLE IF NOT EXISTS parkskopje.schema_migrations(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
      );
      for (const name of migrations()) {
        await db.transaction(async () => {
          await db.exec("SELECT pg_advisory_xact_lock(17352614)");
          if (
            await db
              .prepare("SELECT name FROM schema_migrations WHERE name=?")
              .get(name)
          )
            return;
          await db.exec(
            readFileSync(resolve("supabase/migrations", name), "utf8"),
          );
          await db
            .prepare("INSERT INTO schema_migrations(name) VALUES (?)")
            .run(name);
          console.log("Applied " + name);
        });
      }
    }
    // The API function never seeds on cold start; changed catalog places reach phones as deltas.
    await new PostgresParkingStore(db, Date.now, process.env.DEMO_TRUST_INPUTS !== "false").seed(readCatalog());
    console.log("Parking database is ready.");
  } finally {
    await db.close();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Migration failed");
  process.exitCode = 1;
});
