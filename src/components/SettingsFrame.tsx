import React, { useCallback } from "react";
import { BackHandler, KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { useTheme } from "../state/ThemeContext";
import { useParking } from "../state/ParkingContext";
import { FormScrollView, IconButton } from "./ui";

/** A persistent router screen, so pushing a settings page never removes its background. */
export default function SettingsFrame({ title, onBack, onClose, backLabel, children }: {
  title: string; onBack: () => void; onClose: () => void; backLabel: string; children: React.ReactNode;
}) {
  const { colors } = useTheme(), { t } = useParking();
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { onBack(); return true; });
    return () => subscription.remove();
  }, [onBack]));
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }}>
    <View style={{ padding: 12, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderColor: colors.line }}>
      <View style={{ width: 44 }}><IconButton name="arrow-left" label={backLabel} onPress={onBack} /></View>
      <Text accessibilityRole="header" style={{ flex: 1, textAlign: "center", color: colors.ink, fontSize: 18, fontWeight: "700" }}>{title}</Text>
      <View style={{ width: 44, alignItems: "center" }}><IconButton name="x" label={t("Close", "Затвори")} onPress={onClose} /></View>
    </View>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <FormScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ width: "100%", maxWidth: 680, alignSelf: "center", padding: 16, paddingBottom: 28, gap: 20 }}>{children}</FormScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
