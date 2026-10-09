import type { RewardKind } from "../src/domain/account";
import { randomUUID } from "node:crypto";
import type {
  Catalog,
  Contribution,
  Geometry,
  ParkingPlace,
  PaymentSchedule,
  SignInfo,
  SignReading,
} from "../src/domain/types";
import { normalizeZoneCode } from "../src/domain/parking";
import type { ParkingStore } from "./store";
import { ACCOUNT_TABLES } from "./accounts";
import { catalogDelta, enrichPlaces, type Query } from "./sign-catalog";
import { SQLITE_CHANGE_TRACKING } from "./change-tracking";
export class CommunityStore {
  constructor(private store: ParkingStore) {
    store.db.exec(ACCOUNT_TABLES);
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS payment_schedules(place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,details TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(place_id,session_id));
      CREATE TABLE IF NOT EXISTS capacity_reports(place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,capacity INTEGER NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(place_id,session_id));
      CREATE TABLE IF NOT EXISTS contribution_details(place_id TEXT PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE,session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,details TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS contributions(request_id TEXT NOT NULL, session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL, place_id TEXT REFERENCES places(id) ON DELETE CASCADE, UNIQUE(request_id,session_id));
      CREATE TABLE IF NOT EXISTS labels(place_id TEXT REFERENCES places(id) ON DELETE CASCADE, session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE, code TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(place_id,session_id));
      CREATE INDEX IF NOT EXISTS labels_by_place ON labels(place_id,created DESC);
      CREATE TABLE IF NOT EXISTS boundaries(place_id TEXT PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE, geometry TEXT NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sign_readings(id TEXT PRIMARY KEY, place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, info TEXT NOT NULL, model TEXT, created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sign_readings_by_place ON sign_readings(place_id,created DESC);
      CREATE TABLE IF NOT EXISTS content_flags(reading_id TEXT NOT NULL REFERENCES sign_readings(id) ON DELETE CASCADE, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, reason TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(reading_id,session_id));
    `);
    for (const statement of SQLITE_CHANGE_TRACKING) store.db.exec(statement);
  }
  private query: Query = async (sql, args = []) => this.store.db.prepare(sql).all(...(args as never[])) as Record<string, unknown>[];
  contribute(input: Contribution, token: string) {
    const user = this.store.session(token);
    const previous = this.store.db
      .prepare(
        "SELECT place_id FROM contributions WHERE request_id=? AND session_id=?",
      )
      .get(input.requestId, user.id) as { place_id: string } | undefined;
    if (previous) return this.store.place(previous.place_id);
    const place: ParkingPlace = {
      id: "community:" + randomUUID(),
      name: input.name,
      coordinate: input.coordinate,
      geometry: input.geometry,
      kind: input.kind,
      operator: null,
      zoneCode: input.zoneCode ? normalizeZoneCode(input.zoneCode) : null,
      zoneCodeEvidence: "community",
      access: "unknown",
      tariff: null,
      capacity: input.capacity ?? null,
      openingHours: null,
      verification: "community",
      source: {
        label: "Community contribution",
        url: "",
        retrievedAt: new Date().toISOString(),
      },
    };
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      this.store.db
        .prepare("INSERT INTO places VALUES (?,?)")
        .run(place.id, JSON.stringify(place));
      this.store.db
        .prepare("INSERT INTO contributions VALUES (?,?,?)")
        .run(input.requestId, user.id, place.id);
      const kinds: RewardKind[] = [];
      if (input.geometry) kinds.push("boundary");
      if (input.firstHour !== null) kinds.push("pricing");
      if (input.capacity != null) kinds.push("capacity");
      if (input.freeSpaces != null && input.kind !== "zone") kinds.push("availability");
      this.store.db.prepare("INSERT INTO contribution_details(place_id,session_id,details,created) VALUES (?,?,?,?)")
        .run(place.id,user.id,JSON.stringify(kinds),Date.now());
      if (input.firstHour !== null)
        this.store.reportPrice(
          place.id,
          token,
          input.firstHour,
          input.nextHour ?? input.firstHour,
        );
      if (input.freeSpaces !== undefined && input.freeSpaces !== null && input.kind !== "zone")
        this.store.report(place.id, token, input.freeSpaces > 0 ? "spaces" : "full", input.freeSpaces);
      this.store.db.exec("COMMIT");
      return place;
    } catch (error) {
      this.store.db.exec("ROLLBACK");
      throw error;
    }
  }
  contributionRewards(id: string, token: string) {
    const user = this.store.session(token);
    const row = this.store.db.prepare("SELECT details,created FROM contribution_details WHERE place_id=? AND session_id=?").get(id,user.id) as {details:string;created:number}|undefined;
    return {kinds: row ? JSON.parse(row.details) as RewardKind[] : [], created: row?.created ?? Date.now()};
  }
  label(id: string, token: string, code: string) {
    const user = this.store.session(token);
    this.store.place(id);
    this.store.db
      .prepare(
        "INSERT INTO labels VALUES (?,?,?,?) ON CONFLICT(place_id,session_id) DO UPDATE SET code=excluded.code,created=excluded.created",
      )
      .run(id, user.id, normalizeZoneCode(code), Date.now());
    return { saved: true };
  }
  boundary(id: string, token: string, geometry: Geometry) {
    this.store.session(token);
    this.store.place(id);
    // Separate from the source catalog: importing official data must not erase edits.
    this.store.db.prepare("INSERT INTO boundaries VALUES (?,?,?) ON CONFLICT(place_id) DO UPDATE SET geometry=excluded.geometry,updated=excluded.updated")
      .run(id, JSON.stringify(geometry), Date.now());
    return { saved: true };
  }
  paymentSchedule(id: string, token: string, value: PaymentSchedule) {
    const user = this.store.session(token);
    this.store.place(id);
    this.store.db.prepare("INSERT INTO payment_schedules(place_id,session_id,details,updated) VALUES (?,?,?,?) ON CONFLICT(place_id,session_id) DO UPDATE SET details=excluded.details,updated=excluded.updated").run(id,user.id,JSON.stringify(value),Date.now());
    return { ok: true };
  }
  capacity(id: string, token: string, capacity: number) {
    const user = this.store.session(token);
    const place = this.store.place(id);
    if (place.kind === "zone") throw Object.assign(new Error("Set capacity on an individual parking area."), {statusCode:400});
    this.store.db.prepare("INSERT INTO capacity_reports(place_id,session_id,capacity,updated) VALUES (?,?,?,?) ON CONFLICT(place_id,session_id) DO UPDATE SET capacity=excluded.capacity,updated=excluded.updated").run(id,user.id,capacity,Date.now());
    return {saved:true};
  }
  /** Details a driver confirmed from a sign they read on their phone; the photo never leaves it. */
  addSignReading(placeId: string, token: string, info: SignInfo, model: string): SignReading {
    const user = this.store.session(token);
    this.store.place(placeId);
    if (!info.isParkingSign) throw Object.assign(new Error("Only parking signs can be confirmed."), { statusCode: 400 });
    const id = randomUUID(), created = Date.now();
    this.store.db.prepare("INSERT INTO sign_readings(id,place_id,session_id,info,model,created) VALUES (?,?,?,?,?,?)")
      .run(id, placeId, user.id, JSON.stringify(info), model, created);
    return { id, placeId, createdAt: new Date(created).toISOString() };
  }
  /** Reports confirmed sign details; two reports hide them until an admin decides. */
  flagReading(id: string, token: string, reason: string) {
    const user = this.store.session(token);
    if (!this.store.db.prepare("SELECT 1 FROM sign_readings WHERE id=?").get(id)) throw Object.assign(new Error("Sign not found."), { statusCode: 404 });
    this.store.db.prepare("INSERT INTO content_flags(reading_id,session_id,reason,created) VALUES (?,?,?,?) ON CONFLICT DO NOTHING").run(id, user.id, reason, Date.now());
    return { flagged: true as const };
  }
  flaggedReadings() {
    return this.store.db.prepare("SELECT r.id AS reading_id,r.place_id,r.info,COUNT(f.session_id) AS reports,GROUP_CONCAT(f.reason) AS reasons,MAX(f.created) AS latest FROM content_flags f JOIN sign_readings r ON r.id=f.reading_id GROUP BY r.id,r.place_id,r.info ORDER BY latest DESC").all() as { reading_id: string; place_id: string; info: string; reports: number; reasons: string; latest: number }[];
  }
  resolveFlags(id: string, remove: boolean) {
    if (!this.store.db.prepare("SELECT 1 FROM sign_readings WHERE id=?").get(id)) throw Object.assign(new Error("Sign not found."), { statusCode: 404 });
    this.store.db.prepare(remove ? "DELETE FROM sign_readings WHERE id=?" : "DELETE FROM content_flags WHERE reading_id=?").run(id);
    return { removed: remove };
  }
  enrich(places: ParkingPlace[], ids: string[] | null = places.length === 1 ? [places[0].id] : null) {
    return enrichPlaces(this.query, places, ids);
  }
  changes(catalog: Catalog, since: number) {
    return catalogDelta(this.query, catalog, since, async ids => this.store.places(ids));
  }
}
