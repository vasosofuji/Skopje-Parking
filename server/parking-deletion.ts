import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Catalog, ParkingPlace } from "../src/domain/types";
import { ParkingStore } from "./store";
import { PostgresParkingStore } from "./postgres/store";
import { accountError, bearerToken } from "./account-security";

// Ownership comes from the contribution record, never from client-supplied metadata.
export function registerParkingDeletion(app: FastifyInstance, store: ParkingStore | PostgresParkingStore, catalog: Catalog) {
  const originals = new Set(catalog.places.map(place => place.id));
  const ownerSql = "SELECT session_id FROM contribution_details WHERE place_id=?";
  function eligible(place: ParkingPlace) {
    return !originals.has(place.id) && place.id.startsWith("community:") && place.verification === "community";
  }
  app.get<{ Params: { id: string } }>("/v1/places/:id/removal", async request => {
    const user = await store.session(bearerToken(request.headers.authorization));
    const place = await store.place(request.params.id);
    const owner = await store.db.prepare(ownerSql).get(place.id) as { session_id: string } | undefined;
    return { canRemove: eligible(place) && owner?.session_id === user.id };
  });
  app.delete<{ Params: { id: string } }>("/v1/places/:id", async request => {
    z.object({ confirmed: z.literal(true) }).strict().parse(request.body);
    const user = await store.session(bearerToken(request.headers.authorization));
    const id = request.params.id;
    const check = (place: ParkingPlace, owner: unknown) => {
      if (!eligible(place)) throw accountError("Original catalog parking cannot be removed.", 403);
      if ((owner as { session_id?: string } | undefined)?.session_id !== user.id)
        throw accountError("Only the contributor can remove this parking spot.", 403);
    };
    // The original report tables predate cascading foreign keys.
    const deletions = ["reports", "price_reports", "location_reports", "observations"].map(table => `DELETE FROM ${table} WHERE place_id=?`);
    deletions.push("DELETE FROM places WHERE id=?");
    // Points belong to parking that exists; otherwise create, collect, delete could repeat forever.
    const kinds = ["parking", "boundary", "pricing", "capacity", "sign"];
    const revoke = `DELETE FROM reward_events WHERE event_key IN (${kinds.map(() => "?").join(",")}) OR substr(event_key,1,?)=?`;
    const revokeArgs = [...kinds.map(kind => `${kind}:${id}`), `availability:${id}:`.length, `availability:${id}:`];
    if (store instanceof ParkingStore) {
      store.db.exec("BEGIN IMMEDIATE");
      try {
        check(store.place(id), store.db.prepare(ownerSql).get(id));
        for (const sql of deletions) store.db.prepare(sql).run(id);
        store.db.prepare(revoke).run(...revokeArgs);
        store.db.exec("COMMIT");
      } catch (error) { store.db.exec("ROLLBACK"); throw error; }
    } else {
      await store.db.transaction(async () => {
        // Lock the parent before deleting dependent information.
        await store.db.prepare("SELECT id FROM places WHERE id=? FOR UPDATE").get(id);
        check(await store.place(id), await store.db.prepare(ownerSql).get(id));
        for (const sql of deletions) await store.db.prepare(sql).run(id);
        await store.db.prepare(revoke).run(...revokeArgs);
      });
    }
    return { deleted: true };
  });
}
