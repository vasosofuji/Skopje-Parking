import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Page from "../components/Page";
import { Button, Icon, Note } from "../components/ui";
import { useAccount } from "../state/AccountContext";
import { useParking } from "../state/ParkingContext";
import { lightColors, useTheme } from "../state/ThemeContext";
import { api } from "../services/api";
import { ACCENT_POINTS, PALETTE_POINTS, PALETTE_COLORS, accentColor, eligibleCosmetics, type ContributionAccent, type CosmeticsUpdate, type Palette } from "../domain/cosmetics";

export default function RewardsScreen() {
  const { profile, refresh } = useAccount(), parking = useParking();
  const { t } = parking, { colors } = useTheme();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const points = profile?.points ?? 0;
  const selected = eligibleCosmetics(points, profile?.cosmetics?.palette, profile?.cosmetics?.accent);
  useEffect(() => { void refresh().catch(() => {}); }, [refresh]);
  const paletteNames: Record<Palette, string> = { default: t("Classic", "Класичен"), ocean: t("Ocean", "Океан"), plum: t("Plum", "Слива") };
  const accentNames: Record<ContributionAccent, string> = { default: t("Classic", "Класичен"), gold: t("Gold", "Златен"), violet: t("Violet", "Виолетов") };
  async function choose(update: CosmeticsUpdate) {
    if (busy) return;
    setBusy(true); setMessage("");
    let saved = false;
    try {
      await api.cosmetics(update); saved = true;
      await Promise.all([refresh(), parking.refresh()]);
      setMessage(t("Appearance saved", "Изгледот е зачуван"));
    } catch (error) {
      setMessage(saved ? t("Saved. Reopen Rewards to refresh your appearance.", "Зачувано. Отворете Награди повторно за освежување.") : error instanceof Error ? error.message : t("Could not save. Try again.", "Неуспешно зачувување. Обидете се повторно."));
    } finally { setBusy(false); }
  }
  function tile(key: string, title: string, required: number, active: boolean, update: CosmeticsUpdate, preview: React.ReactNode) {
    const remaining = Math.max(0, required - points), unlocked = remaining === 0;
    const state = active ? t("Selected", "Избрано") : unlocked ? t("Use", "Примени") : t("{n} points to go", "Уште {n} поени").replace("{n}", String(remaining));
    return <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${title}. ${state}`} accessibilityState={{ selected: active, disabled: busy || !unlocked || active }} disabled={busy || !unlocked || active} onPress={() => void choose(update)} style={({ pressed }) => ({ flex: 1, minWidth: 140, gap: 10, padding: 14, borderRadius: 16, borderWidth: active ? 2 : 1, borderColor: active ? colors.green : colors.line, backgroundColor: colors.input, opacity: pressed ? 0.8 : 1 })}>
      {preview}
      <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>{title}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name={active ? "check-circle" : unlocked ? "unlock" : "lock"} size={15} color={colors.muted} />
        <Text style={{ flex: 1, color: colors.muted, fontSize: 13 }}>{state}</Text>
      </View>
      {!unlocked ? <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: required, now: points }} style={{ height: 4, borderRadius: 2, backgroundColor: colors.line, overflow: "hidden" }}><View style={{ width: `${Math.min(100, points / required * 100)}%`, height: 4, backgroundColor: colors.green }} /></View> : null}
    </Pressable>;
  }
  return <Page title={t("Rewards", "Награди")}>
    <ScrollView contentContainerStyle={{ padding: 24, gap: 22, maxWidth: 620, width: "100%", alignSelf: "center" }}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.ink, fontSize: 38, fontWeight: "800" }}>{points} <Text style={{ fontSize: 18 }}>{t("points earned", "освоени поени")}</Text></Text>
        <Note>{t("Help drivers. Unlock a little more color. Your points are never spent.", "Помогнете им на возачите. Отклучете повеќе бои. Поените не се трошат.")}</Note>
      </View>
      <View style={{ gap: 12 }}>
        <Text style={{ color: colors.ink, fontSize: 21, fontWeight: "700" }}>{t("App palette", "Бои на апликацијата")}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {(Object.keys(PALETTE_POINTS) as Palette[]).map(palette => {
            const preview = palette === "default" ? lightColors : PALETTE_COLORS[palette].light;
            return tile(palette, paletteNames[palette], PALETTE_POINTS[palette], selected.palette === palette, { palette }, <View style={{ height: 58, borderRadius: 10, padding: 10, gap: 6, backgroundColor: preview.paper, borderWidth: 1, borderColor: preview.line }}><View style={{ width: "70%", height: 6, backgroundColor: preview.ink, borderRadius: 3 }} /><View style={{ flexDirection: "row", gap: 5 }}><View style={{ width: 40, height: 20, backgroundColor: preview.green, borderRadius: 5 }} /><View style={{ flex: 1, height: 20, backgroundColor: preview.mint, borderRadius: 5 }} /></View></View>);
          })}
        </View>
      </View>
      <View style={{ gap: 12 }}>
        <Text style={{ color: colors.ink, fontSize: 21, fontWeight: "700" }}>{t("Your parking pins", "Вашите паркинг ознаки")}</Text>
        <Note>{t("An accent on parking places you added. Green still means spaces; red still means full.", "Боја на паркинзите што ги додадовте. Зелено значи слободно, црвено значи полно.")}</Note>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {(Object.keys(ACCENT_POINTS) as ContributionAccent[]).map(accent => tile(accent, accentNames[accent], ACCENT_POINTS[accent], selected.accent === accent, { accent }, <View style={{ height: 58, flexDirection: "row", gap: 14, justifyContent: "center", alignItems: "center", backgroundColor: colors.mint, borderRadius: 10 }}>
            {["#087958", "#B83A36"].map((fill, index) => <View key={fill} style={{ borderRadius: 20, borderWidth: 3, borderColor: accentColor(accent) ?? "#fff", backgroundColor: fill, minWidth: 34, height: 34, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#fff", fontWeight: "800", fontSize: 12 }}>{index ? "P" : "P ✓"}</Text></View>)}
          </View>))}
        </View>
      </View>
      {message ? <Text accessibilityLiveRegion="polite" style={{ color: colors.ink }}>{message}</Text> : null}
      <Button title={busy ? t("Saving…", "Се зачувува…") : t("Restore classic appearance", "Врати класичен изглед")} variant="secondary" disabled={busy || selected.palette === "default" && selected.accent === "default"} onPress={() => void choose({ palette: "default", accent: "default" })} />
      {profile?.guest ? <Note>{t("Create an account in your profile to keep your rewards when you change phones.", "Создајте профил за да ги зачувате наградите кога менувате телефон.")}</Note> : null}
    </ScrollView>
  </Page>;
}
