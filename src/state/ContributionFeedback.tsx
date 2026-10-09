import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useParking } from "./ParkingContext";
import { useTheme } from "./ThemeContext";

type Feedback = { visible: boolean; thankYou: () => void; dismiss: () => void };
const Context = createContext<Feedback | null>(null);

export function ContributionFeedbackProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setVisible(false);
  }, []);
  const thankYou = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setVisible(true);
    timer.current = setTimeout(dismiss, 3200);
  }, [dismiss]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const value = useMemo(() => ({ visible, thankYou, dismiss }), [visible, thankYou, dismiss]);
  return <Context.Provider value={value}><View style={{ flex: 1 }}>{children}<ContributionNotice /></View></Context.Provider>;
}

export function useContributionFeedback() {
  const feedback = useContext(Context);
  if (!feedback) throw new Error("Contribution feedback provider is missing");
  return feedback;
}

/** Also rendered inside an existing Sheet so native dialogs don't cover feedback. */
export function ContributionNotice() {
  const feedback = useContext(Context), { colors } = useTheme(), { t } = useParking(), insets = useSafeAreaInsets();
  if (!feedback?.visible) return null;
  return <View pointerEvents="box-none" style={{ position: "absolute", top: Math.max(12, insets.top + 8), left: 18, right: 18, zIndex: 9999, elevation: 30, alignItems: "center" }}>
    <Pressable accessibilityRole="button" accessibilityLabel={t("Thank you!", "Ви благодариме!")} accessibilityHint={t("Close", "Затвори")} accessibilityLiveRegion="polite" onPress={feedback.dismiss}
      style={{ minHeight: 48, maxWidth: 420, width: "100%", borderRadius: 14, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: colors.green, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, boxShadow: "0 4px 16px #10292130" }}>
      <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700", flex: 1 }}>✓ {t("Thank you!", "Ви благодариме!")}</Text><Text style={{ color: "#fff", fontSize: 20 }}>×</Text>
    </Pressable>
  </View>;
}
