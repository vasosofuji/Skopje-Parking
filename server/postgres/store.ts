import type { StoreDatabase } from "./database";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  Catalog,
  Coordinate,
  ParkingPlace,
  Proposal,
  Availability,
} from "../../src/domain/types";
import {
  CONSENSUS_VOTES,
  SESSION_MATURITY_MS,
  REPORT_TTL_MS,
  OPERATOR_TTL_MS,
  distanceMeters,
  UNKNOWN_AVAILABILITY,
} from "../../src/domain/parking";
import { assemblePlaces, placeQueries, type PlaceRows } from "../store";
export class PostgresParkingStore {
  db: StoreDatabase;
  constructor(
    db: StoreDatabase,
    private clock: () => number = Date.now,
    readonly trustInputs = false,
  ) {
    this.db = db;
  }
  async seed(catalog: Catalog) {
    await this.db
      .prepare(
        // Every cold start seeds; rewriting unchanged rows would only churn locks and WAL.
        "INSERT INTO places(id,data) SELECT item->>'id', item::text FROM jsonb_array_elements(?::jsonb) item ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE places.data IS DISTINCT FROM excluded.data",
      )
      .run(JSON.stringify(catalog.places));
  }

  async createSession() {
    const token = randomBytes(32).toString("hex"),
      id = randomUUID();
    await this.db
      .prepare("INSERT INTO sessions VALUES (?,?,?)")
      .run(id, createHash("sha256").update(token).digest("hex"), this.clock());
    return {
      token,
      maturesAt: new Date(
        this.clock() + (this.trustInputs ? 0 : SESSION_MATURITY_MS),
      ).toISOString(),
    };
  }
  async session(token: string) {
    const hash = createHash("sha256").update(token).digest("hex");
    const row = (await this.db
      .prepare("SELECT id,created FROM sessions WHERE hash=? UNION ALL SELECT s.id,s.created FROM sessions s JOIN auth_sessions a ON a.session_id=s.id WHERE a.hash=? AND a.expires>? LIMIT 1")
      .get(hash, hash, Date.now())) as
      | {
          id: string;
          created: number;
        }
      | undefined;
    if (!row)
      throw Object.assign(new Error("A valid session is required."), {
        statusCode: 401,
      });
    return row;
  }
  async place(id: string): Promise<ParkingPlace> {
    const row = (await this.db
      .prepare("SELECT data FROM places WHERE id=?")
      .get(id)) as
      | {
          data: string;
        }
      | undefined;
    if (!row)
      throw Object.assign(new Error("Parking location not found."), {
        statusCode: 404,
      });
    return JSON.parse(row.data);
  }
  async availability(id: string): Promise<Availability> {
    const now = this.clock();
    const operator = (await this.db
      .prepare(
        "SELECT free_spaces,observed FROM observations WHERE place_id=? AND observed>?",
      )
      .get(id, now - OPERATOR_TTL_MS)) as
      | {
          free_spaces: number;
          observed: number;
        }
      | undefined;
    const rows = (await this.db
      .prepare(
        "SELECT status,observed,free_spaces FROM reports WHERE place_id=? AND observed>? ORDER BY observed DESC, rowid DESC",
      )
      .all(id, now - REPORT_TTL_MS)) as {
      status: "spaces" | "full";
      observed: number;
      free_spaces: number | null;
    }[];
    if (
      operator &&
      (!this.trustInputs ||
        !rows.length ||
        operator.observed >= rows[0].observed)
    )
      return {
        status: operator.free_spaces > 0 ? "spaces" : "full",
        source: "operator",
        freeSpaces: operator.free_spaces,
        reports: 0,
        observedAt: new Date(operator.observed).toISOString(),
        expiresAt: new Date(operator.observed + OPERATOR_TTL_MS).toISOString(),
      };
    if (!rows.length) return UNKNOWN_AVAILABILITY;
    const spaces = rows.filter((r) => r.status === "spaces").length;
    const status = this.trustInputs
      ? rows[0].status
      : spaces === rows.length
        ? "spaces"
        : spaces === 0
          ? "full"
          : "mixed";
    // Expire the aggregate at the oldest report's expiry so clients cannot keep a stale conflict alive.
    return {
      status,
      source: "community",
      ...(status !== "mixed" && rows[0].free_spaces !== null ? { freeSpaces: rows[0].free_spaces } : {}),
      reports: rows.length,
      observedAt: new Date(rows[0].observed).toISOString(),
      expiresAt: new Date(
        rows[this.trustInputs ? 0 : rows.length - 1].observed + REPORT_TTL_MS,
      ).toISOString(),
    };
  }
  async publishReadyProposals() {
    const pending = (await this.db
      .prepare("SELECT id FROM proposals WHERE status='pending'")
      .all()) as {
      id: string;
    }[];
    for (const row of pending) {
      const proposal = await this.proposal(row.id);
      if (proposal.eligibleVotes < proposal.requiredVotes) continue;
      await this.publishProposal(proposal);
    }
  }
  private async publishProposal(proposal: Proposal) {
    return await this.db.transaction(async () => {
      await this.db
        .prepare("SELECT id FROM proposals WHERE id=? FOR UPDATE")
        .get(proposal.id);
      const current = await this.proposal(proposal.id);
      if (
        current.status === "pending" &&
        current.eligibleVotes >= current.requiredVotes
      ) {
        const place: ParkingPlace = {
          id: "community:" + current.id,
          name: current.name,
          coordinate: current.coordinate,
          kind: current.kind,
          operator: null,
          zoneCode: current.zoneCode,
          access: "unknown",
          tariff: null,
          capacity: null,
          openingHours: null,
          verification: "community",
          source: {
            label: "Community confirmed location; sign and access unverified",
            url: "",
            retrievedAt: new Date(this.clock()).toISOString(),
          },
        };
        await this.db
          .prepare("INSERT INTO places VALUES (?,?)")
          .run(place.id, JSON.stringify(place));
        await this.db
          .prepare("UPDATE proposals SET status='published' WHERE id=?")
          .run(current.id);
      }
    });
  }
  async places(ids?: string[]): Promise<ParkingPlace[]> {
    const now = this.clock();
    // Fixed number of database trips, independent of how many parking places exist.
    const rows = await Promise.all(placeQueries(now, ids).map(([sql, ...args]) => this.db.prepare(sql).all(...args)));
    return assemblePlaces(rows as PlaceRows, now, this.trustInputs);
  }
  async report(placeId: string, token: string, status: "spaces" | "full", freeSpaces?: number) {
    const user = await this.session(token),
      place = await this.place(placeId);
    if (place.kind === "zone" || place.access === "restricted")
      throw Object.assign(
        new Error("Reports are available for accessible parking locations."),
        { statusCode: 400 },
      );
    const capacityRow = (await this.db.prepare("SELECT capacity FROM capacity_reports WHERE place_id=? ORDER BY updated DESC,session_id DESC LIMIT 1").get(placeId)) as {capacity:number}|undefined;
    const capacity = capacityRow?.capacity ?? place.capacity;
    if (capacity === 0 && status === "spaces")
      throw Object.assign(new Error("This parking is recorded as having no spaces. Correct its capacity before reporting availability."), { statusCode: 400 });
    if (freeSpaces !== undefined && (!Number.isInteger(freeSpaces) || freeSpaces < 0 || freeSpaces > 100000 ||
      (capacity !== null && freeSpaces > capacity) || (status === "full" ? freeSpaces !== 0 : freeSpaces === 0)))
      throw Object.assign(new Error("Free spaces must match availability and cannot exceed capacity."), { statusCode: 400 });
    await this.db
      .prepare(
        "INSERT INTO reports(place_id,session_id,status,observed,free_spaces) VALUES (?,?,?,?,?) ON CONFLICT(place_id,session_id) DO UPDATE SET status=excluded.status,observed=excluded.observed,free_spaces=excluded.free_spaces",
      )
      .run(placeId, user.id, status, this.clock(), status === "full" ? 0 : freeSpaces ?? null);
    await this.db
      .prepare("DELETE FROM reports WHERE observed<=?")
      .run(this.clock() - REPORT_TTL_MS);
    return await this.availability(placeId);
  }
  async reportPrice(
    placeId: string,
    token: string,
    firstHour: number,
    nextHour: number,
  ) {
    const user = await this.session(token);
    const place = await this.place(placeId);
    await this.db
      .prepare(
        "INSERT INTO price_reports VALUES (?,?,?,?,?) ON CONFLICT(place_id,session_id) DO UPDATE SET first_hour=excluded.first_hour,next_hour=excluded.next_hour,observed=excluded.observed",
      )
      .run(
        await this.priceTarget(place),
        user.id,
        firstHour,
        nextHour,
        this.clock(),
      );
    return { saved: true };
  }
  private async priceTarget(place: ParkingPlace): Promise<string> {
    if (place.kind !== "zone" || !place.zoneCode || !place.operator)
      return place.id;
    const row = (await this.db
      .prepare(
        "SELECT id FROM places WHERE json_extract(data,'$.kind')='zone' AND json_extract(data,'$.zoneCode')=? AND json_extract(data,'$.operator')=? ORDER BY id LIMIT 1",
      )
      .get(place.zoneCode, place.operator)) as
      | {
          id: string;
        }
      | undefined;
    return row?.id ?? place.id;
  }
  async confirmLocation(placeId: string, token: string, present: boolean) {
    const user = await this.session(token),
      place = await this.place(placeId);
    if (place.kind === "zone")
      throw Object.assign(
        new Error("Confirm a parking location, not an entire zone."),
        { statusCode: 400 },
      );
    await this.db
      .prepare(
        "INSERT INTO location_reports VALUES (?,?,?,?) ON CONFLICT(place_id,session_id) DO UPDATE SET present=excluded.present,observed=excluded.observed",
      )
      .run(placeId, user.id, present ? 1 : 0, this.clock());
    return { saved: true };
  }
  async propose(
    input: {
      name: string;
      coordinate: Coordinate;
      kind: Proposal["kind"];
      zoneCode: string | null;
      note: string;
    },
    token: string,
  ) {
    const session = await this.session(token);
    const nearby = (await this.proposals()).find(
      (p) =>
        p.status !== "rejected" &&
        distanceMeters(p.coordinate, input.coordinate) < 25,
    );
    if (nearby) return await this.vote(nearby.id, token);
    if (
      (await this.places()).some(
        (p) =>
          p.kind !== "zone" &&
          distanceMeters(p.coordinate, input.coordinate) < 15,
      )
    )
      throw Object.assign(
        new Error(
          "A mapped parking location is already here. Select it to report availability.",
        ),
        { statusCode: 409 },
      );
    const id = randomUUID(),
      created = this.clock();
    await this.db
      .prepare("INSERT INTO proposals VALUES (?,?,?,?)")
      .run(id, JSON.stringify({ ...input, id }), "pending", created);
    await this.db.prepare("INSERT INTO votes VALUES (?,?)").run(id, session.id);
    return await this.vote(id, token);
  }
  async proposal(id: string): Promise<Proposal> {
    const row = (await this.db
      .prepare("SELECT data,status,created FROM proposals WHERE id=?")
      .get(id)) as
      | {
          data: string;
          status: Proposal["status"];
          created: number;
        }
      | undefined;
    if (!row)
      throw Object.assign(new Error("Proposal not found."), {
        statusCode: 404,
      });
    const total = (await this.db
      .prepare("SELECT COUNT(*) AS n FROM votes WHERE proposal_id=?")
      .get(id)) as {
      n: number;
    };
    const eligible = (await this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM votes JOIN sessions ON sessions.id=votes.session_id WHERE proposal_id=? AND sessions.created<=?",
      )
      .get(id, this.clock() - SESSION_MATURITY_MS)) as {
      n: number;
    };
    return {
      ...JSON.parse(row.data),
      status: row.status,
      createdAt: new Date(row.created).toISOString(),
      votes: total.n,
      eligibleVotes: this.trustInputs ? total.n : eligible.n,
      requiredVotes: this.trustInputs ? 1 : CONSENSUS_VOTES,
    };
  }
  async proposals() {
    return await Promise.all(
      (
        (await this.db
          .prepare("SELECT id FROM proposals ORDER BY created DESC")
          .all()) as {
          id: string;
        }[]
      ).map(async (row) => await this.proposal(row.id)),
    );
  }
  async vote(id: string, token: string) {
    const user = await this.session(token),
      proposal = await this.proposal(id);
    if (proposal.status !== "pending") return proposal;
    await this.db
      .prepare("INSERT OR IGNORE INTO votes VALUES (?,?)")
      .run(id, user.id);
    await this.publishProposal(await this.proposal(id));
    return await this.proposal(id);
  }
  async observe(
    operator: string,
    input: {
      placeId: string;
      freeSpaces: number;
      observedAt: string;
    }[],
  ) {
    const now = this.clock();
    for (const observation of input) {
      const place = await this.place(observation.placeId),
        observed = Date.parse(observation.observedAt);
      if (place.operator !== operator || place.kind === "zone")
        throw Object.assign(
          new Error("Feed cannot update a location owned by another operator."),
          { statusCode: 403 },
        );
      if (observed > now + 30000 || observed <= now - OPERATOR_TTL_MS)
        throw Object.assign(
          new Error("Observation must be fresh and cannot be in the future."),
          { statusCode: 400 },
        );
      if (place.capacity !== null && observation.freeSpaces > place.capacity)
        throw Object.assign(new Error("Free spaces exceed capacity."), {
          statusCode: 400,
        });
    }
    return await this.db.transaction(async () => {
      const update = this.db.prepare(
        "INSERT INTO observations VALUES (?,?,?,?) ON CONFLICT(place_id) DO UPDATE SET free_spaces=excluded.free_spaces,observed=excluded.observed,operator=excluded.operator WHERE excluded.observed>observations.observed",
      );
      for (const observation of input)
        await update.run(
          observation.placeId,
          operator,
          observation.freeSpaces,
          Date.parse(observation.observedAt),
        );
      return { accepted: input.length };
    });
  }
  async moderate(id: string) {
    await this.proposal(id);
    await this.db
      .prepare("UPDATE proposals SET status='rejected' WHERE id=?")
      .run(id);
    await this.db
      .prepare("DELETE FROM reports WHERE place_id=?")
      .run("community:" + id);
    await this.db
      .prepare("DELETE FROM observations WHERE place_id=?")
      .run("community:" + id);
    await this.db
      .prepare("DELETE FROM price_reports WHERE place_id=?")
      .run("community:" + id);
    await this.db
      .prepare("DELETE FROM location_reports WHERE place_id=?")
      .run("community:" + id);
    await this.db
      .prepare("DELETE FROM places WHERE id=?")
      .run("community:" + id);
    return await this.proposal(id);
  }
  async deleteSession(token: string) {
    const user = await this.session(token);
    return await this.db.transaction(async () => {
      await this.db
        .prepare("DELETE FROM reports WHERE session_id=?")
        .run(user.id);
      await this.db
        .prepare("DELETE FROM votes WHERE session_id=?")
        .run(user.id);
      await this.db
        .prepare("DELETE FROM price_reports WHERE session_id=?")
        .run(user.id);
      await this.db
        .prepare("DELETE FROM location_reports WHERE session_id=?")
        .run(user.id);
      await this.db.prepare("DELETE FROM sessions WHERE id=?").run(user.id);
    });
  }
  async close() {
    await this.db.close();
  }
}
