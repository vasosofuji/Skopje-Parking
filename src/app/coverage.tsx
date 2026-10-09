import { useTheme, type ThemeColors } from "../state/ThemeContext";
import React, { useState } from "react";
import {
  FlatList,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import Page from "../components/Page";
import { Button, Note } from "../components/ui";
import { useParking } from "../state/ParkingContext";
import { searchText } from "../domain/parking";
export default function Coverage() {
  const { colors } = useTheme();
  const s = styles(colors);
  const { catalog, t } = useParking();
  const [query, setQuery] = useState("");
  const inventory = catalog.zones.filter((z) =>
    searchText(`${z.code} ${z.name}`).includes(searchText(query)),
  );
  return (
    <Page title={t("Data & coverage", "Податоци и покриеност")}>
      <FlatList
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        data={inventory}
        keyExtractor={(z) => z.code}
        contentContainerStyle={s.content}
        ListHeaderComponent={
          <View style={s.intro}>
            <Text style={s.headline}>
              {t("Parking zones & sources", "Паркинг зони и извори")}
            </Text>
            <View style={s.stats}>
              <View style={s.stat}>
                <Text style={s.number}>
                  {catalog.places.filter((p) => p.kind !== "zone").length}
                </Text>
                <Note>{t("parking features", "паркинг локации")}</Note>
              </View>
              <View style={s.stat}>
                <Text style={s.number}>
                  {
                    catalog.places.filter(
                      (p) => p.kind === "zone" && p.geometry,
                    ).length
                  }
                </Text>
                <Note>{t("mapped zone boundaries", "означени граници")}</Note>
              </View>
              <View style={s.stat}>
                <Text style={s.number}>{catalog.zones.length}</Text>
                <Note>
                  {t("named parking zones", "именувани паркинг зони")}
                </Note>
              </View>
            </View>
            <Note>
              {t(
                "Coverage is incomplete. OpenStreetMap includes public, customer, restricted and unknown-access parking. POC polygons mark tariff sectors, not individual legal spaces.",
                "Покриеноста е нецелосна. OpenStreetMap содржи јавни, клиентски, ограничени и паркинзи со непознат пристап. ПОЦ полигоните означуваат тарифни сектори, а не поединечни легални места.",
              )}
            </Note>
            <Note>
              {t(
                "Published tariffs and driver price reports are shown separately. Check signs for charging hours and restrictions. Distances are straight-line, not walking routes.",
                "Објавените тарифи и цените од возачи се прикажуваат одделно. Проверете ги таблите за време на наплата и ограничувања. Растојанијата се воздушни, а не пешачки рути.",
              )}
            </Note>
            <Note>
              {t("Snapshot", "Преземено")}: {catalog.generatedAt.slice(0, 10)}
            </Note>
            <Button
              title="OpenStreetMap contributors · ODbL"
              variant="secondary"
              icon="external-link"
              onPress={() =>
                void Linking.openURL("https://www.openstreetmap.org/copyright")
              }
            />
            <Button
              title={t(
                "Official POC map and prices",
                "Официјална ПОЦ мапа и цени",
              )}
              variant="secondary"
              icon="external-link"
              onPress={() => void Linking.openURL("https://poc.mk/")}
            />
            <Button
              title={t(
                "Official city parking tariffs",
                "Официјални градски тарифи",
              )}
              variant="secondary"
              icon="external-link"
              onPress={() =>
                void Linking.openURL(
                  "https://www.gradskiparking.com.mk/javni-parkiralishta-i-zonsko.nspx",
                )
              }
            />
            <Button
              title={t(
                "Privacy & contributor data",
                "Приватност и кориснички податоци",
              )}
              variant="secondary"
              onPress={() => router.push("/privacy")}
            />
            <Text style={s.sectionTitle}>
              {t("SMS payment rules", "Правила за SMS плаќање")}
            </Text>
            <Note>
              {t(
                "Parkino is an independent community app, not affiliated with the City of Skopje, JP Gradski Parking or JP Parkinzi na Opshtina Centar. SMS numbers and messages follow the operators’ published instructions, checked on 8 October 2026: Gradski Parking zones 144144 with “ZONE PLATE”, ended with S; POC zones 141414 with “zone PLATE hours”. Paying hours follow Gradski Parking’s published timetables; Sundays and public holidays are free except at Sredno Vodno. The sign at your car always takes priority.",
                "Parkino е независна апликација на заедницата, не е поврзана со Град Скопје, ЈП Градски паркинг или ЈП Паркинзи на Општина Центар. SMS броевите и пораките ги следат објавените упатства на операторите, проверени на 8 октомври 2026: зоните на Градски паркинг 144144 со „ЗОНА ТАБЛИЧКА“, крај со S; зоните на ПОЦ 141414 со „зона ТАБЛИЧКА часови“. Часовите за плаќање ги следат објавените распореди на Градски паркинг; неделите и државните празници се бесплатни, освен на Средно Водно. Знакот покрај возилото секогаш има предност.",
              )}
            </Note>
            <Text style={s.sectionTitle}>
              {t("Published sign-code inventory", "Објавен список на кодови")}
            </Text>
            <Note>
              {t(
                "Gradski zones include A0, B2 and Karpoš’s D40, D42 and D62. Thirty labels use the operator’s map coordinates; the others use street or landmark references. These points do not define boundaries. A02 has no map position; A42 is unverified.",
                "Градските зони вклучуваат A0, B2 и D40, D42 и D62 во Карпош. Триесет ознаки користат координати од операторот; другите користат улици или објекти. Овие точки не се граници. A02 нема позиција на мапата; A42 е непотврдена.",
              )}
            </Note>
            <TextInput
              accessibilityLabel={t("Search sign codes", "Пребарај кодови")}
              value={query}
              onChangeText={setQuery}
              placeholder={t(
                "Search C9, B2, street…",
                "Пребарај C9, B2, улица…",
              )}
              style={s.input}
            />
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.row}>
            <Text style={s.code}>{item.code}</Text>
            <View style={s.rowMain}>
              <Text style={s.name}>{item.name}</Text>
              <Note>
                {t(
                  "Exact geometry awaiting survey",
                  "Точната геометрија чека проверка",
                )}
              </Note>
              <Note>
                {item.tariff.maxStayMinutes
                  ? `${item.tariff.maxStayMinutes / 60} ${t("hour limit", "часа ограничување")}`
                  : t(
                      "No published duration limit",
                      "Без објавено временско ограничување",
                    )}
              </Note>
            </View>
            <Text style={s.price}>
              {item.tariff.firstHour}
              {item.tariff.firstHour !== item.tariff.nextHour
                ? ` / ${item.tariff.nextHour}`
                : ""}
              <Text style={s.unit}>
                {"\n"}
                {t("MKD/hour", "ден./час")}
              </Text>
            </Text>
          </View>
        )}
      />
    </Page>
  );
}
const styles = (colors: ThemeColors) =>
  StyleSheet.create({
    content: { padding: 24, maxWidth: 800, width: "100%", alignSelf: "center" },
    intro: { gap: 16, marginBottom: 18 },
    headline: {
      fontSize: 32,
      color: colors.ink,
      fontWeight: "800",
      letterSpacing: -1,
    },
    stats: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
    stat: {
      flex: 1,
      minWidth: 95,
      padding: 16,
      backgroundColor: colors.mint,
      borderRadius: 15,
      gap: 8,
    },
    number: { fontSize: 32, color: colors.accentText, fontWeight: "800" },
    sectionTitle: {
      color: colors.ink,
      fontSize: 21,
      fontWeight: "800",
      marginTop: 18,
    },
    input: {
      padding: 14,
      minHeight: 48,
      fontSize: 16,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.line,
      color: colors.ink,
    },
    row: {
      flexDirection: "row",
      gap: 12,
      paddingVertical: 18,
      borderBottomWidth: 1,
      borderColor: colors.line,
    },
    code: { width: 46, color: colors.accentText, fontSize: 16, fontWeight: "800" },
    rowMain: { flex: 1, gap: 5 },
    name: { color: colors.ink, fontSize: 14, fontWeight: "700" },
    price: {
      color: colors.ink,
      fontSize: 18,
      fontWeight: "800",
      textAlign: "right",
    },
    unit: { fontSize: 10, fontWeight: "400", color: colors.muted },
  });
