import React, { useEffect, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import LoadingIndicator from "../components/LoadingIndicator";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Icon } from "../components/ui";
import StepActions from "../components/StepActions";
import LanguagePicker from "../components/LanguagePicker";
import TermsConsent from "../components/TermsConsent";
import PasswordField from "../components/PasswordField";
import { useAccount } from "../state/AccountContext";
import { useTheme } from "../state/ThemeContext";
import { useParking } from "../state/ParkingContext";
import { cleanUsername, validUsername, validPassword } from "../domain/account";
import { completeOnboarding, initialOnboardingStep, PREFERENCES_SETUP_KEY, type OnboardingIntent, type OnboardingStep } from "../domain/onboarding";
import { api } from "../services/api";

export default function Welcome() {
  const { colors, mode: theme, setMode: setTheme } = useTheme();
  const { t } = useParking();
  const account = useAccount();
  const [step, setStep] = useState<OnboardingStep | null>(null);
  const [mode, setMode] = useState<"choice" | "create" | "login">("choice");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [intent, setIntent] = useState<OnboardingIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const accepting = useRef(false);
  const [error, setError] = useState("");
  const [availability, setAvailability] = useState<"idle" | "checking" | "available" | "taken" | "offline">("idle");
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(PREFERENCES_SETUP_KEY).then((saved) => {
      if (active) setStep(initialOnboardingStep(saved));
    }).catch(() => { if (active) setStep("language"); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    if (step !== "account" || mode !== "create" || !validUsername(username)) return;
    const timer = setTimeout(() => {
      void api.usernameAvailable(cleanUsername(username)).then((result) => {
        if (active) setAvailability(result.available ? "available" : "taken");
      }).catch(() => { if (active) setAvailability("offline"); });
    }, 500);
    return () => { active = false; clearTimeout(timer); };
  }, [username, mode, step]);

  function showTerms(next: OnboardingIntent) {
    Keyboard.dismiss();
    setError("");
    setIntent(next);
  }
  async function signIn() {
    if (accepting.current) return;
    accepting.current = true;
    Keyboard.dismiss();
    setBusy(true); setError("");
    try {
      await completeOnboarding({ mode: "login", username, password }, false, account);
      setPassword("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("Could not sign in. Try again.", "Неуспешна најава. Обидете се повторно."));
    } finally { accepting.current = false; setBusy(false); }
  }
  async function accept() {
    if (!intent || accepting.current) return;
    accepting.current = true;
    setBusy(true); setError("");
    try {
      await completeOnboarding(intent, true, account);
      setPassword("");
      setIntent(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not continue. Try again.", "Не може да продолжите. Обидете се повторно."));
    } finally { accepting.current = false; setBusy(false); }
  }
  function chooseAccount(next: "create" | "login") {
    setMode(next); setError(""); setAvailability("idle"); setPassword("");
  }
  function finishPreferences() {
    void AsyncStorage.setItem(PREFERENCES_SETUP_KEY, "1").catch(() => {});
    setStep("account");
  }
  const title = step === "language" ? t("Select language", "Изберете јазик") : step === "theme" ? t("Choose your appearance", "Изберете изглед") : mode === "choice" ? t("Welcome to Skopje Parking", "Добредојдовте во Skopje Parking") : mode === "create" ? t("Create account", "Создај профил") : t("Sign in", "Најава");
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, padding: 24, maxWidth: 440, width: "100%", alignSelf: "center" }}>
        <View style={{ flex: 1, justifyContent: "center", gap: 24, paddingVertical: 28 }}>
          {!step ? <LoadingIndicator size="large" label="Skopje Parking" /> : <>
            <Text style={{ color: colors.muted, fontSize: 13 }}>{step === "language" ? "1 / 4" : step === "theme" ? "2 / 4" : "3 / 4"}</Text>
            <View style={{ gap: 12, alignItems: step === "language" ? "center" : "stretch" }}>
              {step === "language" ? <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.mint, alignItems: "center", justifyContent: "center", marginBottom: 6 }}><Icon name="globe" size={28} color={colors.accentText} /></View> : null}
              <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 30, fontWeight: "700", textAlign: step === "language" ? "center" : "left" }}>{title}</Text>
            </View>
            {step === "language" ? <>
              <LanguagePicker />
            </> : step === "theme" ? <>
              <View style={{ gap: 10 }}>
                {(["system", "light", "dark"] as const).map((value) => <Button key={value} icon={theme === value ? "check" : value === "system" ? "smartphone" : value === "light" ? "sun" : "moon"} title={value === "system" ? t("System default", "Системски стандард") : value === "light" ? t("Light", "Светло") : t("Dark", "Темно")} variant={theme === value ? "primary" : "secondary"} onPress={() => setTheme(value)} />)}
              </View>
            </> : mode === "choice" ? <>
              <Button title={t("Create account", "Создај профил")} onPress={() => chooseAccount("create")} />
              <Button title={t("Sign in", "Најави се")} variant="secondary" onPress={() => chooseAccount("login")} />
            </> : <>
              <View style={{ gap: 8 }}>
                <TextInput accessibilityLabel={t("Username", "Корисничко име")} value={username} editable={!busy} onChangeText={(value) => { setUsername(value); setAvailability(validUsername(value) ? "checking" : "idle"); setError(""); }} autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username" maxLength={20} placeholder={t("Username", "Корисничко име")} placeholderTextColor={colors.muted} style={{ minHeight: 52, padding: 14, fontSize: 17, borderRadius: 12, borderWidth: 1, borderColor: colors.line, color: colors.ink, backgroundColor: colors.input }} />
                {mode === "create" ? <Text accessibilityLiveRegion="polite" style={{ color: availability === "taken" ? colors.red : colors.muted, fontSize: 12 }}>{availability === "taken" ? t("Username taken", "Зафатено име") : availability === "checking" ? t("Checking…", "Се проверува…") : availability === "available" ? t("Available", "Слободно") : t("3-20 letters, numbers or underscores", "3-20 букви, бројки или долни црти")}</Text> : null}
              </View>
              <View style={{ gap: 8 }}>
                <PasswordField value={password} onChange={setPassword} creating={mode === "create"} disabled={busy} />
                {mode === "create" ? <Text style={{ color: colors.muted, fontSize: 12 }}>{t("At least 10 characters", "Најмалку 10 знаци")}</Text> : null}
              </View>
              {!intent && error ? <Text accessibilityLiveRegion="polite" style={{ color: colors.red }}>{error}</Text> : null}
            </>}
          </>}
        </View>
      </ScrollView>
      {step ? <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16, maxWidth: 440, width: "100%", alignSelf: "center", borderTopWidth: 1, borderTopColor: colors.line }}>
        <StepActions
          onBack={step === "language" ? undefined : step === "theme" ? () => setStep("language") : mode === "choice" ? () => setStep("theme") : () => { setMode("choice"); setPassword(""); }}
          onContinue={step === "language" ? () => setStep("theme") : step === "theme" ? finishPreferences : mode === "choice" ? () => showTerms({ mode: "guest" }) : mode === "login" ? () => void signIn() : () => showTerms({ mode, username, password })}
          title={step === "account" && mode === "choice" ? t("Continue as guest", "Продолжи како гостин") : undefined}
          disabled={busy || (step === "account" && mode !== "choice" && (!validUsername(username) || (mode === "create" ? !validPassword(password) || availability === "taken" : !password)))}
          backDisabled={busy}
        />
      </View> : null}
    </KeyboardAvoidingView>
    {intent ? <TermsConsent busy={busy} error={error} onClose={() => { setIntent(null); setError(""); }} onAccept={() => void accept()} /> : null}
  </SafeAreaView>;
}
