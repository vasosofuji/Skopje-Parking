import React from "react";
import { Image, Pressable, Text, View } from "react-native";
import { LANGUAGES } from "../domain/language";
import { useParking } from "../state/ParkingContext";
import { useTheme } from "../state/ThemeContext";
import { Icon } from "./ui";
// Bundled flags work offline and render on Windows/web as well as phones.
const flags = {
  gb: require("../../assets/flags/gb.png"),
  mk: require("../../assets/flags/mk.png"),
  tr: require("../../assets/flags/tr.png"),
  al: require("../../assets/flags/al.png"),
};
export default function LanguagePicker() {
  const { t, language, setLanguage } = useParking(),
    { colors } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t("Language", "Јазик")} style={{ gap: 12 }}>
      {LANGUAGES.map(({ code, name, englishName, flag }) => {
        const selected = language === code;
        return <Pressable key={code} accessibilityRole="radio" accessibilityLabel={name}
          accessibilityState={{ checked: selected }} aria-checked={selected} onPress={() => setLanguage(code)}
          style={({ pressed }) => ({ minHeight: 76, paddingHorizontal: 18, paddingVertical: 14,
            flexDirection: "row", alignItems: "center", gap: 16, borderRadius: 12, borderWidth: 1,
            borderColor: selected ? colors.accentText : colors.line,
            backgroundColor: selected || pressed ? colors.mint : colors.input, opacity: pressed ? 0.8 : 1 })}>
          <Image source={flags[flag]} accessible={false} style={{ width: 32, height: 24, borderRadius: 3 }} resizeMode="contain" />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: selected ? colors.accentText : colors.ink, fontSize: 17, fontWeight: "600" }}>{name}</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>{englishName}</Text>
          </View>
          <View accessible={false} style={{ width: 22 }}>{selected ? <Icon name="check" size={20} color={colors.accentText} /> : null}</View>
        </Pressable>;
      })}
    </View>
  );
}
