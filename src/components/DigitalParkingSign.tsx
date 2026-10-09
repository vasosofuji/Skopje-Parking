import { weekendLabel } from "./PaymentScheduleFields";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { SignInfo } from "../domain/types";
import { useParking } from "../state/ParkingContext";
import { useTheme } from "../state/ThemeContext";

export default function DigitalParkingSign({ info, compact = false, preview = false, sourceName }: {
  info: SignInfo;
  compact?: boolean;
  preview?: boolean;
  sourceName?: string;
}) {
  const { t } = useParking();
  const { colors } = useTheme();
  const free = info.firstHour === 0 && info.nextHour === 0;
  return (
    <View accessibilityLabel={t("Digital parking sign", "Дигитална паркинг табла")} style={[s.sign, { backgroundColor: colors.paper }]}>
      <View style={s.header}>
        <Text style={s.parking}>P</Text>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.zone}>{info.zoneCode ? `${t("ZONE", "ЗОНА")} ${info.zoneCode}` : t("PARKING", "ПАРКИНГ")}</Text>
          {info.operator && !compact ? <Text style={s.operator}>{info.operator}</Text> : null}
        </View>
      </View>
      <View style={{ padding: compact ? 10 : 14, gap: 7 }}>
        <Text style={{ color: colors.ink, fontSize: compact ? 17 : 23, fontWeight: "700" }}>
          {free ? t("FREE PARKING", "БЕСПЛАТНО") : info.firstHour !== null
            ? `${info.firstHour} ${info.currency ?? ""} / ${t("first hour", "прв час")}`
            : t("Price not shown", "Нема наведена цена")}
        </Text>
        {!free && info.nextHour !== null && info.nextHour !== info.firstHour ? <Text style={{ color: colors.ink }}>{info.nextHour} {info.currency ?? ""} / {t("following hour", "следен час")}</Text> : null}
        {info.chargingHours ? <Text style={{ color: colors.ink, fontWeight: "600" }}>{info.chargingHours}</Text> : null}
        {info.freeWeekends ? <Text style={{ color: colors.ink }}>{weekendLabel(info.freeWeekends, t)}</Text> : null}
        {!compact && info.maxStayMinutes !== null ? <Text style={{ color: colors.ink }}>{t("Maximum stay", "Максимален престој")}: {info.maxStayMinutes} {t("min", "мин")}</Text> : null}
        {!compact && info.paymentInstructions ? <Text style={{ color: colors.ink, lineHeight: 20 }}>{info.paymentInstructions}</Text> : null}
        {!compact && info.restrictions ? <Text style={{ color: colors.ink, lineHeight: 20 }}>{info.restrictions}</Text> : null}
        <Text style={{ color: colors.muted, fontSize: 11, lineHeight: 16 }}>
          {preview ? t("Preview · check against the photo", "Преглед · проверете со сликата") : t("Sign details confirmed by a contributor", "Податоци потврдени од корисник")}
          {sourceName ? ` · ${sourceName}` : ""}
        </Text>
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  sign: { borderWidth: 2, borderColor: "#2056A0", borderRadius: 12, overflow: "hidden" },
  header: { backgroundColor: "#2056A0", flexDirection: "row", padding: 12, alignItems: "center", gap: 14 },
  parking: { color: "#FFFFFF", fontSize: 38, fontWeight: "800", lineHeight: 42 },
  zone: { color: "#FFFFFF", fontSize: 19, fontWeight: "800", letterSpacing: 1 },
  operator: { color: "#E3EEFF", fontSize: 12 },
});
