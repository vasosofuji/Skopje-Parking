import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { validPassword } from "../src/domain/account";

const PARAMETERS = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
export const AUTH_SESSION_MS = 90 * 24 * 60 * 60 * 1000;
export function accountError(message: string, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}
// Run a few memory-heavy scrypt jobs at once. A short bounded queue absorbs sign-up bursts;
// waiting jobs hold no scrypt memory, and work beyond the queue is rejected.
export class PasswordWorkLimiter {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private maximum = 4, private queueLimit = 0) {}
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active < this.maximum) this.active++;
    else if (this.waiting.length < this.queueLimit) await new Promise<void>(resolve => this.waiting.push(resolve));
    else throw accountError("Authentication is busy. Try again shortly.", 429);
    try { return await work(); } finally {
      // Hand the slot straight to the next waiter so a new arrival cannot overtake it.
      const next = this.waiting.shift();
      if (next) next(); else this.active--;
    }
  }
}
const passwordWork = new PasswordWorkLimiter(4, 64);

// Process-local protection. Multiple API processes require a shared limiter store.
export class RequestBudget {
  private entries = new Map<string, { count: number; expires: number }>();
  private nextSweep = 0;
  constructor(private clock: () => number = Date.now, private maximumKeys = 10000) {}
  consume(scope: string, identity: string, maximum: number, windowMs: number) {
    const now = this.clock(), key = `${scope}:${identity}`;
    if (now >= this.nextSweep) {
      for (const [id, entry] of this.entries) if (entry.expires <= now) this.entries.delete(id);
      this.nextSweep = now + 10000;
    }
    const previous = this.entries.get(key);
    const entry = previous && previous.expires > now ? previous : { count: 0, expires: now + windowMs };
    if (entry.count >= maximum || (!previous && this.entries.size >= this.maximumKeys))
      throw accountError("Too many requests. Please try again later.", 429);
    entry.count++;
    this.entries.set(key, entry);
  }
}
export function bearerToken(value?: string) {
  return value?.startsWith("Bearer ") && value.length <= 512 ? value.slice(7) : "";
}
function derive(password: string, salt: string): Promise<Buffer> {
  return passwordWork.run(() => new Promise((resolve, reject) => {
    scrypt(password, salt, 64, PARAMETERS, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  }));
}
export async function hashPassword(password: string) {
  if (!validPassword(password))
    throw accountError("Use a password with 10–128 characters.");
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt);
  return `scrypt:32768:8:3:${salt}:${key.toString("hex")}`;
}
// Missing accounts pay the same derivation cost and return the same login error.
const DUMMY = "scrypt:32768:8:3:" + "0".repeat(32) + ":" + "0".repeat(128);
export async function verifyPassword(password: string, encoded?: string) {
  if (!password.length || password.length > 128) return false;
  const parts = (encoded ?? DUMMY).split(":");
  if (parts.length !== 6 || parts.slice(0, 4).join(":") !== "scrypt:32768:8:3" ||
      !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{128}$/.test(parts[5]))
    return false;
  const key = await derive(password, parts[4]);
  return timingSafeEqual(key, Buffer.from(parts[5], "hex")) && Boolean(encoded);
}
export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function freshToken() {
  return randomBytes(32).toString("hex");
}
