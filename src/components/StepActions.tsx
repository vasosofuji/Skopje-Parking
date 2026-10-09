import React from "react";
import { View } from "react-native";
import { useParking } from "../state/ParkingContext";
import { Button } from "./ui";

export default function StepActions({ onBack, onContinue, title, disabled, backDisabled = disabled }: {
  onBack?: () => void;
  onContinue: () => void;
  title?: string;
  disabled?: boolean;
  backDisabled?: boolean;
}) {
  const { t } = useParking();
  return <View style={{ flexDirection: "row", alignItems: "stretch", gap: 12 }}>
    {onBack ? <Button style={{ flex: 1, minHeight: 52 }} title={t("Back", "Назад")} variant="secondary" disabled={backDisabled} onPress={onBack} /> : null}
    <Button style={{ flex: onBack ? 1.6 : 1, minHeight: 52 }} title={title ?? t("Continue", "Продолжи")} disabled={disabled} onPress={onContinue} />
  </View>;
}
