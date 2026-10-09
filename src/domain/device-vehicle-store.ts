import { normalizeLicensePlate, validPendingSmsStop, type PendingSmsStop } from "./license-plate";

export const DEVICE_VEHICLE_KEY = "parkskopje-device-vehicle-v1";
type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> };
export type DeviceVehicleState = {
  accountId: string | null; savedPlate: string | null; pendingStop: PendingSmsStop | null; offerPlate: boolean; ready: boolean;
};
const empty = (accountId: string | null, ready: boolean): DeviceVehicleState => ({ accountId, savedPlate: null, pendingStop: null, offerPlate: false, ready });

/** A single owner-tagged record prevents another account from inheriting a vehicle. */
export function createDeviceVehicleStore(storage: Storage) {
  let state = empty(null, true), version = 0, selected = false, queue = Promise.resolve(), selection = Promise.resolve();
  const listeners = new Set<() => void>();
  const publish = (next: DeviceVehicleState) => { state = next; listeners.forEach(listener => listener()); };
  function enqueue(operation: () => Promise<void>) { const task = queue.then(operation, operation); queue = task.catch(() => {}); return task; }
  function encode(next: DeviceVehicleState) {
    return JSON.stringify({ version: 1, accountId: next.accountId, savedPlate: next.savedPlate, pendingStop: next.pendingStop, offerPlate: next.offerPlate });
  }
  function select(accountId: string | null) {
    if (selected && accountId === state.accountId) return selection;
    selected = true;
    const current = ++version;
    publish(empty(accountId, !accountId));
    selection = enqueue(async () => {
      if (!accountId) {
        try { await storage.removeItem(DEVICE_VEHICLE_KEY); }
        catch { throw new Error("Could not clear vehicle settings. Try again."); }
        return;
      }
      let next = empty(accountId, true);
      try {
        const raw = await storage.getItem(DEVICE_VEHICLE_KEY);
        const record = raw && raw.length <= 4096 ? JSON.parse(raw) : null;
        if (record?.version === 1 && record.accountId === accountId) {
          const savedPlate = normalizeLicensePlate(record.savedPlate);
          const needsPlateCorrection = record.savedPlate != null && record.savedPlate !== "" && !savedPlate;
          next = { ...next, savedPlate, pendingStop: validPendingSmsStop(record.pendingStop) ? record.pendingStop : null, offerPlate: record.offerPlate === true || needsPlateCorrection };
        } else if (raw) await storage.removeItem(DEVICE_VEHICLE_KEY);
      } catch { /* A storage read failure never exposes another account's data. */ }
      if (current === version) publish(next);
    });
    return selection;
  }
  function update(change: (current: DeviceVehicleState) => DeviceVehicleState) {
    const current = version, owner = state.accountId;
    if (!owner || !state.ready) return Promise.reject(new Error("Vehicle settings are not ready."));
    return enqueue(async () => {
      if (current !== version || state.accountId !== owner) throw new Error("Your account changed. Try again.");
      const next = change(state);
      try { await storage.setItem(DEVICE_VEHICLE_KEY, encode(next)); }
      catch { throw new Error("Could not save vehicle settings. Try again."); }
      if (current !== version || state.accountId !== owner) throw new Error("Your account changed. Try again.");
      publish(next);
    });
  }
  function dismissPrompt() {
    // Optional setup can always be closed, even if device storage is unavailable.
    publish({ ...state, offerPlate: false });
    return update(current => ({ ...current, offerPlate: false }));
  }
  function savePlate(value: string) {
    const plate = value === "" ? null : normalizeLicensePlate(value);
    if (value !== "" && !plate) return Promise.reject(new Error("Enter a valid license plate."));
    return update(current => ({ ...current, savedPlate: plate, offerPlate: false }));
  }
  function setPendingStop(value: PendingSmsStop) {
    if (!validPendingSmsStop(value)) return Promise.reject(new Error("SMS instructions are invalid."));
    const pendingStop = { ...value };
    return update(current => ({ ...current, pendingStop }));
  }
  const clearPendingStop = () => update(current => ({ ...current, pendingStop: null }));
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    select,
    async requestPrompt(accountId: string) {
      const hydration = select(accountId), captured = version;
      await hydration;
      if (state.accountId !== accountId || captured !== version) throw new Error("Your account changed. Try again.");
      await update(current => ({ ...current, offerPlate: !current.savedPlate }));
    },
    dismissPrompt, savePlate, setPendingStop, clearPendingStop,
    forAccount(accountId: string | null) {
      const captured = version;
      const guard = (operation: () => Promise<void>) => {
        if (!accountId || accountId !== state.accountId || captured !== version) return Promise.reject(new Error("Your account changed. Try again."));
        return operation();
      };
      return {
        savePlate: (value: string) => guard(() => savePlate(value)),
        dismissPrompt: () => guard(dismissPrompt),
        setPendingStop: (value: PendingSmsStop) => guard(() => setPendingStop(value)),
        clearPendingStop: () => guard(clearPendingStop),
      };
    },
  };
}
