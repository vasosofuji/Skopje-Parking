import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import type { Fix } from "../domain/arrival";
import type { ParkingPlace } from "../domain/types";
import { choiceKey, ZonePaymentDwell } from "../domain/zone-payment";

type Input = { places: ParkingPlace[]; fix: Fix | null; plate: string | null; scope: string | null; focused: boolean; blocked: boolean };
type Offer = { ids: string[]; scope: string | null };
/** Foreground-only: payment never uses persisted/background arrival candidates. */
export function useZonePayment(input: Input) {
  const latest = useRef(input), detector = useRef(new ZonePaymentDwell());
  useLayoutEffect(() => { latest.current = input; });
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const foregroundRef = useRef(AppState.currentState === "active");
  const [tick, setTick] = useState(0), [offered, setOffered] = useState<Offer | null>(null);
  const offeredRef = useRef(offered); useLayoutEffect(() => { offeredRef.current = offered; });
  const releaseToken = useMemo(() => ({ blocked: input.blocked, focused: input.focused, scope: input.scope, foreground }), [input.blocked, input.focused, input.scope, foreground]);
  const [unblocked, setUnblocked] = useState<object | null>(null);
  useEffect(() => {
    const change = AppState.addEventListener("change", state => { foregroundRef.current = state === "active"; if (state !== "active") { detector.current.reset(); offeredRef.current = null; setOffered(null); } setForeground(state === "active"); });
    const blur = Platform.OS === "android" ? AppState.addEventListener("blur", () => { foregroundRef.current = false; detector.current.reset(); offeredRef.current = null; setOffered(null); setForeground(false); }) : null;
    const focus = Platform.OS === "android" ? AppState.addEventListener("focus", () => { foregroundRef.current = AppState.currentState === "active"; setForeground(foregroundRef.current); }) : null;
    const timer = setInterval(() => setTick(value => value + 1), 1000);
    return () => { change.remove(); blur?.remove(); focus?.remove(); clearInterval(timer); };
  }, []);
  useLayoutEffect(() => { detector.current = new ZonePaymentDwell(); offeredRef.current = null; }, [input.scope]);
  useEffect(() => {
    if (input.blocked || !input.focused || !foreground) return;
    // Give the preceding native arrival Modal time to finish dismissal.
    const timer = setTimeout(() => setUnblocked(releaseToken), 350);
    return () => clearTimeout(timer);
  }, [input.blocked, input.focused, foreground, releaseToken]);
  const validate = useCallback((id: string, places?: ParkingPlace[]) => {
    const current = latest.current;
    if (!offeredRef.current?.ids.includes(id) || offeredRef.current.scope !== current.scope || current.blocked) return null;
    const zones = detector.current.update(current.fix, places ?? current.places, current.plate, foregroundRef.current && AppState.currentState === "active" && current.focused, Date.now());
    return zones?.find(place => place.id === id) ?? null;
  }, []);
  useEffect(() => {
    const ids = detector.current.update(input.fix, input.places, input.plate, foreground && input.focused, Date.now())?.map(place => place.id) ?? [];
    if (offered) {
      if (choiceKey(ids) !== choiceKey(offered.ids) || offered.scope !== input.scope || input.blocked) setOffered(null);
      return;
    }
    // A missing plate is asked for in the offer itself.
    if (ids.length && unblocked === releaseToken && !input.blocked && detector.current.canPrompt(ids, input.plate)) {
      setOffered({ ids, scope: input.scope });
    }
  }, [input.fix, input.places, input.plate, input.scope, input.focused, input.blocked, foreground, unblocked, releaseToken, tick, offered]);
  const dismiss = useCallback((remember = true) => {
    const current = latest.current, shown = offeredRef.current;
    // A temporary competing sheet/background transition must not consume this offer.
    // Only a deliberate close or completed SMS action starts its cooldown.
    if (remember && shown && shown.scope === current.scope) detector.current.prompted(shown.ids, current.plate);
    offeredRef.current = null; setOffered(null);
  }, []);
  const choices = useMemo(() => offered && offered.scope === input.scope ? offered.ids.flatMap(id => input.places.filter(place => place.id === id)) : [], [offered, input.scope, input.places]);
  return { choices, validate, dismiss };
}
