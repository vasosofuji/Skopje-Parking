import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "../services/api";
import { credentials } from "../services/credentials";
import { disableBackgroundArrival } from "../services/backgroundArrival";
import { selectArrivalAccount } from "../services/arrivalStorage";
import { deviceVehicle } from "../services/deviceVehicle";
import type { Profile } from "../domain/account";
const CACHE = "parkskopje-profile";
type Account = {
  profile: Profile | null;
  ready: boolean;
  register: (username: string, accepted: boolean, password: string) => Promise<void>;
  guest: (accepted: boolean) => Promise<void>;
  login: (username: string, password: string, accepted: boolean) => Promise<void>;
  secure: (password: string) => Promise<void>;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  clear: () => Promise<void>;
  captureClear: () => () => Promise<void>;
};
const Context = createContext<Account | null>(null);
export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const generation = useRef(0);
  const owner = useRef<string | null>(null);
  const save = useCallback(async (next: Profile | null) => {
    const arrivalScope = owner.current && owner.current !== next?.id
      ? Promise.all([disableBackgroundArrival(), selectArrivalAccount(next?.id ?? null)])
      : selectArrivalAccount(next?.id ?? null);
    owner.current = next?.id ?? null;
    const vehicle = deviceVehicle.select(next?.id ?? null);
    setProfile(next);
    await Promise.all([arrivalScope, vehicle, next ? AsyncStorage.setItem(CACHE, JSON.stringify(next)) : AsyncStorage.removeItem(CACHE)]);
  }, []);
  const refresh = useCallback(async () => {
    const version = generation.current;
    try {
      const next = await api.profile();
      if (version === generation.current) {
        if (!next) await disableBackgroundArrival();
        if (version === generation.current) await save(next);
      }
    } catch (error) {
      if (error instanceof Error && error.message === "A valid session is required." && version === generation.current) {
        try { await disableBackgroundArrival(); }
        finally { if (version === generation.current) await save(null); }
      }
      throw error;
    }
  }, [save]);
  useEffect(() => {
    let alive = true;
    const version = generation.current;
    void (async () => {
      try {
        if (await credentials.get()) {
          const cached = await AsyncStorage.getItem(CACHE);
          if (cached && alive && generation.current === version) {
            const value = JSON.parse(cached) as Profile;
            await selectArrivalAccount(value.id);
            if (!alive || generation.current !== version) return;
            owner.current = value.id;
            setProfile({ ...value, secured: value.secured ?? false, points: value.points ?? 0 });
            setReady(true);
          }
          await refresh();
        } else await Promise.all([disableBackgroundArrival().then(() => selectArrivalAccount(null)), deviceVehicle.select(null)]);
      } catch {
        // Keep the last known profile available when offline.
      } finally {
        if (alive) setReady(true);
      }
    })();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh().catch(() => {});
    });
    return () => { alive = false; listener.remove(); };
  }, [refresh]);
  const register = useCallback(async (username: string, accepted: boolean, password: string) => {
    const version = ++generation.current;
    const next = await api.register(username, accepted, password);
    if (version !== generation.current) return;
    const completed = ++generation.current;
    // A guest saving their account keeps its identity and already answered the plate offer.
    if (owner.current !== next.id) await deviceVehicle.requestPrompt(next.id).catch(() => {});
    if (completed !== generation.current) return;
    await save(next);
  }, [save]);
  const guest = useCallback(async (accepted: boolean) => {
    const version = ++generation.current;
    const next = await api.guest(accepted);
    if (version !== generation.current) return;
    const completed = ++generation.current;
    // Renewing consent for the current account must not re-offer the optional plate.
    if (owner.current !== next.id) await deviceVehicle.requestPrompt(next.id).catch(() => {});
    if (completed !== generation.current) return;
    await save(next);
  }, [save]);
  const login = useCallback(async (username: string, password: string, accepted: boolean) => {
    const version = ++generation.current;
    const next = await api.login(username, password, accepted);
    if (version !== generation.current) return;
    generation.current++;
    await save(next);
  }, [save]);
  const secure = useCallback(async (password: string) => {
    const version = ++generation.current;
    const next = await api.secureAccount(password);
    if (version !== generation.current) return;
    generation.current++;
    await save(next);
  }, [save]);
  const captureClear = useCallback(() => {
    const captured = generation.current, accountId = owner.current;
    return async () => {
      if (captured !== generation.current || accountId !== owner.current) return;
      const version = ++generation.current;
      try { await disableBackgroundArrival(); }
      finally { if (version === generation.current && accountId === owner.current) await save(null); }
    };
  }, [save]);
  const clear = useCallback(() => captureClear()(), [captureClear]);
  const logout = useCallback(async () => {
    const version = ++generation.current;
    try { await api.logout(); }
    catch (error) {
      if (version !== generation.current) return;
      if (!(error instanceof Error) || error.message !== "A valid session is required.") throw error;
    }
    if (version !== generation.current) return;
    try { await disableBackgroundArrival(); }
    finally { if (version === generation.current) await save(null); }
  }, [save]);
  return <Context.Provider value={{ profile, ready, register, guest, login, secure, refresh, logout, clear, captureClear }}>{children}</Context.Provider>;
}
export function useAccount() {
  const value = useContext(Context);
  if (!value) throw new Error("Account provider missing");
  return value;
}
