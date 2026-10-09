import React from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ParkingProvider } from "../state/ParkingContext";
import { ThemeProvider, useTheme } from "../state/ThemeContext";
import { AccountProvider, useAccount } from "../state/AccountContext";
import { View } from "react-native";
import LoadingIndicator from "../components/LoadingIndicator";
import { useNavigationReady } from "../services/navigation";
import { ModalBackgroundProvider } from "../components/ModalBackdrop";
import AppStyles from "../components/AppStyles";
import { useArrivalNotifications } from "../hooks/useArrivalNotifications";
import { hasCurrentTerms } from "../domain/onboarding";
import { ContributionFeedbackProvider } from "../state/ContributionFeedback";
import { SettingsLocationProvider } from "../state/SettingsLocationContext";
import { LicensePlateProvider } from "../state/LicensePlateContext";
import LicensePlatePrompt from "../components/LicensePlatePrompt";
function Navigator() {
  const navigationReady = useNavigationReady();
  const { dark, colors } = useTheme();
  const { profile, ready } = useAccount();
  const accepted = hasCurrentTerms(profile);
  useArrivalNotifications(ready && navigationReady && accepted);
  if (!ready || !navigationReady)
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.paper,
        }}
      >
        <LoadingIndicator size="large" label="Skopje Parking" />
      </View>
    );
  return (
    <ParkingProvider>
      <ContributionFeedbackProvider>
      <SettingsLocationProvider>
      <LicensePlateProvider>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.paper },
        }}
      >
        <Stack.Protected guard={accepted}>
          <Stack.Screen name="index" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="coverage" />
          <Stack.Screen name="community" />
          <Stack.Screen name="account" />
          <Stack.Screen name="rewards" />
        </Stack.Protected>
        <Stack.Protected guard={Boolean(profile) && !accepted}>
          <Stack.Screen name="consent" />
        </Stack.Protected>
        <Stack.Protected guard={!profile}>
          <Stack.Screen name="welcome" />
        </Stack.Protected>
        <Stack.Screen name="terms" />
        <Stack.Screen name="privacy" />
        <Stack.Screen name="delete-account" />
      </Stack>
      <LicensePlatePrompt />
      </LicensePlateProvider>
      </SettingsLocationProvider>
      </ContributionFeedbackProvider>
    </ParkingProvider>
  );
}
export default function Layout() {
  return (
    <AccountProvider>
      <ThemeProvider>
        <AppStyles />
        <ModalBackgroundProvider><Navigator /></ModalBackgroundProvider>
      </ThemeProvider>
    </AccountProvider>
  );
}
