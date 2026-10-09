import React, { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import { useAccount } from "./AccountContext";
import { deviceVehicle } from "../services/deviceVehicle";
import type { PendingSmsStop } from "../domain/license-plate";

type Vehicle = {
  accountId: string | null; savedPlate: string | null; ready: boolean; offerPlate: boolean;
  pendingStop: PendingSmsStop | null;
  savePlate: (value: string) => Promise<void>;
  dismissPrompt: () => Promise<void>;
  setPendingStop: (value: PendingSmsStop) => Promise<void>;
  clearPendingStop: () => Promise<void>;
};
const Context = createContext<Vehicle | null>(null);
export function LicensePlateProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAccount(), accountId = profile?.id ?? null;
  const stored = useSyncExternalStore(deviceVehicle.subscribe, deviceVehicle.getSnapshot, deviceVehicle.getSnapshot);
  useEffect(() => { void deviceVehicle.select(accountId).catch(() => {}); }, [accountId]);
  const matching = stored.accountId === accountId;
  const actions = deviceVehicle.forAccount(accountId);
  const value: Vehicle = {
    accountId, ready: matching && stored.ready,
    savedPlate: matching ? stored.savedPlate : null, pendingStop: matching ? stored.pendingStop : null,
    offerPlate: matching && stored.offerPlate,
    ...actions,
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useLicensePlate() {
  const state = useContext(Context);
  if (!state) throw new Error("Vehicle provider is missing");
  return state;
}
