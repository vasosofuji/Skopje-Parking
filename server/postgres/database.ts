import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { Pool, type PoolClient, type QueryResult, types } from "pg";

// Millisecond timestamps and counters are within JavaScript's safe integer range.
types.setTypeParser(20, (value) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number))
    throw new Error("Database integer is out of range");
  return number;
});
export function postgresSql(sql: string) {
  let index = 0;
  let translated = sql
    .replace(/\?/g, () => "$" + ++index)
    .replace(/json_extract\(data,'\$\.([a-zA-Z]+)'\)/g, "(data::jsonb->>'$1')")
    .replace(/, rowid DESC/g, ", session_id DESC")
    .replace(/MAX\(0,attempts-1\)/g, "GREATEST(0,attempts-1)");
  if (translated.includes("INSERT OR IGNORE"))
    translated =
      translated.replace("INSERT OR IGNORE", "INSERT") +
      " ON CONFLICT DO NOTHING";
  return translated;
}
export interface StoreDatabase {
  prepare(sql: string): {
    run(...values: unknown[]): Promise<unknown>;
    get(...values: unknown[]): Promise<unknown>;
    all(...values: unknown[]): Promise<unknown[]>;
  };
  transaction<T>(work: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export class PgDatabase {
  readonly pool: Pool;
  private local = new AsyncLocalStorage<PoolClient>();
  private initialized = new WeakSet<PoolClient>();
  private transactionPool: boolean;
  constructor(url: string, poolMode = process.env.DATABASE_POOL_MODE ?? "session", max = 8) {
    this.transactionPool = poolMode === "transaction";
    const connection = new URL(url);
    // Plain connections only for a database on this computer (local tests).
    const local = connection.searchParams.get("sslmode") === "disable" && ["localhost", "127.0.0.1"].includes(connection.hostname);
    // Keep TLS verification enabled; do not let URL sslmode silently override it.
    for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
      connection.searchParams.delete(key);
    const ca = process.env.DATABASE_CA ?? (process.env.DATABASE_CA_FILE ? readFileSync(process.env.DATABASE_CA_FILE, "utf8") : undefined);
    this.pool = new Pool({
      connectionString: connection.toString(),
      max,
      statement_timeout: 10000,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: local ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    });
    // pg emits idle connection failures outside a query promise. Without a
    // listener, a transient pooler/network outage terminates the Node process.
    this.pool.on("error", () => {
      console.warn("An idle database connection closed; the pool will reconnect.");
    });
  }
  private async initialize(client: PoolClient) {
    if (this.initialized.has(client)) return;
    // Session poolers don't consistently forward startup options. Set the schema
    // on each actual connection before its first query, then reuse that session.
    await client.query("SET search_path TO parkskopje");
    this.initialized.add(client);
  }
  async query(sql: string, values: unknown[] = []): Promise<QueryResult> {
    const current = this.local.getStore();
    if (current) return current.query(postgresSql(sql), values);
    // Transaction poolers can change the underlying server session between
    // queries. SET LOCAL must run inside the same transaction as the query.
    if (this.transactionPool) return this.transaction(() => this.query(sql, values));
    const client = await this.pool.connect();
    try {
      await this.initialize(client);
      return await client.query(postgresSql(sql), values);
    } finally {
      client.release();
    }
  }
  prepare(sql: string) {
    return {
      run: async (...values: unknown[]) => this.query(sql, values),
      get: async (...values: unknown[]): Promise<unknown> =>
        (await this.query(sql, values)).rows[0],
      all: async (...values: unknown[]): Promise<unknown[]> =>
        (await this.query(sql, values)).rows,
    };
  }
  async exec(sql: string) {
    await this.query(sql);
  }
  async transaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.local.getStore()) return work();
    const client = await this.pool.connect();
    let begun = false;
    try {
      if (!this.transactionPool) await this.initialize(client);
      await client.query("BEGIN");
      begun = true;
      if (this.transactionPool) await client.query("SET LOCAL search_path TO parkskopje");
      const result = await this.local.run(client, work);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      if (begun) await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
