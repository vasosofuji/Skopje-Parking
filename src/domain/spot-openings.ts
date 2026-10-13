import { activeSession, sessionEndsAt, type ParkingSession } from "./parking-sessions";

/** What this phone told the server about one parking session: its end time, or that the driver left. */
export type SpotShare = { session: string; placeId: string; endsAt: number | "left" };
export const STOP_SHARE_MS = 10 * 60000;

/** The newest session's opening not yet shared. Bought hours have a known end; a start-stop session's
 * maximum stay is only a cap, so it is shared when the stop SMS is opened, as "leaving now". */
export function nextSpotShare(sessions: ParkingSession[], now: number, shared: Omit<SpotShare, "placeId"> | null): SpotShare | null {
  const latest = sessions.at(-1);
  if (!latest || (shared?.session === latest.id && shared.endsAt === "left")) return null;
  if (latest.stoppedAt !== null)
    return now - latest.stoppedAt < STOP_SHARE_MS ? { session: latest.id, placeId: latest.placeId, endsAt: "left" } : null;
  const session = activeSession(sessions, now), endsAt = session?.paidHours ? sessionEndsAt(session) : null;
  return session && endsAt !== null && !(shared?.session === session.id && shared.endsAt === endsAt) ? { session: session.id, placeId: session.placeId, endsAt } : null;
}
