import React, { useEffect, useState } from "react";
import { AppState, Linking, Platform, Text, View } from "react-native";
import { useParking } from "../state/ParkingContext";
import { useTheme } from "../state/ThemeContext";
import { Button } from "./ui";
import LoadingIndicator from "./LoadingIndicator";
import { saveArrivalCatalog } from "../services/arrivalStorage";
import { stopDestinationAlerts } from "../services/destinationAlerts";
import {
  disableBackgroundArrival,
  enableBackgroundArrival,
  getBackgroundArrivalStatus,
  observeBackgroundArrivalSettings,
} from "../services/backgroundArrival";

export default function BackgroundArrivalSettings() {
  const { colors } = useTheme();
  const { t, catalog } = useParking();
  const [status, setStatus] = useState({ supported: false, enabled: false, running: false });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stopped, setStopped] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => { void getBackgroundArrivalStatus().then((value) => { if (active) setStatus(value); }).catch(() => {}).finally(() => { if (active) setLoading(false); }); };
    refresh();
    const remove = observeBackgroundArrivalSettings(refresh);
    const app = AppState.addEventListener("change", (value) => { if (value === "active") refresh(); });
    return () => { active = false; remove(); app.remove(); };
  }, []);
  const toggle = async () => {
    if (busy || loading) return;
    setBusy(true);
    setError("");
    try {
      if (status.enabled) await Promise.all([disableBackgroundArrival(), stopDestinationAlerts()]);
      else {
        // Start permission request in the press gesture; Safari rejects it after storage awaits.
        await Promise.all([enableBackgroundArrival(), saveArrivalCatalog(catalog.places)]);
      }
      setStatus(await getBackgroundArrivalStatus());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("Couldn't change reminders. Please try again.", "Не успеа промената. Обидете се повторно."));
    } finally { setBusy(false); }
  };
  return <View style={{ gap: 8, marginTop: 6 }}>
    <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "600" }}>{t("Parking reminders", "Потсетници за паркирање")}</Text>
    {loading ? <LoadingIndicator size="small" inline label={t("Checking…", "Се проверува…")} /> : status.supported ? <>
      <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>
        {Platform.OS === "web" ? t("Arrival reminders work while this page is running. Browsers can pause location when hidden or closed. Destination alerts can notify you in the background after you tap Go.", "Потсетниците за пристигнување работат додека страницата е активна. Прелистувачот може да ја паузира локацијата кога страницата е скриена или затворена. Известувањата за дестинацијата може да пристигнуваат во заднина откако ќе притиснете Оди.") : status.enabled ? t("On · background location and notifications", "Вклучени · локација во заднина и известувања") : t("Optional · uses background location and notifications", "По избор · користи локација во заднина и известувања")}
      </Text>
      <Button icon={status.enabled ? "bell-off" : "bell"} variant="secondary" disabled={busy}
        title={busy ? t("Please wait…", "Почекајте…") : status.enabled ? t("Turn reminders off", "Исклучи потсетници") : t("Enable parking reminders", "Вклучи потсетници за паркирање")}
        onPress={() => { void toggle(); }} />
      {status.enabled && !status.running ? <Text style={{ color: colors.muted, fontSize: 12 }}>{t("Return to the map to start reminders.", "Вратете се на мапата за да почнат потсетниците.")}</Text> : null}
    </> : <Text style={{ color: colors.muted, fontSize: 12 }}>
      {Platform.OS === "web" ? t("Use HTTPS and a browser with notification support. On iPhone, add Parking to your Home Screen first.", "Користете HTTPS и прелистувач со известувања. На iPhone, прво додајте Parking на почетниот екран.") : t("Install the updated Parking build to use background reminders.", "Инсталирајте ја ажурираната Parking апликација за потсетници во заднина.")}
    </Text>}
    {error ? <>
      <Text accessibilityRole="alert" style={{ color: colors.red, fontSize: 12 }}>{error}</Text>
      {Platform.OS !== "web" ? <Button title={t("Open phone settings", "Отвори поставки на телефонот")} variant="secondary" onPress={() => { void Linking.openSettings().catch(() => {}); }} /> : null}
    </> : null}
    <Text style={{ color: colors.muted, fontSize: 12 }}>{t("Go monitors your destination for up to 90 minutes. You can stop those alerts here.", "Оди го следи паркингот до 90 минути. Тука можете да ги запрете известувањата.")}</Text>
    <Button title={stopped ? t("Destination alerts stopped", "Известувањата се запрени") : t("Stop destination alerts", "Запри известувања за дестинацијата")} variant="secondary" disabled={busy}
      onPress={() => { setBusy(true); setError(""); void stopDestinationAlerts().then(() => setStopped(true)).catch(failure => setError(failure instanceof Error ? failure.message : t("Could not stop destination alerts. Try again online.", "Не може да се запрат известувањата. Обидете се со интернет."))).finally(() => setBusy(false)); }} />
  </View>;
}
