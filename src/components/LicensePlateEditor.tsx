import React, { useState } from "react";
import { Keyboard, Pressable, Text, TextInput, View } from "react-native";
import { useLicensePlate } from "../state/LicensePlateContext";
import { normalizeLicensePlate } from "../domain/license-plate";
import { useParking } from "../state/ParkingContext";
import { useTheme } from "../state/ThemeContext";
import StepActions from "./StepActions";

export default function LicensePlateEditor({ onDone, onCancel = onDone, optional = false }: { onDone: () => void; onCancel?: () => void; optional?: boolean }) {
  const { savedPlate, savePlate, dismissPrompt } = useLicensePlate();
  const { colors } = useTheme(), { t } = useParking();
  const [input, setInput] = useState(savedPlate ?? ""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const normalized = normalizeLicensePlate(input);
  const formatHint = t("Use 2 city letters, 3–4 numbers and 2 letters (SK1234FF).", "Користете 2 букви за градот, 3–4 бројки и 2 букви (SK1234FF).");
  async function save() {
    if (busy) return;
    if (input !== "" && !normalized) { setError(formatHint); return; }
    setBusy(true); setError(""); Keyboard.dismiss();
    try { await savePlate(normalized ?? ""); onDone(); }
    catch { setError(t("Could not save vehicle settings. Try again.", "Поставките за возилото не се зачувани. Обидете се повторно.")); }
    finally { setBusy(false); }
  }
  async function skip() {
    if (busy) return;
    setBusy(true); setError(""); Keyboard.dismiss();
    try { await dismissPrompt(); onDone(); }
    catch { setError(t("Could not save vehicle settings. Try again.", "Поставките за возилото не се зачувани. Обидете се повторно.")); }
    finally { setBusy(false); }
  }
  return <View style={{ gap: 16 }}>
    <TextInput value={input} editable={!busy} onChangeText={value => { setInput(value.toUpperCase().replace(/[ -]/g, "")); setError(""); }}
      accessibilityLabel={t("License plate", "Регистарска табличка")} accessibilityHint={formatHint} placeholder="SK1234FF"
      placeholderTextColor={colors.muted} autoCapitalize="characters" autoCorrect={false} autoComplete="off" maxLength={24}
      style={{ minHeight: 54, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: error ? colors.red : colors.line, color: colors.ink, backgroundColor: colors.input, fontSize: 20, fontWeight: "600", letterSpacing: 1 }} />
    <Text accessibilityLiveRegion="polite" style={{ color: input !== "" && !normalized ? colors.red : colors.muted, fontSize: 13 }}>{formatHint}</Text>
    <Text style={{ color: colors.muted, fontSize: 13 }}>{t("Stored on this device only", "Се чува само на овој уред")}</Text>
    {error && error !== formatHint ? <Text accessibilityLiveRegion="polite" style={{ color: colors.red }}>{error}</Text> : null}
    {optional ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void skip()} style={{ minHeight: 44, alignSelf: "center", justifyContent: "center", paddingHorizontal: 16 }}><Text style={{ color: colors.muted, fontSize: 15 }}>{t("Skip", "Прескокни")}</Text></Pressable> : null}
    <StepActions onBack={optional ? () => void skip() : onCancel} onContinue={() => void save()} title={optional ? t("Continue", "Продолжи") : t("Save", "Зачувај")} disabled={busy || (input !== "" && !normalized)} backDisabled={busy} />
  </View>;
}
