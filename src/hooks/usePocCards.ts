import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PocVisitDetector, pocCardZone, readPocVisits, recordPocVisit, type PocCardZone } from "../domain/poc-cards";
import { cardOffer, readCardPrompts, type CardOffer } from "../domain/parking-passes";
import { listParkingSessions, onParkingSessionsChanged } from "../services/parkingSessions";
import type { Fix } from "../domain/arrival";
import type { ParkingPlace } from "../domain/types";

/** Monthly card prompts from paid sessions, else recorded visits; history and prompts are account-scoped. */
export function usePocCards(scope: string | null, places: ParkingPlace[], fix: Fix | null, focused: boolean) {
  const [offer, setOffer] = useState<{ scope: string; value: CardOffer } | null>(null);
  const queue = useRef(Promise.resolve());
  const detector = useMemo(() => ({ scope, value: new PocVisitDetector() }), [scope]);
  const enqueue = useCallback((work: () => Promise<void>) => { queue.current = queue.current.catch(() => {}).then(work).catch(() => {}); }, []);
  // One prompt per zone per cooldown, whichever signal comes first.
  const offerCard = useCallback(async (scope: string, visitZone: PocCardZone | null) => {
    const key = `parkskopje-card-prompts:${scope}`, now = Date.now(), prompts = readCardPrompts(await AsyncStorage.getItem(key), now);
    const value = cardOffer(await listParkingSessions(), now, prompts, visitZone);
    if (!value) return;
    await AsyncStorage.setItem(key, JSON.stringify({ ...prompts, [value.key]: now }));
    setOffer({ scope, value });
  }, []);
  const record = useCallback((place: ParkingPlace) => {
    const zone = pocCardZone(place, places);
    if (!scope || !zone) return;
    const key = `parkskopje-poc-visits:${scope}`;
    enqueue(async () => {
      const now = Date.now(), history = readPocVisits(await AsyncStorage.getItem(key), now);
      const result = recordPocVisit(history, place.id, zone, now, place.kind === "zone" ? place.coordinate : undefined);
      await AsyncStorage.setItem(key, JSON.stringify(result.history));
      if (result.suggest) await offerCard(scope, zone);
    });
  }, [scope, places, enqueue, offerCard]);
  useEffect(() => {
    if (!scope) return;
    const check = () => enqueue(() => offerCard(scope, null));
    check();
    return onParkingSessionsChanged(check);
  }, [scope, enqueue, offerCard]);
  useEffect(() => {
    const stopped = detector.value.update(focused && scope ? fix : null, places, Date.now());
    if (stopped) record(stopped);
  }, [detector, fix, focused, scope, places, record]);
  return { record, offer: offer?.scope === scope ? offer.value : null, dismiss: () => setOffer(null) };
}
