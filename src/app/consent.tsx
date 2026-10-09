import React, { useRef, useState } from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/ui";
import TermsConsent from "../components/TermsConsent";
import { useAccount } from "../state/AccountContext";
import { useParking } from "../state/ParkingContext";
import { useTheme } from "../state/ThemeContext";

/** Existing accounts renew consent without replacing their identity or points. */
export default function Consent() {
  const account = useAccount();
  const { t } = useParking(), { colors } = useTheme();
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  async function accept() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError("");
    try { await account.guest(true); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t("Could not save. Try again.", "Не е зачувано. Обидете се повторно.")); }
    finally { pending.current = false; setBusy(false); }
  }
  async function signOut() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError("");
    try { await account.logout(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t("Could not sign out.", "Неуспешна одјава.")); }
    finally { pending.current = false; setBusy(false); }
  }
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }}>
    <View style={{ flex: 1, padding: 24, gap: 20, justifyContent: "center", maxWidth: 440, width: "100%", alignSelf: "center" }}>
      <Text accessibilityRole="header" style={{ color: colors.ink, fontWeight: "700", fontSize: 28 }}>{t("Updated terms", "Ажурирани услови")}</Text>
      <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>{t("Review the terms to continue.", "Прегледајте ги условите за да продолжите.")}</Text>
      <Button title={t("Review terms", "Прегледај услови")} disabled={busy} onPress={() => setOpen(true)} />
      {account.profile?.secured ? <Button title={t("Sign out", "Одјави се")} disabled={busy} variant="secondary" onPress={() => void signOut()} /> : null}
      {!open && error ? <Text accessibilityLiveRegion="polite" style={{ color: colors.red }}>{error}</Text> : null}
    </View>
    {open ? <TermsConsent busy={busy} error={error} onClose={() => setOpen(false)} onAccept={() => void accept()} /> : null}
  </SafeAreaView>;
}
