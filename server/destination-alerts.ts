import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import webpush from "web-push";
import { ParkingStore } from "./store";
import type { PostgresParkingStore } from "./postgres/store";
import { bearerToken } from "./account-security";

export const WATCH_DURATION_MS = 90 * 60 * 1000;
const subscription = z.object({ endpoint: z.string().url().max(2048), keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/) }) });
export const destinationWatchSchema = z.object({
  placeId: z.string().min(1).max(100), language: z.enum(["en", "mk"]),
  target: z.discriminatedUnion("type", [
    z.object({ type: z.literal("expo"), token: z.string().regex(/^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$/).max(200) }),
    z.object({ type: z.literal("web"), subscription }),
  ]),
});
type Target = z.infer<typeof destinationWatchSchema>["target"];
type Watch = { session_id: string; place_id: string; target: string; language: "en" | "mk"; expires: number; pending: number; attempts: number };
export type PushMessage = { title: string; body: string; data: { kind: string; placeId: string; reportedAt: number } };
export type PushSender = (target: Target, message: PushMessage) => Promise<void>;

// Only push providers, never arbitrary subscriber URLs (SSRF protection).
export function validPushEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  return url.protocol === "https:" && !url.username && !url.password && !url.port &&
    (url.hostname === "fcm.googleapis.com" || url.hostname === "updates.push.services.mozilla.com" ||
      url.hostname === "web.push.apple.com" || url.hostname.endsWith(".push.apple.com") ||
      url.hostname === "wns2-by3p.notify.windows.com" || url.hostname.endsWith(".notify.windows.com"));
}
export const webPushConfigured = () => Boolean(process.env.WEB_PUSH_PUBLIC_KEY && process.env.WEB_PUSH_PRIVATE_KEY && process.env.WEB_PUSH_SUBJECT);
export const sendDestinationPush: PushSender = async (target, message) => {
  if (target.type === "web") {
    if (!webPushConfigured()) throw new Error("Web Push is not configured.");
    await webpush.sendNotification(target.subscription, JSON.stringify(message), {
      TTL: 300, timeout: 10000,
      vapidDetails: { subject: process.env.WEB_PUSH_SUBJECT!, publicKey: process.env.WEB_PUSH_PUBLIC_KEY!, privateKey: process.env.WEB_PUSH_PRIVATE_KEY! },
    });
    return;
  }
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST", signal: AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/json", ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) },
    body: JSON.stringify({ to: target.token, ...message, channelId: "parking-destination", sound: "default", ttl: 300 }),
  });
  if (!response.ok) throw new Error("Push provider unavailable.");
  const result = await response.json() as { data?: { status?: string; details?: { error?: string } } };
  if (result.data?.status !== "ok") throw Object.assign(new Error("Push provider rejected notification."), { statusCode: result.data?.details?.error === "DeviceNotRegistered" ? 410 : 503 });
};

