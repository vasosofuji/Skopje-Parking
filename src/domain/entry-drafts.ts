import type { Geometry, PaymentSchedule } from "./types";
import type { EntrySnapshot } from "./progressive-entry";

export type EntryStep = "choose" | "details" | "zone" | "price" | "schedule" | "spaces" | "perimeter" | "done";
export type EntryOperation = { type: "schedule"; value: PaymentSchedule } | { type: "label"; code: string } | { type: "price"; first: number; next: number } | { type: "spaces"; total: number | null; available: number | null; observedAt?: number } | { type: "boundary"; geometry: Geometry } | { type: "ensure" };
export type EntryDraft = {
  version: 1; updatedAt: number; requestId: string; step: EntryStep; detailed: boolean; originalKey?: string;
  code: string; first: string; next: string; capacity: string; freeSpaces: string; freeObservedAt?: number;
  chargingHours?: string; freeWeekends?: PaymentSchedule["freeWeekends"];
  geometry?: Geometry; snapshot?: EntrySnapshot; pending: EntryOperation | null;
};
export type DraftStorage = {
  getItem: (key: string) => Promise<string | null>;
  multiSet: (values: [string, string][]) => Promise<void>;
  multiRemove: (keys: string[]) => Promise<void>;
};
export const entryDraftKey = (accountId: string, target: string) => `parkskopje-entry-v1:${encodeURIComponent(accountId)}:${encodeURIComponent(target)}`;
export const availabilityIsFresh = (observedAt: number | undefined, now = Date.now()) => observedAt !== undefined && observedAt <= now && now - observedAt <= 15 * 60_000;
export async function readEntryDraft(storage: DraftStorage, key: string, now = Date.now()): Promise<EntryDraft | null> {
  try {
    const raw = await storage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as EntryDraft;
    if (value.version !== 1 || typeof value.requestId !== "string" || !["choose", "details", "zone", "price", "schedule", "spaces", "perimeter", "done"].includes(value.step) || ![value.code, value.first, value.next, value.capacity, value.freeSpaces].every(item => typeof item === "string")) return null;
    // A previous visit's availability estimate must never be posted as current.
    if (!availabilityIsFresh(value.freeObservedAt, now)) {
      value.freeSpaces = "";
      if (value.snapshot) value.snapshot.free = undefined;
    }
    if (value.pending?.type === "spaces") value.pending.available = null;
    return value;
  } catch { return null; }
}
export function createEntryDraftStore(storage: DraftStorage, accountId: string, originalKey: string, initial: EntryDraft) {
  const accountPrefix = `parkskopje-entry-v1:${encodeURIComponent(accountId)}:`;
  let value = { ...initial, originalKey: initial.originalKey?.startsWith(accountPrefix) ? initial.originalKey : originalKey };
  let tail = Promise.resolve();
  function keys() { return [...new Set([originalKey, value.originalKey, ...(value.snapshot?.id ? [entryDraftKey(accountId, value.snapshot.id)] : [])])]; }
  return {
    update: (patch: Partial<EntryDraft>) => {
      value = { ...value, ...patch, updatedAt: Date.now() };
      const next = value, targets = keys();
      tail = tail.catch(() => {}).then(() => storage.multiSet(targets.map(key => [key, JSON.stringify(next)])));
      return tail;
    },
    clear: () => { const targets = keys(); tail = tail.catch(() => {}).then(() => storage.multiRemove(targets)); return tail; },
  };
}
