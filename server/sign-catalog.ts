import { insidePolygon } from "../src/domain/arrival";
import { normalizeZoneCode, UNKNOWN_AVAILABILITY } from "../src/domain/parking";
import type { Catalog, Geometry, ParkingPlace, PaymentSchedule, SignInfo } from "../src/domain/types";
import { smsZoneMatches } from "../src/domain/sms-payment";
import { officialSmsPayment } from "../src/domain/skopje-rules";
import { CONTRIBUTION_COSMETICS_QUERY, contributionAccents, type ContributionCosmeticRow } from "./cosmetics";

/** Confirmed details a driver read from a sign on their phone. The photo never reaches the server. */
export type ReadingRow = { id: string; place_id: string; info: string; model: string | null; created: number };
/** Two independent reports hide a sign reading from everyone until an admin reviews it. */
export const FLAG_THRESHOLD = 2;
export const HIDDEN_READINGS = `SELECT reading_id FROM content_flags GROUP BY reading_id HAVING COUNT(*)>=${FLAG_THRESHOLD}`;
export const FLAG_REASONS = ["offensive", "personal", "spam", "wrong"] as const;
export type Query = (sql: string, args?: unknown[]) => Promise<Record<string, unknown>[]>;

export function enrichSigns(
  places: ParkingPlace[],
  boundaryRows: { place_id: string; geometry: string }[],
  labels: { place_id: string; code: string }[],
  readings: ReadingRow[],
): ParkingPlace[] {
  const boundaries = new Map(boundaryRows.map(row => [row.place_id, JSON.parse(row.geometry) as Geometry]));
  const latest = new Map<string, string>();
  for (const label of labels) if (!latest.has(label.place_id)) latest.set(label.place_id, label.code);
  const signs = new Map<string, ReadingRow>(), counts = new Map<string, number>();
  // Rows arrive newest first: the latest confirmed reading is the place's digital sign.
  for (const reading of readings) {
    counts.set(reading.place_id, (counts.get(reading.place_id) ?? 0) + 1);
    if (!signs.has(reading.place_id)) signs.set(reading.place_id, reading);
  }
  const enriched: ParkingPlace[] = places.map(place => {
    const reading = signs.get(place.id);
    const info: SignInfo | null = reading ? JSON.parse(reading.info) : null;
    const geometry = boundaries.get(place.id) ?? place.geometry;
    const zoneCode = latest.get(place.id) ?? place.zoneCode ?? (info?.zoneCode ? normalizeZoneCode(info.zoneCode) : null);
    // Payment by SMS only follows the operators' published rules, and only while the zone keeps its code.
    const official = officialSmsPayment(place);
    const smsPayment = official && smsZoneMatches(zoneCode, official.zoneCode) ? official : undefined;
    return {
      ...place, geometry, boundaryEvidence: boundaries.has(place.id) ? "community" as const : place.boundaryEvidence, smsPayment,
      ...(place.capacity === 0 && place.availability?.status === "spaces"
        ? { availability: { ...UNKNOWN_AVAILABILITY } }
        : place.capacity !== null && place.availability?.freeSpaces !== undefined && place.availability.freeSpaces > place.capacity
        ? { availability: { ...place.availability, freeSpaces: undefined } } : {}),
      ...(boundaries.has(place.id) ? { locationPrecision: undefined } : {}),
      signReadingCount: counts.get(place.id) ?? 0,
      signInfo: info && reading ? {
        ...info, readingId: reading.id, model: reading.model ?? "manual",
        observedAt: new Date(Number(reading.created)).toISOString(),
        confirmedAt: new Date(Number(reading.created)).toISOString(),
        sourcePlaceId: place.id, sourcePlaceName: place.name,
      } : undefined,
      zoneCode,
      zoneCodeEvidence: latest.has(place.id) ? "community" : place.zoneCode ? place.zoneCodeEvidence : info?.zoneCode ? "sign" : undefined,
      paymentSchedule: place.paymentSchedule ?? (info ? { chargingHours: info.chargingHours, freeWeekends: info.freeWeekends ?? null } : undefined),
    };
  });
  const zones = enriched.filter(p => p.kind === "zone" && p.geometry && p.signInfo);
  return enriched.map(place => {
    if (place.signInfo || place.kind === "zone") return place;
    const candidates = zones.filter(zone => insidePolygon(place.coordinate, zone.geometry!) &&
      (!place.zoneCode || normalizeZoneCode(place.zoneCode) === normalizeZoneCode(zone.zoneCode ?? zone.signInfo!.zoneCode ?? "")) &&
      (!place.operator || !zone.operator || place.operator === zone.operator));
    // An overlapping zone with contradictory rules needs a person to resolve it.
    if (candidates.length !== 1) return place;
    const zone = candidates[0];
    // A sign can disagree with an existing/community zone label. Keep the evidence visible on
    // that zone, but never infer another parking's tariff from the conflict.
    if (zone.zoneCode && zone.signInfo!.zoneCode &&
      normalizeZoneCode(zone.zoneCode) !== normalizeZoneCode(zone.signInfo!.zoneCode)) return place;
    return { ...place, signInfo: zone.signInfo, zoneCode: place.zoneCode ?? zone.zoneCode,
      zoneCodeEvidence: place.zoneCodeEvidence ?? "sign",
      paymentSchedule: place.paymentSchedule ?? { chargingHours: zone.signInfo!.chargingHours, freeWeekends: zone.signInfo!.freeWeekends ?? null } };
  });
}

