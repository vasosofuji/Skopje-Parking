import { useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  containsParkingFix,
  type Fix,
} from "../domain/arrival";
import { preferFix, usableFix } from "../domain/location";
import type { Coordinate, ParkingPlace } from "../domain/types";
import { watchLocation } from "../services/location";
import type { LocationIssue } from "../domain/locationWatch";
import { classifyLocationError } from "../domain/locationIssue";
import {
  consumePendingArrival,
  observePendingArrival,
  recordForegroundArrival,
  resetArrivalCandidate,
  markArrivalReported,
} from "../services/backgroundArrival";
import { saveArrivalCatalog } from "../services/arrivalStorage";

export function useArrival(places: ParkingPlace[], accountId: string | null = null) {
  const session = useMemo(() => ({ accountId }), [accountId]);
  const [fix, setFix] = useState<Fix | null>(null);
  const [initialLocation, setInitialLocation] = useState<Coordinate | null>(
    null,
  );
  const [arrival, setArrival] = useState<ParkingPlace | null>(null);
  const [arrivalOwner, setArrivalOwner] = useState<{ accountId: string | null } | null>(null);
  const [arrivalFromNotification, setArrivalFromNotification] = useState(false);
  const [status, setStatus] = useState<
    "loading" | "ready" | "approximate" | "denied" | "error"
  >("loading");
  const [retry, setRetry] = useState(0);
  const [issue, setIssue] = useState<LocationIssue | null>(null);
  const [precise, setPrecise] = useState(true);
  // Underground and in garages GPS fades just as drivers arrive; keep their last precise fix.
  const [lastPrecise, setLastPrecise] = useState<Fix | null>(null);
  const latest = useRef(places);
  const restored = useRef(false);
  useEffect(() => {
    latest.current = places;
    void saveArrivalCatalog(places).catch(() => {});
  }, [places]);
  useEffect(() => {
    let active = true;
    const restore = () => {
      // Notification callbacks can precede the OS foreground transition. Keep the pending
      // prompt persisted until the map is active, so an intermediate inactive event cannot erase it.
      if (AppState.currentState !== "active") return;
      void consumePendingArrival(latest.current, accountId).then((place) => {
        if (!active || !place) return;
        restored.current = true;
        setArrivalFromNotification(true);
        setArrivalOwner(session);
        setArrival(place);
      }).catch(() => {});
    };
    restore();
    const remove = observePendingArrival(restore);
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") restore(); });
    return () => { active = false; remove(); subscription.remove(); };
  }, [accountId, session]);
  useEffect(() => {
    restored.current = false;
    let active = true,
      previous: Fix | null = null,
      initialAccuracy = Infinity;
    let stop: (() => void) | undefined;
    function fail(value: LocationIssue) {
      if (!active) return;
      if (__DEV__ && value.detail)
        console.warn("Location provider:", value.code, value.detail);
      setIssue(value);
      if (previous && Date.now() - previous.timestamp < 30000) return;
      previous = null;
      setFix(null);
      if (!restored.current) setArrival(null);
      void resetArrivalCandidate(accountId).catch(() => {});
      setStatus(
        value.code === "denied" || value.code === "blocked"
          ? "denied"
          : "error",
      );
    }
    const stale = setInterval(() => {
      if (previous && Date.now() - previous.timestamp > 30000)
        fail({ code: "timeout" });
    }, 5000);
    const appState = AppState.addEventListener("change", (state) => {
      void resetArrivalCandidate(accountId).catch(() => {});
      if (state !== "active") {
        previous = null;
        setFix(null);
        setArrival(null);
        restored.current = false;
        setArrivalFromNotification(false);
        stop?.();
      } else {
        setStatus("loading");
        setIssue(null);
        setRetry((value) => value + 1);
      }
    });
    void watchLocation((next) => {
      if (
        !active ||
        AppState.currentState === "background" ||
        AppState.currentState === "inactive"
      )
        return;
      if (!usableFix(next) || !preferFix(previous, next)) return;
      previous = next;
      setFix(next);
      setIssue(null);
      if (next.accuracy! <= 30) setLastPrecise(next);
      setStatus(next.accuracy! > 50 ? "approximate" : "ready");
      if (initialAccuracy > 50 && next.accuracy! < initialAccuracy) {
        initialAccuracy = next.accuracy!;
        setInitialLocation({
          latitude: next.latitude,
          longitude: next.longitude,
        });
      }
      setArrival((current) =>
        current && !restored.current &&
        (next.accuracy! > 25 ||
          (next.speed !== null && next.speed > 0.8) ||
          !containsParkingFix(next, current))
          ? null
          : current,
      );
      void recordForegroundArrival(next, latest.current, accountId).then((parked) => {
        // Persistence can finish after a newer one-second fix. Do not discard a
        // legitimate prompt (and its recorded cooldown) just because time moved on.
        if (active && AppState.currentState === "active" && parked && previous && usableFix(previous) && previous.accuracy! <= 25 && (previous.speed === null || previous.speed <= 0.8) && containsParkingFix(previous, parked)) { restored.current = false; setArrivalFromNotification(false); setArrivalOwner(session); setArrival(parked); }
      }).catch(() => {});
    }, fail, (value) => { if (active) setPrecise(value); })
      .then((remove) => {
        stop = remove;
        if (!active || AppState.currentState === "background" || AppState.currentState === "inactive") remove();
      })
      .catch((error) => fail(classifyLocationError(error)));
    return () => {
      active = false;
      clearInterval(stale);
      stop?.();
      appState.remove();
      void resetArrivalCandidate(accountId).catch(() => {});
    };
  }, [retry, accountId, session]);
  return {
    location: fix,
    accuracy: fix?.accuracy ?? null,
    initialLocation,
    arrival: accountId && arrivalOwner === session ? arrival : null,
    arrivalFromNotification: Boolean(accountId) && arrivalOwner === session && arrivalFromNotification && Boolean(arrival),
    status,
    issue,
    approximatePermission: !precise,
    lastPrecise,
    reported: (placeId: string) => markArrivalReported(placeId, accountId),
    dismiss: () => { restored.current = false; setArrivalFromNotification(false); setArrival(null); },
    retry: () => {
      setStatus("loading");
      setIssue(null);
      setRetry((n) => n + 1);
    },
  };
}
