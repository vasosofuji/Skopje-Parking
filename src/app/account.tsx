import React, { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Page from "../components/Page";
import { Button, Note, FormScrollView, RevealSection } from "../components/ui";
import PasswordField from "../components/PasswordField";
import LoadingIndicator from "../components/LoadingIndicator";
import { useAccount } from "../state/AccountContext";
import { useParking } from "../state/ParkingContext";
import { useTheme } from "../state/ThemeContext";
import { api } from "../services/api";
import { REWARD_POINTS, cleanUsername, validUsername, validPassword, type RewardKind, type Rewards } from "../domain/account";

export default function Account() {
  const { colors } = useTheme(), { t } = useParking();
  const account = useAccount();
  const { refresh } = account;
  const guest = account.profile?.guest === true;
  const profileId = account.profile?.id ?? "";
  const [accountMode, setAccountMode] = useState<"create" | "login">("create");
  const signingIn = guest && accountMode === "login";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [section, setSection] = useState<"earn" | "history" | null>(null);
  const [rewardResult, setRewardResult] = useState<{ id: string; value: Rewards } | null>(null);
  const rewards = rewardResult?.id === profileId ? rewardResult.value : null;
  const reload = useCallback(async () => {
    await refresh();
    setRewardResult({ id: profileId, value: await api.rewards() });
  }, [refresh, profileId]);
  useEffect(() => {
    let active = true;
    void Promise.all([refresh(), api.rewards()]).then(([, next]) => {
      if (active) { setRewardResult({ id: profileId, value: next }); setFailed(false); }
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [refresh, profileId]);
  const labels: Record<RewardKind, string> = {
    parking: t("Add a parking", "Додај паркинг"),
    boundary: t("Draw its boundary", "Нацртај граници"),
    pricing: t("Add prices or mark free", "Додај цена или означи бесплатно"),
    capacity: t("Add total spaces", "Додај вкупен број места"),
    sign: t("Check a scanned sign", "Потврди скенирана табла"),
    availability: t("Share available spaces", "Пријави слободни места"),
  };
  async function secure() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      if (signingIn) await account.login(cleanUsername(username), password, true);
      else if (guest) await account.register(cleanUsername(username), true, password);
      else await account.secure(password);
      setPassword(""); setUsername("");
      setMessage(signingIn ? t("Signed in", "Најавени сте") : t("Account saved", "Профилот е зачуван"));
    } catch (error) { setMessage(error instanceof Error ? error.message : t("Could not save. Try again.", "Неуспешно зачувување. Обидете се повторно.")); }
    finally { setBusy(false); }
  }
  async function logout() {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await account.logout(); }
    catch (error) { setMessage(error instanceof Error ? error.message : t("Could not sign out. Try again.", "Неуспешна одјава. Обидете се повторно.")); }
    finally { setBusy(false); }
  }
  return <Page title={t("Your account", "Вашиот профил")}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <FormScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, gap: 22, maxWidth: 580, width: "100%", alignSelf: "center" }}>
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 28, fontWeight: "700", color: colors.ink }}>{guest ? t("Guest", "Гостин") : `@${account.profile?.username ?? ""}`}</Text>
          <Text style={{ fontSize: 42, fontWeight: "800", color: colors.accentText }}>{rewards?.total ?? account.profile?.points ?? 0} <Text style={{ fontSize: 18 }}>{t("points", "поени")}</Text></Text>
        </View>
        {!account.profile?.secured ? <View style={{ gap: 12, padding: 16, borderWidth: 1, borderColor: colors.line, borderRadius: 16, backgroundColor: colors.input }}>
          <Text style={{ fontSize: 19, fontWeight: "700", color: colors.ink }}>{signingIn ? t("Sign in", "Најави се") : guest ? t("Create account", "Создај профил") : t("Add a password", "Додај лозинка")}</Text>
          <Note>{signingIn ? t("Guest points won't transfer to an existing account.", "Поените како гостин нема да се пренесат на постоен профил.") : t("Keep your points when you change phones.", "Зачувајте ги поените кога менувате телефон.")}</Note>
          {guest ? <TextInput accessibilityLabel={t("Username", "Корисничко име")} value={username} editable={!busy} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username" maxLength={20} placeholder={t("Username", "Корисничко име")} placeholderTextColor={colors.muted} style={{ minHeight: 52, padding: 14, fontSize: 17, borderRadius: 12, borderWidth: 1, borderColor: colors.line, color: colors.ink, backgroundColor: colors.input }} /> : null}
          <PasswordField value={password} onChange={setPassword} creating={!signingIn} disabled={busy} />
          {!signingIn ? <Note>{t("At least 10 characters · Save your password", "Најмалку 10 знаци · Зачувајте ја лозинката")}</Note> : null}
          <Button title={busy ? t("Please wait…", "Почекајте…") : signingIn ? t("Sign in", "Најави се") : t("Save account", "Зачувај профил")} disabled={busy || (signingIn ? !password : !validPassword(password)) || (guest && !validUsername(username))} onPress={() => void secure()} />
          {guest ? <Button title={signingIn ? t("Create a new account instead", "Создај нов профил") : t("Sign in to an existing account", "Најави се на постоен профил")} variant="secondary" disabled={busy} onPress={() => { setAccountMode(signingIn ? "create" : "login"); setPassword(""); setMessage(""); }} /> : null}
        </View> : null}
        <Button title={t("Rewards & appearance", "Награди и изглед")} icon="gift" variant="secondary" disabled={busy} onPress={() => router.push("/rewards")} />
        {message ? <Text accessibilityLiveRegion="polite" style={{ color: colors.ink }}>{message}</Text> : null}
        <View style={{ gap: 12 }}>
          <RevealSection active={section === "earn"} style={{ gap: 12 }}>
          <Button title={t("Ways to earn", "Како да добиете поени")} variant="secondary" icon={section === "earn" ? "chevron-up" : "chevron-down"} onPress={() => setSection(section === "earn" ? null : "earn")} />
          {section === "earn" ? <View style={{ gap: 12 }}>
            {(Object.keys(REWARD_POINTS) as RewardKind[]).map((kind) => <View key={kind} style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
              <Text style={{ flex: 1, color: colors.ink, fontSize: 14 }}>{labels[kind]}</Text>
              <Text style={{ color: colors.accentText, fontWeight: "700", fontSize: 16 }}>+{REWARD_POINTS[kind]}</Text>
            </View>)}
            <Note>{t("Details: once per parking. Availability: once per parking each day.", "Детали: еднаш по паркинг. Достапност: еднаш по паркинг дневно.")}</Note>
          </View> : null}
          </RevealSection>
          <RevealSection active={section === "history"} style={{ gap: 12 }}>
          <Button title={t("Recent contributions", "Последни придонеси")} variant="secondary" icon={section === "history" ? "chevron-up" : "chevron-down"} onPress={() => setSection(section === "history" ? null : "history")} />
          {section === "history" ? <View style={{ gap: 12 }}>
            {failed ? <Button title={t("Retry", "Обиди се повторно")} variant="secondary" onPress={() => { setFailed(false); void reload().catch(() => setFailed(true)); }} /> : rewards?.events.length ? rewards.events.map((event) => <View key={event.id} style={{ flexDirection: "row", gap: 12, borderBottomWidth: 1, borderColor: colors.line, paddingBottom: 10 }}>
              <View style={{ flex: 1, gap: 3 }}><Text style={{ color: colors.ink }}>{labels[event.kind]}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>{new Date(event.createdAt).toLocaleDateString()}</Text></View>
              <Text style={{ color: colors.accentText, fontWeight: "700" }}>+{event.points}</Text>
            </View>) : rewards ? <Note>{t("No contributions yet", "Сè уште нема придонеси")}</Note> : <LoadingIndicator inline label={t("Loading contributions…", "Се вчитуваат придонесите…")} />}
          </View> : null}
          </RevealSection>
        </View>
        {account.profile?.secured ? <Button title={t("Sign out", "Одјави се")} icon="log-out" variant="secondary" disabled={busy} onPress={() => void logout()} /> : null}
        <Button title={t("Privacy & delete account", "Приватност и бришење профил")} variant="secondary" disabled={busy} onPress={() => router.push("/privacy")} />
      </FormScrollView>
    </KeyboardAvoidingView>
  </Page>;
}
