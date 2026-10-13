import type { Fix } from "./arrival";
import { usableFix } from "./location";
import { parkingPrice } from "./parking";
import { activeSession, latestSessionEnd, sessionEndsAt, type ParkingSession } from "./parking-sessions";
import { skopjeTime } from "./skopje-rules";
import type { Coordinate, ParkingPlace, VerifiedSmsPayment } from "./types";

export const CAR_FIX_ACCURACY_M = 30;
export const CAR_RECALL_MS = 12 * 3600000;
/** The phone's position stands for the car only while it is precise and fresh. */
export function carPosition(fix: Fix | null | undefined, now: number): Coordinate | null {
  return fix && usableFix(fix, now) && fix.accuracy! <= CAR_FIX_ACCURACY_M ? { latitude: fix.latitude, longitude: fix.longitude } : null;
}
export const sessionId = (placeId: string, startedAt: number) => `${placeId}@${startedAt}`;
const rate = (value: number | undefined) => value !== undefined && Number.isFinite(value) && value >= 0 && value <= 5000 ? value : null;
/** The session log entry for an SMS composer just opened for this zone. */
export function paymentSession(place: ParkingPlace, protocol: VerifiedSmsPayment, hours: number | null, car: Coordinate | null, startedAt: number): ParkingSession {
  const price = parkingPrice(place, startedAt);
  return {
    id: sessionId(place.id, startedAt), placeId: place.id, zoneCode: place.zoneCode ?? protocol.zoneCode, zoneName: place.name,
    operator: protocol.photoId === "official:gradski" ? "gradski" : protocol.photoId === "official:poc" ? "poc" : null,
    startedAt, stoppedAt: null, paidHours: protocol.mode === "fixed-hours" ? hours : null, maxStayMinutes: protocol.maxStayMinutes,
    firstHour: rate(price?.firstHour), nextHour: rate(price?.nextHour), car,
  };
}
/** "Paid until" for the newest session: the latest end bought at its place. Start-stop sessions have none. */
export const carPaidUntil = (sessions: ParkingSession[], session: ParkingSession | null) => session?.paidHours ? latestSessionEnd(sessions) : null;
/** The session behind "My car": the latest one while it runs and for 12 hours after. A stop SMS means the car left. */
export function carSession(sessions: ParkingSession[], now: number) {
  const latest = sessions.at(-1);
  if (!latest || latest.stoppedAt !== null) return null;
  return activeSession(sessions, now) ?? (now - (carPaidUntil(sessions, latest) ?? sessionEndsAt(latest) ?? latest.startedAt) <= CAR_RECALL_MS ? latest : null);
}
export function skopjeClock(at: number) {
  const { minute } = skopjeTime(at);
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}
const CAR_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#fff" d="M5.2 10.5 6.7 6.3A2 2 0 0 1 8.6 5h6.8a2 2 0 0 1 1.9 1.3l1.5 4.2A2 2 0 0 1 20 12.5V17h-1.5v1.5a1.5 1.5 0 0 1-3 0V17h-7v1.5a1.5 1.5 0 0 1-3 0V17H4v-4.5a2 2 0 0 1 1.2-2zM7.3 10.5h9.4l-1.2-3.3a.6.6 0 0 0-.5-.4H9a.6.6 0 0 0-.5.4zM7 15a1.3 1.3 0 1 0 0-2.6A1.3 1.3 0 0 0 7 15zm10 0a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6z"/></svg>';
/** A small teal drop pin with a car, distinct from the red destination pin and the blue GPS dot. */
export const CAR_PIN_HTML = `<span>${CAR_ICON}</span>`;
export const CAR_PIN_CSS = ".car-pin span{display:flex;align-items:center;justify-content:center;width:26px;height:26px;border:3px solid #fff;border-radius:50% 50% 50% 0;background:#16706b;transform:rotate(-45deg);box-shadow:-2px 2px 7px #10302e55}.car-pin svg{transform:rotate(45deg)}";
export const CAR_PIN_SIZE: [number, number] = [32, 40];
