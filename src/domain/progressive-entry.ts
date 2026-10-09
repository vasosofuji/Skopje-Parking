import type { Contribution, Geometry, ParkingPlace, PaymentSchedule } from "./types";
import { validZone } from "./geometry";
import { parkingPrice } from "./parking";

export type EntryApi = {
  contribute: (value: Contribution) => Promise<ParkingPlace>;
  label: (id: string, code: string) => Promise<unknown>;
  price: (id: string, first: number, next: number) => Promise<unknown>;
  paymentSchedule: (id: string, value: PaymentSchedule) => Promise<unknown>;
  capacity: (id: string, total: number) => Promise<unknown>;
  report: (id: string, status: "spaces" | "full", free?: number) => Promise<unknown>;
  boundary: (id: string, geometry: Geometry) => Promise<unknown>;
};
export type EntrySnapshot = { id?: string; code: string | null; total: number | null; price: string; schedule?: string; free?: number; boundary: string; contributed?: boolean };

/** One editor owns one writer. Successful steps remain saved even if a later one fails. */
export function createProgressiveEntry(api: EntryApi, initial: {
  place?: ParkingPlace;
  placeId?: string;
  contribution?: Contribution;
  onSaved?: (id: string) => void;
  snapshot?: EntrySnapshot;
}) {
  let id = initial.snapshot?.id ?? initial.place?.id ?? initial.placeId;
  let creating: Promise<string> | undefined;
  let code = initial.snapshot?.code ?? initial.place?.zoneCode ?? null;
  let total = initial.snapshot?.total ?? initial.place?.capacity ?? null;
  const knownPrice = initial.place ? parkingPrice(initial.place) : null;
  let price = initial.snapshot?.price ?? (knownPrice ? `${knownPrice.firstHour}:${knownPrice.nextHour}` : "");
  let schedule = initial.snapshot?.schedule ?? (initial.place?.paymentSchedule ? JSON.stringify(initial.place.paymentSchedule) : "");
  let free = initial.snapshot?.free;
  let boundary = initial.snapshot?.boundary ?? (initial.place?.geometry ? JSON.stringify(initial.place.geometry) : "");
  let tail: Promise<unknown> = Promise.resolve();
  let contributed = Boolean(initial.snapshot?.contributed);

  async function ensure(zoneCode?: string) {
    if (id) return id;
    if (!initial.contribution) throw new Error("A parking location is required.");
    if (!creating) {
      creating = api.contribute({ ...initial.contribution, zoneCode: zoneCode || initial.contribution.zoneCode }).then(place => {
        id = place.id;
        code = place.zoneCode;
        total = place.capacity;
        boundary = place.geometry ? JSON.stringify(place.geometry) : "";
        if (zoneCode || initial.contribution?.zoneCode || initial.contribution?.geometry || initial.contribution?.firstHour !== null && initial.contribution?.firstHour !== undefined) contributed = true;
        initial.onSaved?.(place.id);
        return place.id;
      }).finally(() => { creating = undefined; });
    }
    return creating;
  }
  function serial(work: () => Promise<void>) {
    // A rejected step is retryable without poisoning subsequent explicit attempts.
    const next = tail.catch(() => undefined).then(work);
    tail = next;
    return next;
  }
  return {
    id: () => id,
    snapshot: (): EntrySnapshot => ({ id, code, total, price, free, boundary, ...(schedule ? { schedule } : {}), ...(contributed ? { contributed: true } : {}) }),
    label: (value: string) => serial(async () => {
      const placeId = await ensure(value);
      if (value && value !== code) { await api.label(placeId, value); code = value; contributed = true; }
    }),
    price: (first: number, next: number) => serial(async () => {
      const placeId = await ensure(), key = `${first}:${next}`;
      if (price !== key) { await api.price(placeId, first, next); price = key; contributed = true; }
    }),
    paymentSchedule: (value: PaymentSchedule) => serial(async () => {
      const placeId = await ensure(), key = JSON.stringify(value);
      if (key !== schedule) {
        const wasMeaningful = schedule && schedule !== JSON.stringify({ chargingHours: null, freeWeekends: null });
        await api.paymentSchedule(placeId, value); schedule = key;
        if (value.chargingHours || value.freeWeekends !== null || wasMeaningful) contributed = true;
      }
    }),
    spaces: (capacity: number | null, available: number | null) => serial(async () => {
      const placeId = await ensure();
      if (capacity !== null && capacity !== total) { await api.capacity(placeId, capacity); total = capacity; contributed = true; }
      if (available !== null && available !== free) { await api.report(placeId, available === 0 ? "full" : "spaces", available); free = available; contributed = true; }
    }),
    boundary: (geometry: Geometry) => serial(async () => {
      const placeId = await ensure(), value = JSON.stringify(geometry);
      if (value !== boundary) { await api.boundary(placeId, geometry); boundary = value; contributed = true; }
    }),
    ensure: () => serial(async () => { await ensure(); }),
  };
}

/** Skopje zones cost 25–100 MKD an hour and garages rarely more; higher entries need a second look. */
export const UNUSUAL_HOURLY_PRICE = 300;
export function priceInput(first: string, next: string): { first: number; next: number } | null {
  if (!first.trim() && !next.trim()) return null;
  if (!first.trim()) throw new Error("first-required");
  const a = Number(first.replace(",", ".")), b = next.trim() ? Number(next.replace(",", ".")) : a;
  if ([a, b].some(value => !Number.isFinite(value) || value < 0 || value > 10000)) throw new Error("price-range");
  return { first: a, next: b };
}

export function spacesInput(capacity: string, free: string, knownCapacity: number | null = null) {
  const total = capacity.trim() ? Number(capacity) : null, available = free.trim() ? Number(free) : null;
  if ([total, available].some(value => value !== null && (!Number.isInteger(value) || value < 0 || value > 100000))) throw new Error("spaces-range");
  const effectiveTotal = total ?? knownCapacity;
  if (effectiveTotal !== null && available !== null && available > effectiveTotal) throw new Error("spaces-exceed-capacity");
  return { total, available };
}

/** Explicit requirements for manual forms; zero is a price/free count, never blank. */
export function manualPriceInput(first: string, next: string) {
  const value = priceInput(first, next);
  if (!value) throw new Error("price-required");
  return value;
}
export function manualSpacesInput(capacity: string) {
  const value = spacesInput(capacity, "");
  if (value.total === null) throw new Error("spaces-required");
  return value as { total: number; available: null };
}

/** Legacy/unfinished drafts cannot claim completion merely by restoring 'done'. */
export function incompleteManualStep(snapshot: EntrySnapshot, options: {
  detailed: boolean; zone: boolean; afterSign: boolean; geometry?: Geometry; existingGeometry?: Geometry;
}): "price" | "spaces" | "perimeter" | null {
  if (!options.afterSign && !snapshot.price) return "price";
  if (options.detailed && !options.zone && snapshot.total === null) return "spaces";
  // Catalog areas can have holes. An unchanged imported perimeter is already
  // public and should not be replaced merely to fit the single-ring drawing UI.
  const existing = options.geometry && options.existingGeometry && JSON.stringify(options.geometry) === JSON.stringify(options.existingGeometry);
  if (options.detailed && (!options.geometry || (!existing && !validZone(options.geometry)))) return "perimeter";
  return null;
}
