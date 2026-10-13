import React, { useState } from "react";
import { Text, View } from "react-native";
import type { Fix } from "../domain/arrival";
import type { Coordinate } from "../domain/types";
import { sessionEndsAt, type ParkingSession } from "../domain/parking-sessions";
import { carPosition, skopjeClock } from "../domain/my-car";
import { openParkingDirections } from "../services/navigation";
import { updateParkingSession } from "../services/parkingSessions";
import { useParking } from "../state/ParkingContext";
import { useTheme } from "../state/ThemeContext";
import { Button, IconButton, Note } from "./ui";

/** Where the car was left when paying, with walking directions and a manual fix. Stored on this device only. */
export default function MyCarCard({ session, fix, onClose }: { session: ParkingSession; fix: Fix | null; onClose: () => void }) {
  const { t, now } = useParking(), { colors } = useTheme();
  const [error, setError] = useState("");
  // The context clock ticks slowly; a fix newer than it is still fresh.
  const here = carPosition(fix, Math.max(now, fix?.timestamp ?? 0));
  const save = (car: Coordinate | null) => {
    setError("");
    void updateParkingSession(session.id, value => ({ ...value, car })).catch(() => setError(t("Could not save. Try again.", "Не е зачувано. Обидете се повторно.")));
  };
  const setHere = () => {
    const car = carPosition(fix, Date.now());
    if (car) save(car); else setError(t("Waiting for a precise location.", "Се чека прецизна локација."));
  };
  const end = sessionEndsAt(session);
  const when = session.paidHours !== null && end !== null ? t("Paid until {time}", "Платено до {time}").replace("{time}", skopjeClock(end))
    : t("Parked since {time}", "Паркирано од {time}").replace("{time}", skopjeClock(session.startedAt));
  return <View accessibilityLiveRegion="polite" style={{ width: "100%", maxWidth: 380, gap: 8, padding: 12, paddingTop: 8, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, elevation: 5, boxShadow: "0 3px 14px #153d3a30" }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text accessibilityRole="header" style={{ flex: 1, color: colors.ink, fontSize: 17, fontWeight: "700" }}>{t("My car", "Моето возило")}</Text>
      <IconButton name="x" label={t("Close", "Затвори")} onPress={onClose} />
    </View>
    <Text style={{ color: colors.muted, fontSize: 13 }}>{session.zoneCode} · {when}</Text>
    {session.car ? <Button icon="navigation" title={t("Walk to car", "Пешки до возилото")} onPress={() => void openParkingDirections(session.car!, true).catch(() => setError(t("Could not open navigation", "Навигацијата не се отвора")))} />
      : <Note>{t("No precise location was saved for your car.", "Не е зачувана прецизна локација на возилото.")}</Note>}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Button variant="secondary" icon="crosshair" title={t("Car is here", "Возилото е тука")} disabled={!here} onPress={setHere} />
      {session.car ? <Button variant="secondary" icon="trash-2" title={t("Clear location", "Избриши локација")} onPress={() => save(null)} /> : null}
    </View>
    {!here && !session.car ? <Note>{t("Stand next to your car with precise location on to save it.", "Застанете до возилото со вклучена прецизна локација за да ја зачувате.")}</Note> : null}
    {error ? <Note>{error}</Note> : null}
  </View>;
}
