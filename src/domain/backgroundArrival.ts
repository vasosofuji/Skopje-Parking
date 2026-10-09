import { ArrivalDetector, containsParkingFix, type ArrivalSnapshot, type Fix } from "./arrival";
import type { ParkingPlace } from "./types";

export const ARRIVAL_REMINDER_KIND = "parking-arrival";
export const REMINDER_EXPIRY_MS = 30 * 60 * 1000;
export type PendingArrival = {
  placeId: string;
  createdAt: number;
  opened: boolean;
  notificationId: string;
};
export type ReminderState = {
  detector: ArrivalSnapshot;
  lastPromptAt: number | null;
  pending: PendingArrival | null;
};
export const emptyReminderState = (): ReminderState => ({
  detector: { candidate: null, prompted: [] },
  lastPromptAt: null,
  pending: null,
});

export function freshPendingArrival(pending: PendingArrival | null, now = Date.now()) {
  return pending && now >= pending.createdAt && now - pending.createdAt < REMINDER_EXPIRY_MS
    ? pending
    : null;
}

/** Shared by foreground observations and background batches, without any native dependencies. */
export function advanceArrival(
  state: ReminderState,
  fixes: Fix[],
  places: ParkingPlace[],
  background: boolean,
  now = Date.now(),
): { state: ReminderState; place: ParkingPlace | null } {
  const pending = freshPendingArrival(state.pending, now);
  const detector = new ArrivalDetector(state.detector);
  let place: ParkingPlace | null = null;
  const ordered = [...fixes].sort((a, b) => a.timestamp - b.timestamp);
  for (const fix of ordered) {
    const arrived = detector.update(fix, places, now);
    if (arrived) place = arrived;
  }
  // A deferred batch may also contain the departure. Never notify about a stop already left.
  const last = ordered[ordered.length - 1];
  if (place && (!last || last.accuracy === null || last.accuracy > 25 ||
    !Number.isFinite(last.accuracy) || last.accuracy < 0 ||
    now - last.timestamp > 20000 || last.timestamp > now + 5000 ||
    (last.speed !== null && (!Number.isFinite(last.speed) || last.speed > 0.8)) || !containsParkingFix(last, place))) {
    return { state: { ...state, pending: null, detector: { ...detector.snapshot(now), candidate: null, visit: null } }, place: null };
  }
  return {
    state: {
      detector: detector.snapshot(now),
      lastPromptAt: place ? now : state.lastPromptAt,
      pending: place && background ? {
        placeId: place.id,
        createdAt: now,
        opened: false,
        notificationId: `parking-arrival-${now}`,
      } : pending && detector.snapshot(now).visit?.id === pending.placeId ? pending : null,
    },
    place,
  };
}

/** A notification may select only the locally persisted, unexpired reminder. */
export function openArrivalNotification(state: ReminderState, data: unknown, now = Date.now()): ReminderState {
  if (!data || typeof data !== "object") return state;
  const value = data as Record<string, unknown>;
  const pending = freshPendingArrival(state.pending, now);
  if (!pending || value.kind !== ARRIVAL_REMINDER_KIND || value.placeId !== pending.placeId || value.createdAt !== pending.createdAt)
    return state;
  return { ...state, pending: { ...pending, opened: true } };
}

/** Only a successful report starts durable spam suppression for this parking place. */
export function acknowledgeArrivalReport(state: ReminderState, placeId: string, now = Date.now()): ReminderState {
  const detector = new ArrivalDetector(state.detector);
  detector.reported(placeId, now);
  return { ...state, detector: detector.snapshot(now), pending: state.pending?.placeId === placeId ? null : state.pending };
}