const inList = (ids: string[]) => ids.map(() => "?").join(",");
/** Community overlays for the given places; `ids` limits every read to those places (null = all). */
export async function enrichPlaces(query: Query, places: ParkingPlace[], ids: string[] | null) {
  const where = (column: string) => ids ? ` WHERE ${column} IN (${inList(ids)})` : "";
  const and = (column: string) => ids ? ` AND ${column} IN (${inList(ids)})` : "";
  const args = ids ?? [];
  const [accentRows, boundaries, labels, readings, capacities, schedules] = await Promise.all([
    query(CONTRIBUTION_COSMETICS_QUERY + and("d.place_id"), args),
    query("SELECT place_id,geometry FROM boundaries" + where("place_id"), args),
    query("SELECT place_id,code FROM labels" + where("place_id") + " ORDER BY created DESC", args),
    query(`SELECT id,place_id,info,model,created FROM sign_readings WHERE id NOT IN (${HIDDEN_READINGS})` + and("place_id") + " ORDER BY created DESC,id DESC", args),
    query("SELECT place_id,capacity FROM capacity_reports" + where("place_id") + " ORDER BY updated DESC,session_id DESC", args),
    query("SELECT place_id,details FROM payment_schedules" + where("place_id") + " ORDER BY updated DESC,session_id DESC", args),
  ]);
  const accents = contributionAccents(accentRows as ContributionCosmeticRow[]);
  const latest = new Map<string, number>();
  for (const row of capacities as { place_id: string; capacity: number }[]) if (!latest.has(row.place_id)) latest.set(row.place_id, Number(row.capacity));
  const payments = new Map<string, PaymentSchedule>();
  for (const row of schedules as { place_id: string; details: string }[]) if (!payments.has(row.place_id)) payments.set(row.place_id, JSON.parse(row.details));
  return enrichSigns(places.map(place => ({ ...place, paymentSchedule: payments.get(place.id) ?? place.paymentSchedule, capacity: latest.has(place.id) ? latest.get(place.id)! : place.capacity, contributionAccent: accents.get(place.id) })),
    boundaries as { place_id: string; geometry: string }[], labels as { place_id: string; code: string }[], readings as ReadingRow[]);
}

/** The cursor stays this far behind the clock, so a write stamped earlier but committed later is never
 * skipped; only changes from these last seconds are sent twice. Transactions are far shorter. */
