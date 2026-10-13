import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ParkingStore } from "./store";
import type { PostgresParkingStore } from "./postgres/store";
import { bearerToken } from "./account-security";
import { sendDestinationPush, type PushSender } from "./destination-alerts";
import { distanceMeters } from "../src/domain/parking";
import { distanceToParkingBoundary, insidePolygon } from "../src/domain/arrival";
import type { Coordinate, ParkingPlace } from "../src/domain/types";

export const SPOT_NOTICE_MS = 5 * 60000, SPOT_TTL_MS = 10 * 60000, SPOT_RADIUS_M = 300, SPOT_ALERT_GAP_MS = 10 * 60000;
export const SPOT_OPENING_KIND = "parking-spot-opening";
// Only the place and the time: no plate, car position or payment details leave the phone.
const placeId = z.string().min(1).max(100);
export const spotOpeningSchema = z.union([
  z.object({ placeId, endsAt: z.number().int() }).strict(),
  z.object({ placeId, leaving: z.literal(true) }).strict(),
]);
type Opening = { session_id: string; place_id: string; expires: number };
type Pending = { opening_id: string; session_id: string; place_id: string; spot_id: string; ends_at: number; target: string; language: "en" | "mk" };

const reach = (place: ParkingPlace, point: Coordinate) => place.geometry
  ? insidePolygon(point, place.geometry) ? 0 : distanceToParkingBoundary(point, place.geometry)
  : distanceMeters(point, place.coordinate);
/** The destination itself, or public parking within about 300 m of it (zones count from their edge). */
export const spotNearDestination = (spot: ParkingPlace, destination: ParkingPlace) => spot.id === destination.id ||
  (spot.access !== "restricted" && Math.min(reach(spot, destination.coordinate), reach(destination, spot.coordinate)) <= SPOT_RADIUS_M);

/** Drivers say when their paid time ends; drivers heading nearby (an active destination watch) hear about it
 * about 5 minutes before, once per watch and opening and at most once per watch every 10 minutes.
 * Delivery shares the destination alerts' push targets. */