export class DestinationAlerts {
  constructor(private store: ParkingStore | PostgresParkingStore, private send: PushSender = sendDestinationPush, private now = Date.now) {
    if (store instanceof ParkingStore) store.db.exec(`CREATE TABLE IF NOT EXISTS destination_watches (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
      target_key TEXT UNIQUE NOT NULL, target TEXT NOT NULL, language TEXT NOT NULL,
      expires BIGINT NOT NULL, pending BIGINT NOT NULL DEFAULT 0, alerted INTEGER NOT NULL DEFAULT 0,
      retry_at BIGINT NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS destination_watches_place ON destination_watches(place_id,expires);`);
  }
  async start(token: string, input: z.infer<typeof destinationWatchSchema>) {
    const user = await this.store.session(token);
    await this.store.place(input.placeId);
    if (input.target.type === "web" && !validPushEndpoint(input.target.subscription.endpoint)) throw Object.assign(new Error("Unsupported push provider."), { statusCode: 400 });
    const key = createHash("sha256").update(input.target.type === "web" ? input.target.subscription.endpoint : input.target.token).digest("hex");
    // A browser/device changing accounts must not retain the preceding account's destination.
    await this.store.db.prepare("DELETE FROM destination_watches WHERE target_key=? OR expires<=?").run(key, this.now());
    const expires = this.now() + WATCH_DURATION_MS;
    await this.store.db.prepare(`INSERT INTO destination_watches(session_id,place_id,target_key,target,language,expires) VALUES (?,?,?,?,?,?)
      ON CONFLICT(session_id) DO UPDATE SET place_id=excluded.place_id,target_key=excluded.target_key,target=excluded.target,language=excluded.language,expires=excluded.expires,pending=0,alerted=0,retry_at=0,attempts=0`)
      .run(user.id, input.placeId, key, JSON.stringify(input.target), input.language, expires);
    return { expiresAt: expires };
  }
  async stop(token: string) {
    const user = await this.store.session(token);
    await this.store.db.prepare("DELETE FROM destination_watches WHERE session_id=?").run(user.id);
  }
  async stopAt(placeId: string, token: string) {
    const user = await this.store.session(token);
    await this.store.db.prepare("DELETE FROM destination_watches WHERE session_id=? AND place_id=?").run(user.id, placeId);
  }
  async reportedFull(placeId: string, reporterToken: string) {
    const reporter = await this.store.session(reporterToken);
    await this.store.db.prepare("UPDATE destination_watches SET pending=? WHERE place_id=? AND session_id<>? AND expires>? AND alerted=0 AND pending=0")
      .run(this.now(), placeId, reporter.id, this.now());
  }
  async flush() {
    const now = this.now();
    await this.store.db.prepare("DELETE FROM destination_watches WHERE expires<=?").run(now);
    const rows = await this.store.db.prepare("SELECT * FROM destination_watches WHERE pending>0 AND alerted=0 AND retry_at<=? AND attempts<5 ORDER BY pending LIMIT 20").all(now) as Watch[];
    await Promise.all(rows.map(async row => {
      // Atomic lease prevents simultaneous API workers from sending the same alert.
      const claimed = await this.store.db.prepare("UPDATE destination_watches SET retry_at=?,attempts=attempts+1 WHERE session_id=? AND pending=? AND alerted=0 AND retry_at<=? RETURNING session_id")
        .get(now + 30000, row.session_id, row.pending, now);
      if (!claimed) return;
      try {
        const place = await this.store.place(row.place_id);
        await this.send(JSON.parse(row.target), {
          title: row.language === "en" ? "Your destination was reported full" : "Пријавено е дека вашиот паркинг е полн",
          body: `${row.language === "en" ? place.nameEn ?? place.name : place.name} · ${row.language === "en" ? "Another driver reported no spaces. Check alternatives before arriving." : "Друг возач пријави дека нема места. Проверете други паркинзи."}`,
          data: { kind: "parking-destination-full", placeId: row.place_id, reportedAt: row.pending },
        });
        await this.store.db.prepare("UPDATE destination_watches SET alerted=1 WHERE session_id=? AND pending=?").run(row.session_id, row.pending);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await this.store.db.prepare("DELETE FROM destination_watches WHERE session_id=? AND pending=?").run(row.session_id, row.pending);
        // Other failures stay durable for the next request/worker retry.
      }
    }));
  }
}

export function registerDestinationAlertRoutes(app: FastifyInstance, alerts: DestinationAlerts) {
  app.get("/v1/notifications/config", async () => ({ webPushPublicKey: webPushConfigured() ? process.env.WEB_PUSH_PUBLIC_KEY : null }));
  app.put("/v1/notifications/destination", async request => {
    const input = destinationWatchSchema.parse(request.body);
    if (input.target.type === "web" && !webPushConfigured()) throw Object.assign(new Error("Web notifications are not configured on this server yet."), { statusCode: 503 });
    return alerts.start(bearerToken(request.headers.authorization), input);
  });
  app.delete("/v1/notifications/destination", async request => {
    await alerts.stop(bearerToken(request.headers.authorization));
    return { ok: true };
  });
}