export const CHANGE_SETTLE_MS = 15_000;
const settledCursor = (since: number, newest: unknown, now: number) => Math.max(since, Math.min(Number(newest ?? 0), now - CHANGE_SETTLE_MS));
/**
 * Which places to send for a delta since `since`: those written to, every sector sharing a changed
 * zone's operator and code (they share its price), and parkings inside a changed zone (they inherit
 * its sign). `assemble` adds zones containing changed parkings, needed to compute their inherited sign.
 */
export async function catalogChanges(query: Query, catalog: Catalog, since: number, now = Date.now()) {
  const [rows, [newest]] = await Promise.all([
    query("SELECT place_id,removed FROM place_changes WHERE changed>?", [since]),
    query("SELECT MAX(changed) AS changed FROM place_changes"),
  ]);
  const cursor = settledCursor(since, newest?.changed, now);
  const removed = rows.filter(row => Number(row.removed) === 1 || row.removed === true).map(row => String(row.place_id));
  const direct = new Set(rows.filter(row => !removed.includes(String(row.place_id))).map(row => String(row.place_id)));
  if (!direct.size) return { cursor, removed, output: new Set<string>(), assemble: [] as string[] };
  // Seed places come from the bundled catalog; only community places are read from the database.
  const community = (await query("SELECT data FROM places WHERE id LIKE 'community:%'")).map(row => JSON.parse(String(row.data)) as ParkingPlace);
  const index = new Map<string, ParkingPlace>([...catalog.places, ...community].map(place => [place.id, place]));
  const outlines = new Map((await query(`SELECT place_id,geometry FROM boundaries WHERE place_id IN (${inList([...direct])})`, [...direct]))
    .map(row => [String(row.place_id), JSON.parse(String(row.geometry)) as Geometry]));
  const key = (place: ParkingPlace) => place.kind === "zone" && place.operator && place.zoneCode ? `${place.operator}:${place.zoneCode}` : null;
  const changed = [...direct].map(id => index.get(id)).filter((place): place is ParkingPlace => Boolean(place));
  const zoneKeys = new Set(changed.map(key).filter(Boolean));
  const zones = changed.filter(place => place.kind === "zone").map(place => ({ ...place, geometry: outlines.get(place.id) ?? place.geometry })).filter(place => place.geometry);
  const output = new Set(direct);
  for (const place of index.values()) {
    if (zoneKeys.has(key(place))) output.add(place.id);
    else if (place.kind !== "zone" && zones.some(zone => insidePolygon(place.coordinate, zone.geometry!))) output.add(place.id);
  }
  const assemble = new Set(output);
  const parkings = [...output].map(id => index.get(id)).filter(place => place && place.kind !== "zone") as ParkingPlace[];
  for (const zone of index.values())
    if (zone.kind === "zone" && zone.geometry && parkings.some(place => insidePolygon(place.coordinate, zone.geometry!))) assemble.add(zone.id);
  return { cursor, removed, output, assemble: [...assemble] };
}

/** Full catalog (since = 0, a fresh install or monthly resync) or only what changed since a cursor. */
export async function catalogDelta(query: Query, catalog: Catalog, since: number, load: (ids?: string[]) => Promise<ParkingPlace[]>) {
  if (!since) {
    const [newest] = await query("SELECT MAX(changed) AS changed FROM place_changes");
    return { cursor: settledCursor(0, newest?.changed, Date.now()), full: true, places: await enrichPlaces(query, await load(), null), removed: [] as string[] };
  }
  const delta = await catalogChanges(query, catalog, since);
  if (!delta.assemble.length) return { cursor: delta.cursor, full: false, places: [] as ParkingPlace[], removed: delta.removed };
  const assembled = await enrichPlaces(query, await load(delta.assemble), delta.assemble);
  const places = assembled.filter(place => delta.output.has(place.id));
  // A place hidden by a "not here" report leaves the assembled view, so phones drop it too.
  const shown = new Set(places.map(place => place.id));
  const removed = [...new Set([...delta.removed, ...delta.output])].filter(id => !shown.has(id));
  return { cursor: delta.cursor, full: false, places, removed };
}