export class SpotOpenings {
  constructor(private store: ParkingStore | PostgresParkingStore, private send: PushSender = sendDestinationPush, private now = Date.now) {
    if (store instanceof ParkingStore) store.db.exec(`CREATE TABLE IF NOT EXISTS spot_openings (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
      ends_at BIGINT NOT NULL, notify_at BIGINT NOT NULL, expires BIGINT NOT NULL);
      CREATE INDEX IF NOT EXISTS spot_openings_due ON spot_openings(notify_at);
      CREATE TABLE IF NOT EXISTS spot_alerts (
      opening_id TEXT NOT NULL REFERENCES spot_openings(session_id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES destination_watches(session_id) ON DELETE CASCADE,
      place_id TEXT NOT NULL, alerted INTEGER NOT NULL DEFAULT 0, retry_at BIGINT NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (opening_id, session_id));`);
  }
  async open(token: string, input: z.infer<typeof spotOpeningSchema>) {
    const user = await this.store.session(token), place = await this.store.place(input.placeId), now = this.now();
    if (place.access === "restricted") throw Object.assign(new Error("Spot alerts are for public parking."), { statusCode: 400 });
    const endsAt = "leaving" in input ? now : input.endsAt;
    if (endsAt < now - 60000 || endsAt > now + 86400000) throw Object.assign(new Error("The parking end time must be within the next 24 hours."), { statusCode: 400 });
    const notifyAt = Math.max(now, endsAt - SPOT_NOTICE_MS);
    // One opening per account. A new place, or one that already ended, starts over; the same spot
    // (paid time extended, or "leaving now") keeps the drivers it already reached.
    await this.store.db.prepare("DELETE FROM spot_openings WHERE session_id=? AND (place_id<>? OR expires<=?)").run(user.id, place.id, now);
    await this.store.db.prepare(`INSERT INTO spot_openings(session_id,place_id,ends_at,notify_at,expires) VALUES (?,?,?,?,?)
      ON CONFLICT(session_id) DO UPDATE SET ends_at=excluded.ends_at,notify_at=excluded.notify_at,expires=excluded.expires`)
      .run(user.id, place.id, endsAt, notifyAt, endsAt + SPOT_TTL_MS);
    return { notifyAt };
  }
  async withdraw(token: string) {
    const user = await this.store.session(token);
    await this.store.db.prepare("DELETE FROM spot_openings WHERE session_id=?").run(user.id);
  }
  async flush() {
    const now = this.now(), db = this.store.db;
    // The common case is one indexed read: nothing is due.
    const due = await db.prepare("SELECT session_id,place_id,expires FROM spot_openings WHERE notify_at<=? ORDER BY notify_at LIMIT 100").all(now) as Opening[];
    if (!due.length) return;
    if (due.some(opening => opening.expires <= now)) await db.prepare("DELETE FROM spot_openings WHERE expires<=?").run(now);
    const live = due.filter(opening => opening.expires > now);
    if (!live.length) return;
    // A watch started after the notice still hears about a spot that has not opened yet.
    // ponytail: every flush re-checks live openings against active watches in memory; index by area if watches reach the thousands.
    const watches = await db.prepare("SELECT session_id,place_id FROM destination_watches WHERE expires>?").all(now) as { session_id: string; place_id: string }[];
    const list = live.map(() => "?").join(",");
    const known = new Set((await db.prepare(`SELECT opening_id,session_id FROM spot_alerts WHERE opening_id IN (${list})`).all(...live.map(opening => opening.session_id)) as { opening_id: string; session_id: string }[])
      .map(row => `${row.opening_id} ${row.session_id}`));
    const pairs = live.flatMap(opening => watches.filter(watch => watch.session_id !== opening.session_id && !known.has(`${opening.session_id} ${watch.session_id}`)).map(watch => ({ opening, watch })));
    if (pairs.length) {
      const ids = [...new Set(pairs.flatMap(({ opening, watch }) => [opening.place_id, watch.place_id]))];
      const places = new Map((await db.prepare(`SELECT data FROM places WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as { data: string }[])
        .map(row => JSON.parse(row.data) as ParkingPlace).map(place => [place.id, place]));
      for (const { opening, watch } of pairs) {
        const spot = places.get(opening.place_id), destination = places.get(watch.place_id);
        if (spot && destination && spotNearDestination(spot, destination))
          await db.prepare("INSERT OR IGNORE INTO spot_alerts(opening_id,session_id,place_id) VALUES (?,?,?)").run(opening.session_id, watch.session_id, watch.place_id);
      }
    }
    // A watch that moved to another destination since matching, stopped or expired gets nothing, and an
    // opening whose end moved later (paid time extended) waits for its new notice time, also on a retry.
    const gap = now - SPOT_ALERT_GAP_MS;
    const rows = await db.prepare(`SELECT a.opening_id,a.session_id,a.place_id,o.place_id AS spot_id,o.ends_at,w.target,w.language FROM spot_alerts a
      JOIN spot_openings o ON o.session_id=a.opening_id AND o.notify_at<=? AND o.expires>?
      JOIN destination_watches w ON w.session_id=a.session_id AND w.place_id=a.place_id AND w.expires>? AND w.spot_alerted_at<=?
      WHERE a.alerted=0 AND a.retry_at<=? AND a.attempts<5 LIMIT 20`).all(now, now, now, gap, now) as Pending[];
    await Promise.all(rows.map(async row => {
      // At most one alert per watch every 10 minutes, whatever the opening (an opening moved between places
      // is a new one): a 30 s lease on the watch, held for the full 10 minutes once an alert is sent.
      if (!await db.prepare("UPDATE destination_watches SET spot_alerted_at=? WHERE session_id=? AND spot_alerted_at<=? RETURNING session_id")
        .get(gap + 30000, row.session_id, gap)) return;
      // Atomic lease prevents simultaneous API workers from sending the same alert.
      const claimed = await db.prepare("UPDATE spot_alerts SET retry_at=?,attempts=attempts+1 WHERE opening_id=? AND session_id=? AND alerted=0 AND retry_at<=? RETURNING opening_id")
        .get(now + 30000, row.opening_id, row.session_id, now);
      if (!claimed) return;
      try {
        const [destination, spot] = await Promise.all([this.store.place(row.place_id), this.store.place(row.spot_id)]);
        const en = row.language === "en", name = (place: ParkingPlace) => en ? place.nameEn ?? place.name : place.name;
        const time = new Date(row.ends_at).toLocaleTimeString("en-GB", { timeZone: "Europe/Skopje", hour: "2-digit", minute: "2-digit" });
        // "Leaving now" openings end when they are shared, so they are already past by delivery.
        const when = row.ends_at <= now ? (en ? "Another driver is leaving now." : "Друг возач заминува сега.")
          : en ? `Another driver's paid time ends around ${time}.` : `Платеното време на друг возач истекува околу ${time}.`;
        await this.send(JSON.parse(row.target), {
          title: en ? `A spot may open soon near ${name(destination)}` : `Наскоро може да се ослободи место кај ${name(destination)}`,
          body: `${name(spot)} · ${when} ${en ? "The spot is not guaranteed." : "Местото не е загарантирано."}`,
          channelId: "parking-spots", data: { kind: SPOT_OPENING_KIND, placeId: row.spot_id, destinationId: row.place_id, endsAt: row.ends_at },
        });
        await db.prepare("UPDATE spot_alerts SET alerted=1 WHERE opening_id=? AND session_id=?").run(row.opening_id, row.session_id);
        await db.prepare("UPDATE destination_watches SET spot_alerted_at=? WHERE session_id=?").run(now, row.session_id);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        // The device is gone: drop its watch, as destination alerts do. Other failures retry later.
        if (status === 404 || status === 410) await db.prepare("DELETE FROM destination_watches WHERE session_id=?").run(row.session_id);
      }
    }));
  }
}

export function registerSpotOpeningRoutes(app: FastifyInstance, spots: SpotOpenings) {
  app.post("/v1/spot-openings", { config: { rateLimit: { max: 12, timeWindow: "1 hour" } } }, async (request, reply) =>
    reply.code(201).send(await spots.open(bearerToken(request.headers.authorization), spotOpeningSchema.parse(request.body))));
  app.delete("/v1/spot-openings", { config: { rateLimit: { max: 12, timeWindow: "1 hour" } } }, async request => {
    await spots.withdraw(bearerToken(request.headers.authorization));
    return { ok: true };
  });
}
