import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";
import { listParkingSessions, onParkingSessionsChanged, updateParkingSession } from "./parkingSessions";
import { nextSpotShare, type SpotShare } from "../domain/spot-openings";
import type { ParkingSession } from "../domain/parking-sessions";

const SHARED = "spot-opening-shared-v1", OFF = "spot-sharing-off-v1";
const listeners = new Set<() => void>();
let queue: Promise<unknown> = Promise.resolve();
// One request at a time, so a payment and its stop recorded together cannot race each other.
const serial = <T>(work: () => Promise<T>) => { const next = queue.then(work, work); queue = next.catch(() => {}); return next; };

async function readShared(): Promise<Omit<SpotShare, "placeId"> | null> {
  try {
    const value = JSON.parse(await AsyncStorage.getItem(SHARED) ?? "null");
    return typeof value?.session === "string" && (value.endsAt === "left" || typeof value.endsAt === "number") ? value : null;
  } catch { return null; }
}
export const spotSharingEnabled = async () => await AsyncStorage.getItem(OFF) !== "1";
/** Shares the newest paid session's end once. A failed request is retried on the next session change or app start. */
export const shareSpotOpening = () => serial(async () => {
  if (!await spotSharingEnabled()) return;
  const share = nextSpotShare(await listParkingSessions(), Date.now(), await readShared());
  if (!share) return;
  await api.spotOpening(share.placeId, share.endsAt);
  await AsyncStorage.setItem(SHARED, JSON.stringify({ session: share.session, endsAt: share.endsAt }));
});
export async function setSpotSharing(enabled: boolean) {
  if (enabled) { await AsyncStorage.removeItem(OFF); void shareSpotOpening().catch(() => {}); }
  else {
    await AsyncStorage.setItem(OFF, "1");
    // Withdraw an end time already shared; turning sharing back on shares it again.
    await serial(async () => { await api.withdrawSpotOpening(); if ((await readShared())?.endsAt !== "left") await AsyncStorage.removeItem(SHARED); });
  }
  listeners.forEach(listener => listener());
}
/**
 * "I'm leaving my spot": the session stops now, and that change shares it (watchSpotOpenings) with drivers
 * heading nearby instead of at the paid end. True once shared; a failed share retries on the next change or start.
 */
export async function leaveSpot(session: ParkingSession) {
  await updateParkingSession(session.id, value => ({ ...value, stoppedAt: Math.max(Date.now(), value.startedAt) }));
  // Waits for the share the change queued, without sending again.
  await serial(async () => {});
  const shared = await readShared();
  return shared?.session === session.id && shared.endsAt === "left";
}
export function onSpotSharingChanged(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function watchSpotOpenings() {
  const share = () => { void shareSpotOpening().catch(() => {}); };
  share();
  return onParkingSessionsChanged(share);
}
