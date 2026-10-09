import React from "react";
import { ScrollView, Text } from "react-native";
import Page from "../components/Page";
import { useParking } from "../state/ParkingContext";
import { useTheme } from "../state/ThemeContext";
import { TERMS_VERSION } from "../domain/account";
import { termsParagraphs } from "../domain/terms";
export default function Terms() {
  const { t } = useParking(),
    { colors } = useTheme();
  const paragraphs = termsParagraphs(t);
  return (
    <Page title={t("Terms of Service", "Услови за користење")}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          padding: 20,
          gap: 16,
          maxWidth: 640,
          alignSelf: "center",
        }}
      >
        <Text style={{ color: colors.muted }}>
          {t("Version", "Верзија")} · {TERMS_VERSION}
        </Text>
        {paragraphs.map((p, i) => (
          <Text
            key={i}
            style={{ color: colors.ink, fontSize: 14, lineHeight: 21 }}
          >
            {p}
          </Text>
        ))}
      </ScrollView>
    </Page>
  );
}
