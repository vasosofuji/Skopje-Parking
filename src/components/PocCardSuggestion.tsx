import React, { useState } from "react";
import { Text, View } from "react-native";
import type { PocCardZone } from "../domain/poc-cards";
import { POC_PRICES } from "../domain/poc-cards";
import { useParking } from "../state/ParkingContext";
import { useTheme } from "../state/ThemeContext";
import { Button, Note, Sheet } from "./ui";

export default function PocCardSuggestion({ zone, visible, onClose }: { zone: PocCardZone; visible: boolean; onClose: () => void }) {
  const { t } = useParking(), { colors } = useTheme();
  const [longer, setLonger] = useState(false), prices = POC_PRICES[zone];
  return <Sheet visible={visible} title={t("A parking card may suit you", "Можеби ви одговара паркинг карта")} onClose={onClose}>
    <Note>{t("You have recorded three visits to this parking spot in seven days. POC 1 and POC 2 offer these ordinary parking cards.", "Забележани се три посети на овој паркинг во седум дена. ПОЦ 1 и ПОЦ 2 ги нудат овие паркинг карти.")}</Note>
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Button variant={longer ? "secondary" : "primary"} title={t("About a week", "Околу една недела")} onPress={() => setLonger(false)} />
      <Button variant={longer ? "primary" : "secondary"} title={t("Regular visits", "Редовни посети")} onPress={() => setLonger(true)} />
    </View>
    <Text style={{ color: colors.ink, fontSize: 21, fontWeight: "700" }}>{longer ? t("Monthly parking card", "Месечна паркинг карта") : t("Weekly parking card", "Неделна паркинг карта")} · {longer ? prices.monthly : prices.weekly} MKD</Text>
    <Note>{t("Multi-weekly parking card", "Мулти неделна паркинг карта")}: {prices.multiWeekly} MKD</Note>
    <Note>{t("A card may cost less depending on how long and how often you park. Check eligibility and coverage with POC before buying. These are not reserved parking spaces.", "Карта може да чини помалку зависно од траењето и честотата на паркирање. Проверете ги условите и важноста кај ПОЦ пред купување. Овие карти не се резервирани паркинг места.")}</Note>
    <Note>{t("Source: JP Parkinzi na Opština Centar, 2026 tariff list · Zone", "Извор: ЈП Паркинзи на Општина Центар, ценовник 2026 · Зона")} {zone}</Note>
    <Button title={t("Got it", "Во ред")} onPress={onClose} />
  </Sheet>;
}
