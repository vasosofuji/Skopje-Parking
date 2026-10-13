import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Fix } from "../domain/arrival";
import type { ParkingPlace } from "../domain/types";
import { placeName } from "../domain/language";
import { parkingPrice } from "../domain/parking";
import { smsMessage } from "../domain/sms-payment";
import { useSmsPayment } from "../hooks/useSmsPayment";
import { useLicensePlate } from "../state/LicensePlateContext";
import { useParking } from "../state/ParkingContext";
import { useTheme } from "../state/ThemeContext";
import { Button, IconButton, Note } from "./ui";

type Props = {
  /** Detected zones, nearest first. Several means the driver picks the one on the sign. */
  choices: ParkingPlace[];
  validate: (id: string, places?: ParkingPlace[]) => ParkingPlace | null;
  fix: Fix | null;
  onClose: () => void;
  onPaid: () => void;
  onInvalidated: () => void;
  onOtherZone: () => void;
  onAddPlate: (place: ParkingPlace) => void;
};
/** A small non-blocking offer to pay the detected zone by SMS in one tap. */
export default function QuickPayCard({ choices, validate, fix, onClose, onPaid, onInvalidated, onOtherZone, onAddPlate }: Props) {
  const { t, now, language } = useParking(), { colors } = useTheme(), { savedPlate } = useLicensePlate();
  const { pay, busy, error } = useSmsPayment({ validate, fix, onOpened: onPaid, onInvalidated });
  const [picked, setPicked] = useState<string | null>(null), [hourChoice, setHourChoice] = useState<{ id: string; hours: number } | null>(null);
  const zone = choices.length === 1 ? choices[0] : choices.find(place => place.id === picked) ?? null;
  const protocol = zone?.smsPayment, price = zone ? parkingPrice(zone, now) : null;
  const code = zone?.zoneCode ?? protocol?.zoneCode ?? "";
  const hours = hourChoice && hourChoice.id === zone?.id ? hourChoice.hours : null, fixedHours = protocol?.mode === "fixed-hours";
  const muted = { color: colors.muted, fontSize: 13 };
  return <View accessibilityLiveRegion="polite" style={{ width: "100%", maxWidth: 380, gap: 8, padding: 12, paddingTop: 8, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, elevation: 5, boxShadow: "0 3px 14px #153d3a30" }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text style={[muted, { flex: 1 }]}>{choices.length > 1 ? t("Which zone is on the sign?", "Која зона е на знакот?") : t("Pay for parking here?", "Да платите паркинг тука?")}</Text>
      <IconButton name="x" label={t("Close", "Затвори")} onPress={onClose} />
    </View>
    {choices.length > 1 ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {choices.map(place => <Button key={place.id} title={place.zoneCode ?? place.name} variant={place.id === zone?.id ? "primary" : "secondary"} onPress={() => setPicked(place.id)} />)}
    </View> : null}
    {zone && protocol ? <>
      <Text numberOfLines={2} style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>{code} · {placeName(zone, language)}</Text>
      {price ? <Text style={muted}>{price.firstHour === price.nextHour ? t("{price} MKD per hour", "{price} денари на час").replace("{price}", String(price.firstHour))
        : t("{first} MKD first hour, then {next} MKD", "{first} денари прв час, потоа {next} денари").replace("{first}", String(price.firstHour)).replace("{next}", String(price.nextHour))}</Text> : null}
      {fixedHours ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {protocol.allowedHours?.map(value => <Button key={value} title={`${value} ${value === 1 ? t("Hour", "Час").toLocaleLowerCase() : t("hours", "часа")}`} variant={hours === value ? "primary" : "secondary"} onPress={() => setHourChoice({ id: zone.id, hours: value })} />)}
      </View> : null}
      {savedPlate ? <Button icon="message-square" title={busy ? t("Checking…", "Се проверува…") : t("Pay {zone} by SMS", "Плати {zone} со SMS").replace("{zone}", code)} disabled={busy || (fixedHours && hours === null)} onPress={() => void pay(zone, hours)} />
        : <>
          <Note>{t("Add your licence plate to pay by SMS. It stays on this device.", "Додајте ја регистарската табличка за плаќање со SMS. Се чува само на овој уред.")}</Note>
          <Button icon="plus" title={t("Add licence plate", "Додај регистарска табличка")} onPress={() => onAddPlate(zone)} />
        </>}
      <Text style={muted}>{t("Check that the sign at your car shows {zone}.", "Проверете дали знакот покрај возилото покажува {zone}.").replace("{zone}", code)}</Text>
    </> : null}
    {error ? <Note>{error}</Note> : null}
    {error && protocol && savedPlate && (!fixedHours || hours !== null) ? <Text selectable style={{ color: colors.ink }}>{t("SMS number", "SMS број")}: {protocol.destination} · {smsMessage(protocol.startTemplate, protocol.zoneCode, savedPlate, fixedHours ? hours : null)}</Text> : null}
    <Pressable accessibilityRole="button" onPress={onOtherZone} hitSlop={6} style={{ alignSelf: "flex-start", minHeight: 32, justifyContent: "center" }}>
      <Text style={{ color: colors.accentText, fontWeight: "600", fontSize: 13 }}>{t("Other zone", "Друга зона")}</Text>
    </Pressable>
  </View>;
}
