import React, { useEffect, useRef, useState } from "react";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import SettingsSheet from "../components/SettingsSheet";
import LocationHelp from "../components/LocationHelp";
import { useSettingsLocation } from "../state/SettingsLocationContext";
import { useParking } from "../state/ParkingContext";
import { watchLocation } from "../services/location";
import type { LocationIssue } from "../domain/locationWatch";

export default function SettingsRoute() {
  const controls = useSettingsLocation(), { t } = useParking();
  const focused = useIsFocused();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const [permissions, setPermissions] = useState(false);
  const [directStatus, setDirectStatus] = useState<string | null>(null);
  const [directIssue, setDirectIssue] = useState<LocationIssue | null>(null);
  const request = useRef({ version: 0, stop: null as (() => void) | null });
  useEffect(() => () => { request.current.version++; request.current.stop?.(); }, []);
  function refreshLocation() {
    if (controls) { controls.onRefreshLocation(); return; }
    // A direct /settings link can work before the map has ever mounted.
    const current = request.current;
    current.stop?.(); current.stop = null;
    const version = ++current.version;
    let finished = false;
    const finish = () => { finished = true; current.stop?.(); current.stop = null; };
    setDirectIssue(null); setDirectStatus(t("Finding your location…", "Се бара вашата локација…"));
    void watchLocation(fix => {
      if (current.version !== version || finished) return;
      setDirectStatus(fix.accuracy !== null && fix.accuracy > 50 ? t("Location is approximate", "Локацијата е приближна") : t("Location active", "Локацијата е активна"));
      finish();
    }, issue => {
      if (current.version !== version || finished) return;
      setDirectIssue(issue); setDirectStatus(issue.code === "denied" || issue.code === "blocked" ? t("Location access is off", "Пристапот до локација е исклучен") : t("Location needs attention", "Проверете ја локацијата"));
      finish();
    }).then(stop => { if (finished || current.version !== version) stop(); else current.stop = stop; }).catch(() => {
      if (current.version !== version || finished) return;
      setDirectIssue({ code: "unavailable" }); setDirectStatus(t("Location needs attention", "Проверете ја локацијата")); finish();
    });
  }
  return <>
    <SettingsSheet visible initialSection={section === "reader" ? "reader" : undefined} onClose={() => router.canGoBack() ? router.back() : router.replace("/")} locationStatus={controls?.locationStatus ?? directStatus ?? t("Location", "Локација")} onRefreshLocation={refreshLocation} onPermissions={() => setPermissions(true)} />
    <LocationHelp visible={permissions && focused} permissions issue={controls ? controls.issue : directIssue} onClose={() => setPermissions(false)} onRetry={refreshLocation} />
  </>;
}
