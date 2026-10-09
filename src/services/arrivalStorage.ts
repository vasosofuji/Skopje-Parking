import AsyncStorage from "@react-native-async-storage/async-storage";
import { acknowledgeArrivalReport, emptyReminderState, type ReminderState } from "../domain/backgroundArrival";
import type { ParkingPlace } from "../domain/types";

const STATE = "parkskopje-arrival-state-v2:";
const ACCOUNT = "parkskopje-arrival-account-v2";
const ENABLED = "parkskopje-background-arrival-v1";
const CATALOG = "parkskopje-arrival-catalog-v1";
let queue = Promise.resolve();

/** Serialize UI and task mutations so a foreground/background transition cannot double-prompt. */
export function arrivalTransaction<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work);
  queue = result.then(() => undefined, () => undefined);
  return result;
}
export async function arrivalAccount(): Promise<string | null> {
  return AsyncStorage.getItem(ACCOUNT);
}
/** Wait for prior account transitions before binding a new UI report. */
export const captureArrivalAccount = () => arrivalTransaction(arrivalAccount);
export async function selectArrivalAccount(accountId: string | null) {
  return arrivalTransaction(async () => {
    const previous = await arrivalAccount();
    if (previous === accountId) return;
    if (accountId) await AsyncStorage.setItem(ACCOUNT, accountId);
    else await AsyncStorage.removeItem(ACCOUNT);
    await saveBackgroundArrivalEnabled(false);
    if (accountId) {
      const state = await readArrivalState(accountId);
      await saveArrivalState({ ...state, pending: null, lastPromptAt: null, detector: { ...state.detector, candidate: null, visit: null } }, accountId);
    }
  });
}
export async function readArrivalState(accountId?: string | null): Promise<ReminderState> {
  try {
    const scope = accountId === undefined ? await arrivalAccount() : accountId;
    if (!scope) return emptyReminderState();
    const raw = await AsyncStorage.getItem(STATE + encodeURIComponent(scope));
    const value = raw ? JSON.parse(raw) as ReminderState : null;
    if (value && Array.isArray(value.detector?.prompted)) {
      const now = Date.now();
      value.detector.prompted = value.detector.prompted.filter(item => Array.isArray(item) && typeof item[0] === "string" && Number.isFinite(item[1]) && item[1] <= now && now - item[1] < 6 * 60 * 60 * 1000);
      return value;
    }
  } catch { /* A damaged cache must not prevent foreground parking use. */ }
  return emptyReminderState();
}
export async function saveArrivalState(state: ReminderState, accountId?: string | null) {
  const scope = accountId === undefined ? await arrivalAccount() : accountId;
  if (scope) await AsyncStorage.setItem(STATE + encodeURIComponent(scope), JSON.stringify(state));
}
export const backgroundArrivalEnabled = async () => (await AsyncStorage.getItem(ENABLED)) === "true";
export const saveBackgroundArrivalEnabled = (enabled: boolean) => AsyncStorage.setItem(ENABLED, String(enabled));
export const saveArrivalCatalog = (places: ParkingPlace[]) => AsyncStorage.setItem(CATALOG, JSON.stringify(places));
export async function readArrivalCatalog(): Promise<ParkingPlace[]> {
  try {
    const raw = await AsyncStorage.getItem(CATALOG);
    const places = raw ? JSON.parse(raw) : [];
    return Array.isArray(places) ? places : [];
  } catch { return []; }
}
export async function clearArrivalStorage() {
  const state = await readArrivalState();
  await saveArrivalState({ ...state, pending: null, lastPromptAt: null, detector: { ...state.detector, candidate: null, visit: null } });
  await AsyncStorage.removeItem(CATALOG);
}

export async function acknowledgeParkingReport(placeId: string, accountId: string | null) {
  if (!accountId) return;
  await arrivalTransaction(async () => {
    await saveArrivalState(acknowledgeArrivalReport(await readArrivalState(accountId), placeId), accountId);
  });
}
