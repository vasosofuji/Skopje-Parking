import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import seed from "../../data/catalog.json";
import type { Catalog, Proposal } from "../domain/types";
import { api } from "../services/api";
import { confirmedSignCatalog } from "../domain/parking";
import { createRefreshCoordinator } from "../domain/refresh-coordinator";
import { applyCatalogChanges, decodeCatalogCache, encodeCatalogCache } from "../domain/catalog-cache";
import { isLanguage, translate as translateText, type Language } from "../domain/language";
type State = {
  catalog: Catalog;
  proposals: Proposal[];
  connected: boolean;
  language: Language;
  setLanguage: (lang: Language) => void;
  refresh: () => Promise<void>;
  /** Syncs now and returns the current catalog; throws when the server cannot be reached. */
  latestCatalog: () => Promise<Catalog>;
  forgetParking: (id: string) => void;
  t: (en: string, mk: string) => string;
  now: number;
};
const Context = createContext<State | null>(null);
export function ParkingProvider({ children }: { children: React.ReactNode }) {
  const [catalog, setCatalog] = useState(seed as Catalog),
    [proposals, setProposals] = useState<Proposal[]>([]);
  const [connected, setConnected] = useState(false),
    [language, updateLanguage] = useState<Language>("mk"),
    [now, setNow] = useState(() => Date.now());
  // Phones keep the whole map and ask only for places changed since their cursor; an empty
  // answer is a few hundred bytes. Proposals are small but change rarely, so they poll slower.
  const [sync] = useState(() => {
    const state = { cursor: 0, catalog: seed as Catalog, proposals: [] as Proposal[], proposalsAt: 0, savedAt: 0, syncedAt: 0, dirty: false };
    const requestRefresh = createRefreshCoordinator(async (afterWrite: boolean) => {
      try {
        const wantProposals = afterWrite || !state.cursor || Date.now() - state.proposalsAt >= 5 * 60_000;
        const [changes, community] = await Promise.all([
          api.changes(state.cursor),
          wantProposals ? api.proposals() : null,
        ]);
        if (changes.full || changes.places.length || changes.removed.length || changes.trustInputs !== state.catalog.trustInputs) {
          state.catalog = applyCatalogChanges(state.catalog, changes);
          setCatalog(confirmedSignCatalog(state.catalog));
          state.dirty = true;
        }
        if (community) {
          state.proposals = community; state.proposalsAt = Date.now(); state.dirty = true;
          setProposals(community);
        }
        state.cursor = changes.cursor;
        state.syncedAt = Date.now();
        setConnected(true);
        setNow(Date.now());
        // The offline copy only needs to be recent; rewriting 1 MB on every change wears phone storage.
        // A driver's own change and a full download are saved right away.
        if (state.dirty && (afterWrite || changes.full || Date.now() - state.savedAt >= 5 * 60_000)) {
          state.savedAt = Date.now(); state.dirty = false;
          const cached = encodeCatalogCache(state.catalog, state.proposals, Date.now(), state.cursor);
          // Storage quota failures must not turn a successful network refresh offline.
          if (cached) await AsyncStorage.setItem("parkskopje-cache", cached).catch(() => {});
        }
      } catch {
        setConnected(false);
        setNow(Date.now());
      }
    }, 25_000);
    return {
      requestRefresh,
      /** The saved copy, unless a sync already finished (it is newer). */
      restore(value: { catalog: Catalog; proposals: Proposal[]; cursor: number }) {
        if (state.cursor) return false;
        Object.assign(state, { cursor: value.cursor, catalog: value.catalog, proposals: value.proposals, savedAt: Date.now() });
        return true;
      },
      forget(id: string) { state.catalog = { ...state.catalog, places: state.catalog.places.filter(place => place.id !== id) }; },
      async latest(message: string) {
        const started = Date.now();
        await requestRefresh(true);
        if (state.syncedAt < started) throw new Error(message);
        return confirmedSignCatalog(state.catalog);
      },
    };
  });
  const { requestRefresh } = sync;
  // Mutation callers need a read newer than an already-running catalog request.
  const refresh = useCallback(() => requestRefresh(true), [requestRefresh]);
  const latestCatalog = useCallback(() => sync.latest(translateText(language, "Could not reach the parking server. Try again.", "Серверот за паркинг не е достапен. Обидете се повторно.")), [sync, language]);
  const forgetParking = useCallback((id: string) => {
    sync.forget(id);
    setCatalog(previous => ({ ...previous, places: previous.places.filter(place => place.id !== id) }));
    // A successful deletion must not reappear from an offline catalog on reload.
    void AsyncStorage.removeItem("parkskopje-cache").catch(() => {});
  }, [sync]);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [cached, locale] = await Promise.all([
          AsyncStorage.getItem("parkskopje-cache"),
          AsyncStorage.getItem("parkskopje-language"),
        ]);
        if (!active) return;
        const value = decodeCatalogCache(cached, seed.generatedAt);
        if (value && sync.restore(value)) {
          setCatalog(confirmedSignCatalog(value.catalog));
          setProposals(value.proposals);
        }
        if (isLanguage(locale)) updateLanguage(locale);
      } catch {
        /* The bundled source catalog remains available. */
      }
      if (active && AppState.currentState === "active") await requestRefresh();
    })();
    // Clocks tick every 30 s; the network is asked every 60 s, and only while the app is open.
    let tick = 0;
    const interval = setInterval(() => {
      if (AppState.currentState !== "active") return;
      setNow(Date.now());
      if (++tick % 2 === 0) void requestRefresh();
    }, 30000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") { setNow(Date.now()); void requestRefresh(); }
    });
    return () => {
      active = false;
      clearInterval(interval);
      subscription.remove();
    };
  }, [sync, requestRefresh]);
  const setLanguage = useCallback((lang: Language) => {
    updateLanguage(lang);
    void AsyncStorage.setItem("parkskopje-language", lang).catch(() => {});
  }, []);
  const translate = useCallback(
    (en: string, mk: string) => translateText(language, en, mk),
    [language],
  );
  const value = useMemo<State>(
    () => ({
      catalog,
      proposals,
      connected,
      language,
      setLanguage,
      refresh,
      latestCatalog,
      forgetParking,
      now,
      t: translate,
    }),
    [
      catalog,
      proposals,
      connected,
      language,
      setLanguage,
      refresh,
      latestCatalog,
      forgetParking,
      now,
      translate,
    ],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** For shared UI that may render outside the provider (error screens): English fallback. */
export function useTranslate() {
  return useContext(Context)?.t ?? ((en: string) => en);
}
export function useParking() {
  const state = useContext(Context);
  if (!state) throw new Error("Parking provider is missing");
  return state;
}
