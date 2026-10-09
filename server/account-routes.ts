import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AccountStore } from "./accounts";
import type { PostgresAccountStore } from "./postgres/accounts";
import { accountError, bearerToken, tokenHash } from "./account-security";
import { TERMS_VERSION, usernameKey } from "../src/domain/account";

/** Mobile carriers put many drivers behind one public IP (CGNAT), so only FAILED sign-ins
 * count: 8 per username across all IPs, and a generous 100 per IP against password spraying. */
export const LOGIN_FAILURES = { username: 8, ip: 100, windowMs: 15 * 60 * 1000 };
export type LoginLimiter = {
  blocked(username: string, ip: string): boolean | Promise<boolean>;
  failed(username: string, ip: string): void | Promise<void>;
  succeeded(username: string): void | Promise<void>;
};
// Single-process memory store; deployments with several API processes pass a shared store.
export class LoginAttemptLimiter implements LoginLimiter {
  private failures = new Map<string, { count: number; expires: number }>();
  constructor(private clock: () => number = Date.now, private maximumKeys = 10000) {}
  private count(key: string) {
    const entry = this.failures.get(key);
    return entry && entry.expires > this.clock() ? entry.count : 0;
  }
  blocked(username: string, ip: string) {
    return this.count("user:" + tokenHash(usernameKey(username))) >= LOGIN_FAILURES.username || this.count("ip:" + ip) >= LOGIN_FAILURES.ip;
  }
  failed(username: string, ip: string) {
    const now = this.clock();
    for (const key of ["user:" + tokenHash(usernameKey(username)), "ip:" + ip]) {
      const previous = this.failures.get(key);
      const entry = previous && previous.expires > now ? previous : { count: 0, expires: now + LOGIN_FAILURES.windowMs };
      entry.count++;
      this.failures.delete(key); this.failures.set(key, entry);
    }
    // Forget the oldest entries instead of refusing everyone when flooded with random names.
    for (const [key, entry] of this.failures) if (this.failures.size > this.maximumKeys || entry.expires <= now) this.failures.delete(key); else break;
  }
  succeeded(username: string) { this.failures.delete("user:" + tokenHash(usernameKey(username))); }
}
export function registerAccountRoutes(app: FastifyInstance, accounts: AccountStore | PostgresAccountStore,
  sharedLimiter?: LoginLimiter) {
  const limiter = sharedLimiter ?? new LoginAttemptLimiter();
  const bearer = bearerToken;
  app.post("/v1/auth/guest", {
    config: { rateLimit: { max: 30, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    const body = z.object({ accepted: z.literal(true), termsVersion: z.literal(TERMS_VERSION) }).strict().parse(request.body);
    reply.header("Cache-Control", "no-store");
    return accounts.guest(bearer(request.headers.authorization), body.termsVersion, body.accepted);
  });
  // No per-IP request cap here: successful sign-ins from a shared carrier IP never throttle anyone.
  app.post("/v1/auth/login", async (request, reply) => {
    const body = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(128), accepted: z.literal(true).optional(), termsVersion: z.literal(TERMS_VERSION).optional() })
      .strict().refine(value => Boolean(value.accepted) === Boolean(value.termsVersion), "Accept the current Terms of Service.").parse(request.body);
    if (await limiter.blocked(body.username, request.ip)) throw accountError("Too many sign-in attempts. Try again in 15 minutes.", 429);
    reply.header("Cache-Control", "no-store");
    try {
      const result = await accounts.login(body.username, body.password, body.accepted === true);
      await limiter.succeeded(body.username);
      return result;
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 401) await limiter.failed(body.username, request.ip);
      throw error;
    }
  });
  app.post("/v1/auth/password", {
    config: { rateLimit: { max: 6, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    const { password } = z.object({ password: z.string().min(10).max(128) }).strict().parse(request.body);
    reply.header("Cache-Control", "no-store");
    return accounts.secure(bearer(request.headers.authorization), password);
  });
  app.post("/v1/auth/logout", async (request) => accounts.logout(bearer(request.headers.authorization)));
  app.get("/v1/rewards", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return accounts.rewards(bearer(request.headers.authorization));
  });
  app.put("/v1/profile/cosmetics", async (request, reply) => {
    const update = z.object({ palette: z.enum(["default", "ocean", "plum"]).optional(), accent: z.enum(["default", "gold", "violet"]).optional() })
      .strict().refine(value => value.palette !== undefined || value.accent !== undefined, "Choose a style.").parse(request.body);
    reply.header("Cache-Control", "no-store");
    return accounts.cosmetics(bearer(request.headers.authorization), update);
  });
}
