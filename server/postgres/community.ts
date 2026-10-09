import type { RewardKind } from "../../src/domain/account";
import { CONTRIBUTION_COSMETICS_QUERY, contributionAccents, type ContributionCosmeticRow } from "../cosmetics";
import { createHash, randomUUID } from "node:crypto";
import type {
  Contribution,
  Geometry,
  ParkingPlace,
  PaymentSchedule,
  SignInfo,
  SignReading,
  Catalog,
} from "../../src/domain/types";
import { normalizeZoneCode } from "../../src/domain/parking";
import type { PostgresParkingStore } from "./store";
import { catalogDelta, enrichPlaces, type Query } from "../sign-catalog";
export class PostgresCommunityStore {
  constructor(private store: PostgresParkingStore) {}

  async contribute(input: Contribution, token: string) {
    const user = await this.store.session(token);
    const previous = (await this.store.db
      .prepare(
        "SELECT place_id FROM contributions WHERE request_id=? AND session_id=?",
      )
      .get(input.requestId, user.id)) as
      | {
          place_id: string;
        }
      | undefined;
    if (previous) return await this.store.place(previous.place_id);
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
    return await this.store.db.transaction(async () => {
      // Serialize retries from one device; a timed-out POST must not add a second zone.
      await this.store.db
        .prepare("SELECT id FROM sessions WHERE id=? FOR UPDATE")
        .get(user.id);
      const retry = (await this.store.db
        .prepare(
          "SELECT place_id FROM contributions WHERE request_id=? AND session_id=?",
        )
        .get(input.requestId, user.id)) as { place_id: string } | undefined;
      if (retry) return await this.store.place(retry.place_id);
      await this.store.db
        .prepare("INSERT INTO places VALUES (?,?)")
        .run(place.id, JSON.stringify(place));
      await this.store.db
        .prepare("INSERT INTO contributions VALUES (?,?,?)")
        .run(input.requestId, user.id, place.id);
      const kinds: RewardKind[] = [];
      if (input.geometry) kinds.push("boundary");
      if (input.firstHour !== null) kinds.push("pricing");
      if (input.capacity != null) kinds.push("capacity");
      if (input.freeSpaces != null && input.kind !== "zone") kinds.push("availability");
      await this.store.db.prepare("INSERT INTO contribution_details(place_id,session_id,details,created) VALUES (?,?,?,?)")
        .run(place.id,user.id,JSON.stringify(kinds),Date.now());
      if (input.firstHour !== null)
        await this.store.reportPrice(
          place.id,
          token,
          input.firstHour,
          input.nextHour ?? input.firstHour,
        );
      if (input.freeSpaces !== undefined && input.freeSpaces !== null && input.kind !== "zone")
        await this.store.report(place.id, token, input.freeSpaces > 0 ? "spaces" : "full", input.freeSpaces);
      return place;
    });
  }
  async contributionRewards(id: string, token: string) {
    const user = await this.store.session(token);
    const row = (await this.store.db.prepare("SELECT details,created FROM contribution_details WHERE place_id=? AND session_id=?").get(id,user.id)) as {details:string;created:number}|undefined;
    return {kinds: row ? JSON.parse(row.details) as RewardKind[] : [], created: row?.created ?? Date.now()};
  }
  async label(id: string, token: string, code: string) {
    const user = await this.store.session(token);
    await this.store.place(id);
    await this.store.db.transaction(async () => {
    await this.store.db.prepare("SELECT id FROM places WHERE id=? FOR UPDATE").get(id);
    await this.store.db
      .prepare(
        "INSERT INTO labels VALUES (?,?,?,?) ON CONFLICT(place_id,session_id) DO UPDATE SET code=excluded.code,created=excluded.created",
      )
      .run(id, user.id, normalizeZoneCode(code), Date.now());
    });
    return { saved: true };
  }
  async boundary(id: string, token: string, geometry: Geometry) {
    await this.store.session(token);
    await this.store.place(id);
    await this.store.db.transaction(async () => {
    await this.store.db.prepare("SELECT id FROM places WHERE id=? FOR UPDATE").get(id);
    // Separate from the source catalog: importing official data must not erase edits.
    await this.store.db
      .prepare(
        "INSERT INTO boundaries VALUES (?,?,?) ON CONFLICT(place_id) DO UPDATE SET geometry=excluded.geometry,updated=excluded.updated",
      )
      .run(id, JSON.stringify(geometry), Date.now());
    });
    return { saved: true };
  }
  async paymentSchedule(id: string, token: string, value: PaymentSchedule) {
    const user = await this.store.session(token);
    await this.store.place(id);
    await this.store.db.prepare("INSERT INTO payment_schedules(place_id,session_id,details,updated) VALUES (?,?,?,?) ON CONFLICT(place_id,session_id) DO UPDATE SET details=excluded.details,updated=excluded.updated").run(id,user.id,JSON.stringify(value),Date.now());
    return { ok: true };
  }
  async capacity(id: string, token: string, capacity: number) {
    const user = await this.store.session(token);
    const place = await this.store.place(id);
    if (place.kind === "zone") throw Object.assign(new Error("Set capacity on an individual parking area."), {statusCode:400});
    await this.store.db.prepare("INSERT INTO capacity_reports(place_id,session_id,capacity,updated) VALUES (?,?,?,?) ON CONFLICT(place_id,session_id) DO UPDATE SET capacity=excluded.capacity,updated=excluded.updated").run(id,user.id,capacity,Date.now());
    return {saved:true};
  }
  private query: Query = async (sql, args = []) => (await this.store.db.prepare(sql).all(...args)) as Record<string, unknown>[];
  /** Details a driver confirmed from a sign they read on their phone; the photo never leaves it. */
  async addSignReading(placeId: string, token: string, info: SignInfo, model: string): Promise<SignReading> {
    const user = await this.store.session(token);
    await this.store.place(placeId);
    if (!info.isParkingSign) throw Object.assign(new Error("Only parking signs can be confirmed."), { statusCode: 400 });
    const id = randomUUID(), created = Date.now();
    await this.store.db.prepare("INSERT INTO sign_readings(id,place_id,session_id,info,model,created) VALUES (?,?,?,?,?,?)")
      .run(id, placeId, user.id, JSON.stringify(info), model, created);
    return { id, placeId, createdAt: new Date(created).toISOString() };
  }
  /** Reports confirmed sign details; two reports hide them until an admin decides. */
  async flagReading(id: string, token: string, reason: string) {
    const user = await this.store.session(token);
    if (!(await this.store.db.prepare("SELECT 1 FROM sign_readings WHERE id=?").get(id))) throw Object.assign(new Error("Sign not found."), { statusCode: 404 });
    await this.store.db.prepare("INSERT INTO content_flags(reading_id,session_id,reason,created) VALUES (?,?,?,?) ON CONFLICT DO NOTHING").run(id, user.id, reason, Date.now());
    return { flagged: true as const };
  }
  async flaggedReadings() {
    return (await this.store.db.prepare("SELECT r.id AS reading_id,r.place_id,r.info,COUNT(f.session_id)::int AS reports,STRING_AGG(f.reason,',') AS reasons,MAX(f.created) AS latest FROM content_flags f JOIN sign_readings r ON r.id=f.reading_id GROUP BY r.id,r.place_id,r.info ORDER BY latest DESC").all()) as { reading_id: string; place_id: string; info: string; reports: number; reasons: string; latest: number }[];
  }
  async resolveFlags(id: string, remove: boolean) {
    if (!(await this.store.db.prepare("SELECT 1 FROM sign_readings WHERE id=?").get(id))) throw Object.assign(new Error("Sign not found."), { statusCode: 404 });
    await this.store.db.prepare(remove ? "DELETE FROM sign_readings WHERE id=?" : "DELETE FROM content_flags WHERE reading_id=?").run(id);
    return { removed: remove };
  }
  enrich(places: ParkingPlace[], ids: string[] | null = places.length === 1 ? [places[0].id] : null) {
    return enrichPlaces(this.query, places, ids);
  }
  changes(catalog: Catalog, since: number) {
    return catalogDelta(this.query, catalog, since, ids => this.store.places(ids));
  }
}
