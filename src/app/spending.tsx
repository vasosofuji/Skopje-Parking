import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import Page from "../components/Page";
import LoadingIndicator from "../components/LoadingIndicator";
import { Button, IconButton, Note, Sheet } from "../components/ui";
import { LOCALES } from "../domain/language";
import { sessionCost, type ParkingSession } from "../domain/parking-sessions";
import { sessionMinutes, sessionZoneLabel, spendingSummary, type SpendingTotal } from "../domain/spending";
import { clearParkingSessions, listParkingSessions, onParkingSessionsChanged, removeParkingSession } from "../services/parkingSessions";
import { useParking } from "../state/ParkingContext";
import { useTheme } from "../state/ThemeContext";

export default function SpendingScreen() {
  const { t, language, now } = useParking(), { colors } = useTheme();
  const [sessions, setSessions] = useState<ParkingSession[] | null>(null), [confirmClear, setConfirmClear] = useState(false), [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    const load = () => listParkingSessions().then(value => { if (active) setSessions(value); }, () => { if (active) setSessions([]); });
    void load();
    const stop = onParkingSessionsChanged(() => void load());
    return () => { active = false; stop(); };
  }, []);
  const locale = LOCALES[language], summary = spendingSummary(sessions ?? [], now);
  const mkd = (value: number) => `${value.toLocaleString(locale)} ${t("MKD", "ден.")}`;
  const month = (key: string) => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5)) - 1, 15));
  const when = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Skopje" });
  const duration = (minutes: number) => [Math.floor(minutes / 60) ? t("{hours} h", "{hours} ч").replace("{hours}", String(Math.floor(minutes / 60))) : "", minutes % 60 || minutes < 60 ? t("{minutes} min", "{minutes} мин").replace("{minutes}", String(minutes % 60)) : ""].filter(Boolean).join(" ");
  const unknown = (row: SpendingTotal) => row.unknown ? ` · ${t("{count} without a price", "{count} без цена").replace("{count}", String(row.unknown))}` : "";
  const card = { backgroundColor: colors.input, borderRadius: 20, borderWidth: 1, borderColor: colors.line, overflow: "hidden" as const };
  const header = (title: string) => <Text accessibilityRole="header" style={{ paddingHorizontal: 5, fontSize: 13, fontWeight: "700", color: colors.muted }}>{title}</Text>;
  const row = (key: string, title: string, detail: string, amount: string, index: number, action?: React.ReactNode) => <View key={key} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 60, paddingVertical: 10, paddingLeft: 18, paddingRight: action ? 8 : 18, borderTopWidth: index ? 1 : 0, borderColor: colors.line }}>
    <View style={{ flex: 1, gap: 3 }}>
      <Text numberOfLines={2} style={{ color: colors.ink, fontSize: 15, fontWeight: "500" }}>{title}</Text>
      {detail ? <Text style={{ color: colors.muted, fontSize: 12 }}>{detail}</Text> : null}
    </View>
    <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "600" }}>{amount}</Text>
    {action}
  </View>;
  const total = (row: SpendingTotal) => row.count && row.unknown === row.count ? t("Price unknown", "Непозната цена") : mkd(row.total);
  const payments = (row: SpendingTotal) => t("Payments: {count}", "Плаќања: {count}").replace("{count}", String(row.count)) + unknown(row);
  async function run(work: () => Promise<void>) {
    setMessage("");
    try { await work(); } catch { setMessage(t("Could not delete. Try again.", "Не е избришано. Обидете се повторно.")); }
  }
  return <Page title={t("Parking spending", "Трошоци за паркирање")}>
    <ScrollView contentContainerStyle={{ width: "100%", maxWidth: 680, alignSelf: "center", padding: 16, paddingBottom: 28, gap: 14 }}>
      {!sessions ? <LoadingIndicator inline label={t("Loading payments…", "Се вчитуваат плаќањата…")} /> : <>
        <View style={[card, { padding: 18, gap: 4 }]}>
          <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "700" }}>{t("This month, estimated", "Овој месец, проценка")}</Text>
          <Text style={{ color: colors.ink, fontSize: 30, fontWeight: "800" }}>{total(summary.thisMonth)}</Text>
          <Text style={{ color: colors.muted, fontSize: 13 }}>{payments(summary.thisMonth)}</Text>
        </View>
        <Note>{t("Estimated from payments started in Skopje Parking, using the price shown when you paid. The app cannot see whether an SMS was sent or what the operator charged. Kept only on this phone and cleared when you sign out.", "Проценето од плаќањата започнати во Skopje Parking, според цената прикажана при плаќање. Апликацијата не може да види дали SMS пораката е испратена ниту колку наплатил операторот. Се чува само на овој телефон и се брише кога ќе се одјавите.")}</Note>
        {summary.previousMonths.length ? <>{header(t("Previous months", "Претходни месеци"))}<View style={card}>{summary.previousMonths.map((value, index) => row(value.key, month(value.key), payments(value), total(value), index))}</View></> : null}
        {summary.zones.length ? <>{header(t("By zone", "По зона"))}<View style={card}>{summary.zones.map((value, index) => row(value.key, value.label, payments(value), total(value), index))}</View></> : null}
        {sessions.length ? <>
          {header(t("Recent payments", "Последни плаќања"))}
          <View style={card}>{sessions.slice(-50).reverse().map((session, index) => {
            const cost = sessionCost(session, now);
            return row(session.id, sessionZoneLabel(session), `${when.format(session.startedAt)} · ${duration(sessionMinutes(session, now))}`, cost === null ? t("Price unknown", "Непозната цена") : mkd(cost), index,
              <IconButton name="trash-2" compact label={`${t("Delete payment", "Избриши плаќање")}: ${sessionZoneLabel(session)}, ${when.format(session.startedAt)}`} onPress={() => void run(() => removeParkingSession(session.id))} />);
          })}</View>
          <Button title={t("Clear all", "Избриши сè")} icon="trash-2" variant="danger" onPress={() => setConfirmClear(true)} />
        </> : <Note>{t("No payments yet. Payments you start from the map appear here.", "Сè уште нема плаќања. Плаќањата што ги започнувате од мапата се појавуваат тука.")}</Note>}
        {message ? <Text accessibilityLiveRegion="polite" style={{ color: colors.red }}>{message}</Text> : null}
      </>}
    </ScrollView>
    <Sheet visible={confirmClear} title={t("Clear all payments?", "Да се избришат сите плаќања?")} onClose={() => setConfirmClear(false)}>
      <Note>{t("This deletes the spending log on this phone. It does not stop or cancel any parking.", "Ова го брише дневникот на трошоци на овој телефон. Не запира и не откажува паркирање.")}</Note>
      <Button title={t("Clear all", "Избриши сè")} variant="danger" onPress={() => { setConfirmClear(false); void run(clearParkingSessions); }} />
      <Button title={t("Cancel", "Откажи")} variant="secondary" onPress={() => setConfirmClear(false)} />
    </Sheet>
  </Page>;
}
