import AsyncStorage from "@react-native-async-storage/async-storage";
import { addSession, readSessions, type ParkingSession } from "../domain/parking-sessions";

const KEY = "parking-sessions-v1";
const listeners = new Set<() => void>();
let queue: Promise<unknown> = Promise.resolve();
// Serialized so a payment and a stop recorded together cannot drop each other.
const serial = <T>(work: () => Promise<T>) => { const next = queue.then(work, work); queue = next.catch(() => {}); return next; };
const changed = () => listeners.forEach(listener => listener());

export const listParkingSessions = () => AsyncStorage.getItem(KEY).then(raw => readSessions(raw, Date.now()));
export function saveParkingSession(session: ParkingSession) {
  return serial(async () => {
    const now = Date.now();
    await AsyncStorage.setItem(KEY, JSON.stringify(addSession(readSessions(await AsyncStorage.getItem(KEY), now), session, now)));
    changed();
  });
}
export function updateParkingSession(id: string, change: (session: ParkingSession) => ParkingSession) {
  return serial(async () => {
    const now = Date.now(), sessions = readSessions(await AsyncStorage.getItem(KEY), now);
    const index = sessions.findIndex(session => session.id === id);
    if (index < 0) return;
    sessions[index] = change(sessions[index]);
    await AsyncStorage.setItem(KEY, JSON.stringify(readSessions(JSON.stringify(sessions), now)));
    changed();
  });
}
/** Sign-out and "delete my data" clear the log with the plate: it holds car locations. */
export const clearParkingSessions = () => serial(async () => { await AsyncStorage.removeItem(KEY); changed(); });
export function onParkingSessionsChanged(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
