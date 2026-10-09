import type { FastifyRateLimitStore, FastifyRateLimitOptions } from "@fastify/rate-limit";
import type { StoreDatabase } from "./database";
import { accountError, tokenHash } from "../account-security";

export class SharedRequestBudget {
  constructor(private db: StoreDatabase) {}
  async increment(scope: string, identity: string, windowMs: number) {
    const now = Date.now();
    // Hash IPs/usernames; a single atomic upsert works across all instances.
    return await this.db.prepare(`
      INSERT INTO request_limits(key,count,expires) VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET
        count=CASE WHEN request_limits.expires<=? THEN 1 ELSE request_limits.count+1 END,
        expires=CASE WHEN request_limits.expires<=? THEN excluded.expires ELSE request_limits.expires END
      RETURNING count,expires
    `).get(tokenHash(`${scope}:${identity}`), now + windowMs, now, now) as { count: number; expires: number };
  }
  /** The current count without adding to it. */
  async peek(scope: string, identity: string) {
    const row = await this.db.prepare("SELECT count FROM request_limits WHERE key=? AND expires>?").get(tokenHash(`${scope}:${identity}`), Date.now()) as { count: number } | undefined;
    return row?.count ?? 0;
  }
  async reset(scope: string, identity: string) {
    await this.db.prepare("DELETE FROM request_limits WHERE key=?").run(tokenHash(`${scope}:${identity}`));
  }
  async consume(scope: string, identity: string, maximum: number, windowMs: number) {
    if ((await this.increment(scope, identity, windowMs)).count > maximum)
      throw accountError("Too many requests. Please try again later.", 429);
  }
  async prune() {
    await this.db.prepare("DELETE FROM request_limits WHERE expires<?").run(Date.now());
  }
}

export function sharedRateLimitStore(budget: SharedRequestBudget) {
  return class Store implements FastifyRateLimitStore {
    private scope = "route:global";
    constructor(_options: FastifyRateLimitOptions) {}
    incr(key: string, callback: (error: Error | null, result?: { current: number; ttl: number }) => void,
      timeWindow: number) {
      void budget.increment(this.scope, key, timeWindow).then(row =>
        callback(null, { current: row.count, ttl: Math.max(0, row.expires - Date.now()) }),
      error => callback(error instanceof Error ? error : new Error("Rate limit store unavailable")));
    }
    child(options: { path?: string; prefix?: string; routeInfo?: { url: string; method: string | string[] } }): FastifyRateLimitStore {
      const child = new Store({});
      child.scope = options.routeInfo
        ? `route:${options.routeInfo.method}:${options.routeInfo.url}`
        : `route:${options.prefix ?? ""}:${options.path ?? "manual"}`;
      return child;
    }
  };
}
