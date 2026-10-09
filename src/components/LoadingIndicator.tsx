import React, { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, AppState, Easing, Platform, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../state/ThemeContext";

/** A native-driven Skopje Parking mark. It stays still when motion is reduced or the app is hidden. */
export default function LoadingIndicator({ label = "Loading / Се вчитува", size = "medium", inline = false, active = true }: {
  label?: string; size?: "small" | "medium" | "large"; inline?: boolean; active?: boolean;
}) {
  const { colors } = useTheme();
  const [progress] = useState(() => new Animated.Value(0));
  const [reduceMotion, setReduceMotion] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  useEffect(() => {
    let mounted = true, motionChanged = false;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted && !motionChanged) setReduceMotion(value); }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", value => { motionChanged = true; setReduceMotion(value); });
    const app = AppState.addEventListener("change", state => setForeground(state === "active"));
    return () => { mounted = false; motion.remove(); app.remove(); };
  }, []);
  useEffect(() => {
    progress.setValue(0);
    if (!active || !foreground || reduceMotion) return;
    const loop = Animated.loop(Animated.timing(progress, { toValue: 1, duration: 1500, easing: Easing.linear, useNativeDriver: Platform.OS !== "web", isInteraction: false }));
    loop.start();
    return () => { loop.stop(); progress.stopAnimation(); };
  }, [active, foreground, progress, reduceMotion]);
  const diameter = size === "small" ? 28 : size === "large" ? 80 : 46;
  const mark = diameter * 0.56;
  return <View accessible accessibilityRole="progressbar" accessibilityLabel={label || "Loading / Се вчитува"} accessibilityState={{ busy: active }} style={[styles.root, inline && styles.inline]}>
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: diameter, height: diameter, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: mark, height: mark, borderRadius: mark * 0.24, alignItems: "center", justifyContent: "center", backgroundColor: colors.mint }}><Text allowFontScaling={false} style={{ color: colors.accentText, fontSize: mark * 0.73, fontWeight: "800", lineHeight: mark * 0.88 }}>P</Text></View>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: diameter / 2, borderWidth: size === "small" ? 1 : 1.5, borderColor: colors.line, transform: [{ rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] }]}>
        <View style={{ position: "absolute", width: diameter * 0.14, height: diameter * 0.14, borderRadius: diameter, backgroundColor: colors.accentText, top: -diameter * 0.07, left: diameter * 0.43 }} />
      </Animated.View>
    </View>
    {label ? <Text style={{ color: colors.muted, fontSize: size === "large" ? 15 : 13, lineHeight: 20, textAlign: inline ? "left" : "center", flexShrink: 1 }}>{label}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({ root: { gap: 12, alignItems: "center", justifyContent: "center", paddingVertical: 8 }, inline: { flexDirection: "row", gap: 10, paddingVertical: 0 } });
