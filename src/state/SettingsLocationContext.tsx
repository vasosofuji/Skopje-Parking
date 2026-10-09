import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { LocationIssue } from "../domain/locationWatch";

type MapLocationControls = { locationStatus: string; issue: LocationIssue | null; onRefreshLocation: () => void };
type Register = (controls: MapLocationControls) => () => void;
const Controls = createContext<MapLocationControls | null>(null);
const Registration = createContext<Register | null>(null);

/** Keep Settings connected to the map's GPS without starting another continuous watcher. */
export function SettingsLocationProvider({ children }: { children: React.ReactNode }) {
  const [controls, setControls] = useState<MapLocationControls | null>(null);
  const register = useCallback((next: MapLocationControls) => {
    setControls(next);
    return () => setControls(current => current === next ? null : current);
  }, []);
  return <Registration.Provider value={register}><Controls.Provider value={controls}>{children}</Controls.Provider></Registration.Provider>;
}
export function useSettingsLocation() { return useContext(Controls); }
export function useMapSettingsLocation(controls: MapLocationControls) {
  const register = useContext(Registration), latest = useRef(controls);
  useEffect(() => { latest.current = controls; });
  useEffect(() => register?.({ locationStatus: controls.locationStatus, issue: controls.issue, onRefreshLocation: () => latest.current.onRefreshLocation() }), [register, controls.locationStatus, controls.issue]);
}
