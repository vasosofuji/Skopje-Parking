import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text } from "react-native";
import Constants from "expo-constants";
import { openURL } from "expo-linking";
import { useTheme } from "../state/ThemeContext";
import { useTranslate } from "../state/ParkingContext";

// OpenStreetMap data needs visible credit. Like MapLibre's compact attribution, it is shown when the
// map opens, then folds into an ⓘ button that expands it again. Kept above the drawer.
/** `active`: the map is on screen (not behind onboarding or another page); only then does the credit fold. */
export default function MapCredit({ active = true }: { active?: boolean }) {
  const { colors } = useTheme(), t = useTranslate();
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!open || !active) return;
    const timer = setTimeout(() => setOpen(false), 6000);
    return () => clearTimeout(timer);
  }, [open, active]);
  if (Platform.OS !== "web" && !(Platform.OS === "android" && !Constants.expoConfig?.extra?.androidNativeMapsEnabled)) return null;
  if (!open) return (
    <Pressable accessibilityRole="button" accessibilityLabel={t("Map data credits", "Заслуги за податоците на мапата")} hitSlop={12} onPress={() => setOpen(true)}
      style={[s.info, { backgroundColor: colors.paper }]}><Text style={[s.infoText, { color: colors.muted }]}>ⓘ</Text></Pressable>
  );
  return (
    <Text
      style={[s.credit, { color: colors.muted, backgroundColor: colors.paper }]}
    ><Text accessibilityRole="link" onPress={() => void openURL("https://www.openstreetmap.org/copyright")}>© OpenStreetMap</Text>{" · "}<Text accessibilityRole="link" onPress={() => void openURL("https://openmaptiles.org/")}>© OpenMapTiles</Text>{" · "}<Text accessibilityRole="link" onPress={() => void openURL("https://openfreemap.org/")}>OpenFreeMap</Text></Text>
  );
}
const s = StyleSheet.create({
  credit: { position: "absolute", bottom: 2, right: 6, zIndex: 1200, fontSize: 10, lineHeight: 14, paddingHorizontal: 3, borderRadius: 3 },
  info: { position: "absolute", bottom: 2, right: 6, zIndex: 1200, width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", opacity: 0.85 },
  infoText: { fontSize: 13, lineHeight: 16 },
});
