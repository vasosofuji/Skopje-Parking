import { useTheme, type ThemeColors } from "../state/ThemeContext";
import { placeName } from "../domain/language";
import React, { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ParkingPlace } from "../domain/types";
import { currentAvailability } from "../domain/parking";
import { availabilityReportTime } from "../domain/report-feedback";
import { parkingMarker } from "../domain/marker-appearance";
import { useParking } from "../state/ParkingContext";
export default function ParkingRow({
  place,
  distance,
  cost,
  costEvidence,
  selected,
  onPress,
}: {
  place: ParkingPlace;
  distance: number;
  cost: number | null;
  costEvidence: "official" | "community" | "sign" | null;
  selected: boolean;
  onPress: (place: ParkingPlace) => void;
}) {
  const { colors } = useTheme();
  const s = styles(colors);
  const { t, language, now } = useParking();
  const available = currentAvailability(place.availability, now);
  const marker = parkingMarker(place, 1, now);
  const reportedAt = availabilityReportTime(place.availability, language, now);
  const status = {
    spaces: available.freeSpaces !== undefined ? `${available.freeSpaces} ${t("free reported", "пријавени слободни")}${place.capacity !== null ? ` / ${place.capacity}` : ""}` : t("Spaces reported", "Пријавени слободни места"),
    full: t("Full reported", "Пријавено полн"),
    mixed: t("Conflicting reports", "Различни пријави"),
    unknown: t("No recent report", "Нема свежа пријава"),
  }[available.status] + (reportedAt ? ` · ${t("Reported at", "Пријавено во")} ${reportedAt}` : "");
  const handlePress = useCallback(() => onPress(place), [onPress, place]);
  const displayCost = cost;
  const name = placeName(place, language);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${Math.round(distance)} ${t("metres straight-line", "метри воздушно")}, ${cost === 0 ? t("free parking", "бесплатен паркинг") : cost === null ? t("price unknown", "непозната цена") : `${cost} ${t("MKD per first hour", "денари за прв час")}`}, ${status}`}
      onPress={handlePress}
      style={[s.row, selected ? s.selected : null]}
    >
      <View style={[s.symbol, { backgroundColor: marker.fill, borderColor: marker.border, borderWidth: 2 }]}>
        <Text style={{ color: marker.text, fontWeight: "800", fontSize: 14 }}>{marker.needsInfo ? "?" : "P"}</Text>
        {marker.freeOfCharge ? <View style={s.freeBadge}><Text style={s.freeBadgeText}>0</Text></View> : null}
      </View>
      <View style={s.main}>
        <Text numberOfLines={1} style={s.name}>
          {place.zoneCode ? `${place.zoneCode} · ` : ""}
          {name}
        </Text>
        <Text numberOfLines={1} style={s.meta}>
          {Math.round(distance)} {t("m", "м")} ·{" "}
          {marker.needsInfo ? t("Needs review · ", "Треба проверка · ") : ""}
          {place.kind === "garage"
            ? t("Garage", "Катна гаража")
            : place.kind === "underground"
              ? t("Underground", "Подземна")
              : t("Parking", "Паркинг")}
        </Text>
        <View style={s.status}>
          <View
            style={[
              s.dot,
              {
                backgroundColor:
                  available.status === "spaces"
                    ? colors.success
                    : available.status === "full"
                      ? colors.red
                      : "#869892",
              },
            ]}
          />
          <Text numberOfLines={2} style={s.statusText}>{status}</Text>
        </View>
      </View>
      <View style={s.price}>
        <Text numberOfLines={1} style={[s.amount, displayCost === 0 && s.freeAmount]}>{displayCost === null ? "—" : displayCost === 0 ? t("Free", "Бесплатно") : displayCost}</Text>
        {displayCost !== 0 ? <Text style={s.currency}>
          {displayCost === null
            ? t("unknown", "непознато")
            : t("MKD / first hr", "ден. / прв ч.")}
        </Text> : null}
        {displayCost !== null && costEvidence !== "official" ? (
          <Text style={s.currency}>{t("Reported", "Пријавено")}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}
const styles = (colors: ThemeColors) =>
  StyleSheet.create({
    row: {
      padding: 8,
      gap: 8,
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: 1,
      borderBottomColor: colors.line,
      backgroundColor: colors.paper,
    },
    selected: { backgroundColor: colors.mint },
    symbol: {
      width: 32,
      height: 36,
      borderRadius: 10,
      backgroundColor: colors.mint,
      alignItems: "center",
      justifyContent: "center",
    },
    freeBadge: { position: "absolute", top: -6, right: -6, width: 16, height: 16, borderRadius: 8, backgroundColor: "#fff", borderColor: "#087184", borderWidth: 1, alignItems: "center", justifyContent: "center" },
    freeBadgeText: { color: "#07596A", fontSize: 10, fontWeight: "800" },
    main: { flex: 1, minWidth: 0, gap: 3 },
    name: { fontSize: 14, fontWeight: "700", color: colors.ink },
    meta: { fontSize: 12, color: colors.muted },
    status: { flexDirection: "row", gap: 5, alignItems: "center" },
    dot: { width: 6, height: 6, borderRadius: 3 },
    statusText: { color: colors.muted, fontSize: 11, flexShrink: 1 },
    price: { width: 76, alignItems: "flex-end", gap: 2 },
    amount: { fontSize: 18, fontWeight: "700", color: colors.ink },
    freeAmount: { fontSize: 14 },
    currency: { fontSize: 10, color: colors.muted },
  });
