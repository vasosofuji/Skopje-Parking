import AsyncStorage from "@react-native-async-storage/async-storage";
import { addSession, readSessions, type ParkingSession } from "../domain/parking-sessions";
import { serialQueue } from "./serial";

const KEY = "parking-sessions-v1";
const listeners = new Set<() => void>();
// Serialized so a payment and a stop recorded together cannot drop each other.
const serial = serialQueue();
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
export const removeParkingSession = (id: string) => serial(async () => {
  const now = Date.now();
  await AsyncStorage.setItem(KEY, JSON.stringify(readSessions(await AsyncStorage.getItem(KEY), now).filter(session => session.id !== id)));
  changed();
});
/** Sign-out and "delete my data" clear the log with the plate: it holds car locations. */
export const clearParkingSessions = () => serial(async () => { await AsyncStorage.removeItem(KEY); changed(); });
export function onParkingSessionsChanged(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
