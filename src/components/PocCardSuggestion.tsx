import React, { useState } from "react";
import { Text, View } from "react-native";
import { POC_PRICES } from "../domain/poc-cards";
import type { CardOffer } from "../domain/parking-passes";
import { LOCALES } from "../domain/language";
import { useParking } from "../state/ParkingContext";
import { useTheme } from "../state/ThemeContext";
import { Button, Note, Sheet } from "./ui";

export default function PocCardSuggestion({ offer, visible, onClose }: { offer: CardOffer; visible: boolean; onClose: () => void }) {
  const { t, language } = useParking(), { colors } = useTheme();
  const [longer, setLonger] = useState(false);
  if (offer.kind === "paid") {
    const poc = offer.operator === "poc", amount = (value: number) => value.toLocaleString(LOCALES[language]);
    const message = (poc
      ? t("You paid in {zone} {count} times in the past 7 days. A monthly card costs {price} MKD, about {saving} MKD less than paying each time.", "Платевте во {zone} {count} пати во последните 7 дена. Месечна карта чини {price} ден., околу {saving} ден. помалку од плаќање секој пат.")
      : t("You paid in zone {zone} {count} times in the past 7 days. A monthly subscription for all of zone {zone} costs {price} MKD, about {saving} MKD less than paying each time.", "Платевте во зона {zone} {count} пати во последните 7 дена. Месечна претплата за цела зона {zone} чини {price} ден., околу {saving} ден. помалку од плаќање секој пат."))
      .replace(/\{zone\}/g, poc ? `POC ${offer.zone === "I" ? 1 : 2}` : offer.zone).replace("{count}", String(offer.visits)).replace("{price}", amount(offer.price)).replace("{saving}", amount(offer.saving));
    return <Sheet visible={visible} title={t("A monthly card may save you money", "Месечна карта може да ви заштеди")} onClose={onClose}>
      <Text style={{ color: colors.ink, fontSize: 16, lineHeight: 23 }}>{message}</Text>
      <Note>{t("Estimated from payments started in Skopje Parking and projected to a month. The app cannot see whether each SMS was sent.", "Проценето од плаќањата започнати во Skopje Parking, пресметано за еден месец. Апликацијата не може да види дали секоја SMS порака е испратена.")}</Note>
      <Note>{poc ? t("Check eligibility and coverage with POC before buying. These are not reserved parking spaces.", "Проверете ги условите и важноста кај ПОЦ пред купување. Ова не се резервирани паркинг места.") : t("Check eligibility and coverage with Gradski Parking before buying. This is not a reserved parking space.", "Проверете ги условите и важноста кај Градски паркинг пред купување. Ова не е резервирано паркинг место.")}</Note>
      <Note>{poc ? `${t("Source: JP Parkinzi na Opština Centar, 2026 tariff list · Zone", "Извор: ЈП Паркинзи на Општина Центар, ценовник 2026 · Зона")} ${offer.zone}` : t("Source: JP Gradski Parking price list", "Извор: ценовник на ЈП Градски паркинг")}</Note>
      <Button title={t("Got it", "Во ред")} onPress={onClose} />
    </Sheet>;
  }
  const prices = POC_PRICES[offer.zone];
  return <Sheet visible={visible} title={t("A parking card may suit you", "Можеби ви одговара паркинг карта")} onClose={onClose}>
    <Note>{t("You have recorded three visits to this parking spot in seven days. POC 1 and POC 2 offer these ordinary parking cards.", "Забележани се три посети на овој паркинг во седум дена. ПОЦ 1 и ПОЦ 2 ги нудат овие паркинг карти.")}</Note>
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Button variant={longer ? "secondary" : "primary"} title={t("About a week", "Околу една недела")} onPress={() => setLonger(false)} />
      <Button variant={longer ? "primary" : "secondary"} title={t("Regular visits", "Редовни посети")} onPress={() => setLonger(true)} />
    </View>
    <Text style={{ color: colors.ink, fontSize: 21, fontWeight: "700" }}>{longer ? t("Monthly parking card", "Месечна паркинг карта") : t("Weekly parking card", "Неделна паркинг карта")} · {longer ? prices.monthly : prices.weekly} MKD</Text>
    <Note>{t("Multi-weekly parking card", "Мулти неделна паркинг карта")}: {prices.multiWeekly} MKD</Note>
    <Note>{t("A card may cost less depending on how long and how often you park. Check eligibility and coverage with POC before buying. These are not reserved parking spaces.", "Карта може да чини помалку зависно од траењето и честотата на паркирање. Проверете ги условите и важноста кај ПОЦ пред купување. Овие карти не се резервирани паркинг места.")}</Note>
    <Note>{t("Source: JP Parkinzi na Opština Centar, 2026 tariff list · Zone", "Извор: ЈП Паркинзи на Општина Центар, ценовник 2026 · Зона")} {offer.zone}</Note>
    <Button title={t("Got it", "Во ред")} onPress={onClose} />
  </Sheet>;
}
