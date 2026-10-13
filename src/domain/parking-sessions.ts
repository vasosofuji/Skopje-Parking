import type { Coordinate } from "./types";

/** A parking payment started from the app (the SMS composer opened). Stored on this device only. */
export type ParkingSession = {
  id: string;
  placeId: string;
  zoneCode: string;
  zoneName: string;
  operator: "gradski" | "poc" | null;
  /** When the SMS composer opened; the app cannot see whether the SMS was sent. */
  startedAt: number;
  /** start-stop: when the stop SMS was opened. */
  stoppedAt: number | null;
  /** fixed-hours: the hours bought. */
  paidHours: number | null;
  maxStayMinutes: number | null;
  /** MKD at payment time, when known. */
  firstHour: number | null;
  nextHour: number | null;
  /** Where the phone was when paying: "where is my car". */
  car: Coordinate | null;
};

export const SESSION_HISTORY_MS = 400 * 86400000;
export const SESSION_LIMIT = 1000;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const priceOrNull = (value: unknown) => finite(value) && value >= 0 && value <= 5000 ? value : null;

export function validSession(value: unknown, now: number): value is ParkingSession {
  const s = value as ParkingSession;
  return Boolean(s) && typeof s.id === "string" && typeof s.placeId === "string" && typeof s.zoneCode === "string" && typeof s.zoneName === "string" &&
    (s.operator === null || s.operator === "gradski" || s.operator === "poc") &&
    finite(s.startedAt) && s.startedAt <= now + 60000 && now - s.startedAt < SESSION_HISTORY_MS &&
    (s.stoppedAt === null || (finite(s.stoppedAt) && s.stoppedAt >= s.startedAt)) &&
    (s.paidHours === null || (finite(s.paidHours) && s.paidHours > 0 && s.paidHours <= 24)) &&
    (s.maxStayMinutes === null || (finite(s.maxStayMinutes) && s.maxStayMinutes > 0)) &&
    priceOrNull(s.firstHour) === s.firstHour && priceOrNull(s.nextHour) === s.nextHour &&
    (s.car === null || (finite(s.car?.latitude) && finite(s.car?.longitude) && Math.abs(s.car.latitude) <= 90 && Math.abs(s.car.longitude) <= 180));
}

export function readSessions(raw: string | null, now: number): ParkingSession[] {
  try {
    const data = JSON.parse(raw ?? "[]");
    return Array.isArray(data) ? data.filter(item => validSession(item, now)).sort((a, b) => a.startedAt - b.startedAt).slice(-SESSION_LIMIT) : [];
  } catch { return []; }
}

export function addSession(sessions: ParkingSession[], session: ParkingSession, now: number) {
  return readSessions(JSON.stringify([...sessions.filter(item => item.id !== session.id), session]), now);
}

/** When the paid time ends: the hours bought, else the zone's maximum stay. */
export function sessionEndsAt(session: ParkingSession) {
  if (session.stoppedAt !== null) return session.stoppedAt;
  if (session.paidHours !== null) return session.startedAt + session.paidHours * 3600000;
  return session.maxStayMinutes !== null ? session.startedAt + session.maxStayMinutes * 60000 : null;
}

/** The end so far: never after `now`, and without a known end the driver is assumed gone within 12 hours. */
export const sessionEffectiveEnd = (session: ParkingSession, now = Infinity) => Math.min(sessionEndsAt(session) ?? session.startedAt + 12 * 3600000, now);

/** When the newest session's time ends. Bought hours at the same place that run longer still count:
 * paying there again never moves the end earlier. */
export function latestSessionEnd(sessions: ParkingSession[]) {
  const latest = sessions.at(-1);
  if (!latest) return null;
  const extended = latest.stoppedAt === null ? sessions.filter(s => s.placeId === latest.placeId && s.paidHours !== null && s.stoppedAt === null) : [];
  return Math.max(sessionEffectiveEnd(latest), ...extended.map(s => sessionEffectiveEnd(s)));
}

/** The newest session still running, if any. */
export function activeSession(sessions: ParkingSession[], now: number) {
  const latest = sessions.at(-1);
  return latest && latest.stoppedAt === null && latestSessionEnd(sessions)! > now ? latest : null;
}

/** Estimated MKD: first hour, then the next-hour price per started hour. Null when the price is unknown. */
export function sessionCost(session: ParkingSession, now: number) {
  if (session.firstHour === null) return null;
  const hours = session.paidHours ?? Math.max(1, Math.ceil((sessionEffectiveEnd(session, now) - session.startedAt) / 3600000));
  return session.firstHour + Math.max(0, hours - 1) * (session.nextHour ?? session.firstHour);
}
