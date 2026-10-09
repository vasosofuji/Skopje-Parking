import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PocVisitDetector, pocCardZone, readPocVisits, recordPocVisit, type PocCardZone } from "../domain/poc-cards";
import type { Fix } from "../domain/arrival";
import type { ParkingPlace } from "../domain/types";

/** Record confirmed arrivals or sustained parking stops; history is account-scoped. */
export function usePocCards(scope: string | null, places: ParkingPlace[], fix: Fix | null, focused: boolean) {
  const [offer, setOffer] = useState<{ scope: string; zone: PocCardZone } | null>(null);
  const queue = useRef(Promise.resolve());
  const detector = useMemo(() => ({ scope, value: new PocVisitDetector() }), [scope]);
  const record = useCallback((place: ParkingPlace) => {
    const zone = pocCardZone(place, places);
    if (!scope || !zone) return;
    const key = `parkskopje-poc-visits:${scope}`;
    queue.current = queue.current.catch(() => {}).then(async () => {
      const now = Date.now(), history = readPocVisits(await AsyncStorage.getItem(key), now);
      const result = recordPocVisit(history, place.id, zone, now, place.kind === "zone" ? place.coordinate : undefined);
      await AsyncStorage.setItem(key, JSON.stringify(result.history));
      if (result.suggest) setOffer({ scope, zone });
    }).catch(() => {});
  }, [scope, places]);
  useEffect(() => {
    const stopped = detector.value.update(focused && scope ? fix : null, places, Date.now());
    if (stopped) record(stopped);
  }, [detector, fix, focused, scope, places, record]);
  return { record, zone: offer?.scope === scope ? offer.zone : null, dismiss: () => setOffer(null) };
}
