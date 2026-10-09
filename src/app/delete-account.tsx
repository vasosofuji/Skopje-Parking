import React from "react";
import { ScrollView, Text } from "react-native";
import { router } from "expo-router";
import Page from "../components/Page";
import { Button, Note } from "../components/ui";
import { useParking } from "../state/ParkingContext";
import { useTheme } from "../state/ThemeContext";
import { useAccount } from "../state/AccountContext";

/** Public page for Google Play's account-deletion URL; works without the app installed. */
export default function DeleteAccount() {
  const { t } = useParking(), { colors } = useTheme(), { profile } = useAccount();
  return (
    <Page title={t("Delete your Parkino account", "Избришете го Parkino профилот")}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 18, maxWidth: 720, width: "100%", alignSelf: "center" }}>
        <Text style={{ color: colors.ink, fontSize: 19, fontWeight: "700" }}>{t("In the app", "Во апликацијата")}</Text>
        <Note>{t("Open Settings → Privacy & data → Delete my contributor data, then confirm. Deletion happens immediately.", "Отворете Поставки → Приватност и податоци → Избриши ги моите податоци и потврдете. Бришењето е веднаш.")}</Note>
        <Text style={{ color: colors.ink, fontSize: 19, fontWeight: "700" }}>{t("Without the app", "Без апликацијата")}</Text>
        <Note>{t("On this website, sign in with your username and password, then open Privacy & data and delete. Guest accounts have no password or personal details; delete them from the app on the phone that created them.", "На оваа страница најавете се со корисничко име и лозинка, па отворете Приватност и податоци и избришете. Гостинските профили немаат лозинка ниту лични податоци; избришете ги од апликацијата на телефонот што ги создал.")}</Note>
        <Text style={{ color: colors.ink, fontSize: 19, fontWeight: "700" }}>{t("What is deleted", "Што се брише")}</Text>
        <Note>{t("Your username, password, sign-in sessions, points, uploaded sign photos, zone-label edits, price and availability reports and confirmations. Parking locations and boundaries you published stay on the shared map without your name. Your licence plate and AI key were only ever stored on your phone.", "Корисничкото име, лозинката, сесиите за најава, поените, прикачените слики од табли, измените на ознаки, пријавите за цени и достапност и потврдите. Објавените паркинзи и граници остануваат на мапата без вашето име. Регистарската табличка и AI клучот се чуваа само на вашиот телефон.")}</Note>
        <Button title={profile ? t("Open Privacy & data", "Отвори Приватност и податоци") : t("Sign in", "Најави се")} onPress={() => router.push(profile ? "/privacy" : "/welcome")} />
      </ScrollView>
    </Page>
  );
}
