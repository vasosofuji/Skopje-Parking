import { useTheme, type ThemeColors } from "../state/ThemeContext";
import React, { useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import Page from "../components/Page";
import { Button, Note, Sheet } from "../components/ui";
import { useParking } from "../state/ParkingContext";
import { api } from "../services/api";
import { useAccount } from "../state/AccountContext";
export default function Privacy() {
  const account = useAccount();
  const { colors } = useTheme();
  const s = styles(colors);
  const { t, connected, refresh } = useParking();
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false);
  async function remove() {
    setBusy(true);
    const clearDeletedAccount = account.captureClear();
    try {
      await api.deleteSession();
      await clearDeletedAccount();
      setConfirmDelete(false);
      await refresh();
      setMessage(
        t(
          "Your account, points, reports and confirmations were deleted.",
          "Вашиот профил, поени, пријави и потврди се избришани.",
        ),
      );
    } catch {
      setMessage(
        t(
          "Could not delete. Connect and try again.",
          "Неуспешно бришење. Поврзете се и обидете се повторно.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page title={t("Privacy", "Приватност")}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.content}
      >
        <Text style={s.title}>{t("Location", "Локација")}</Text>
        <Note>
          {t(
            "GPS finds nearby parking and can ask a quick question after about 10 seconds of accurate, stationary readings. Optional background reminders use location even when the app is minimized; your phone controls delivery timing, and force-closing can stop them. Pending arrival locations and reminders stay on this device and are cleared when you turn reminders off or sign out. A submitted report’s parking ID and time are stored locally per account to prevent repeated questions for six hours. Adding a parking place shares its coordinates; an availability report shares the parking ID. Address searches, maps and navigation use their providers’ services.",
            "GPS наоѓа блиски паркинзи и може да постави кратко прашање по околу 10 секунди прецизни, неподвижни мерења. Потсетниците во заднина се по избор и користат локација и кога апликацијата е минимизирана; телефонот го одредува времето на испорака, а присилното затворање може да ги запре. Локациите и потсетниците за пристигнување што чекаат остануваат на уредот и се бришат кога ги исклучувате потсетниците или се одјавувате. Идентификаторот на паркингот и времето на испратената пријава се зачувуваат локално за секоја сметка за да се избегнат повторени прашања во текот на шест часа. Додавањето паркинг ги споделува неговите координати; пријавата го споделува идентификаторот на паркингот. Пребарувањето, мапите и навигацијата користат услуги од нивните провајдери.",
          )}
        </Note>
        <Note>
          {t(
            "Sign photos are read on your phone and never uploaded; each photo is deleted after you check it. Only the sign details you confirm and the zones you draw are shared, and they are public. Text is read with Google ML Kit, which sends Google diagnostic data such as device model, app version and performance. If you add your own Google Gemini or Groq API key, a sign photo you read is sent from your phone directly to that provider, under your account and its terms. Your key stays in this phone's secure storage and is never sent to Parkino.",
            "Сликите од табли се читаат на вашиот телефон и никогаш не се испраќаат; секоја слика се брише откако ќе ја проверите. Се споделуваат само потврдените податоци од таблата и нацртаните зони, и тие се јавни. Текстот се чита со Google ML Kit, кој на Google му праќа дијагностички податоци, како модел на уредот, верзија на апликацијата и перформанси. Ако додадете свој Google Gemini или Groq API клуч, сликата што ја читате се испраќа директно од телефонот до тој провајдер, под ваш профил и неговите услови. Клучот останува во безбедната меморија на телефонот и никогаш не се испраќа до Parkino.",
          )}
        </Note>
        <Text style={s.subhead}>{t("What is saved", "Што се зачувува")}</Text>
        <Note>
          {t(
            "Your optional license plate is saved only on this device and cleared when you sign out. SMS parking opens your messaging app with the parking operator’s number and message, taken from Gradski Parking’s or POC’s published rules; you choose whether to send it. Your mobile operator may charge for the message and parking. Wait for the parking operator’s confirmation. A reminder before a zone’s time limit is scheduled only on this device, if you allow notifications.",
            "Регистарската табличка е по избор, се зачувува само на овој уред и се брише при одјавување. СМС-плаќањето ја отвора апликацијата за пораки со бројот и пораката на паркинг-операторот, од објавените правила на Градски паркинг или ПОЦ; вие одлучувате дали да ја испратите. Мобилниот оператор може да наплати за пораката и паркирањето. Почекајте потврда од паркинг-операторот. Потсетникот пред истекот на дозволеното време се закажува само на овој уред, ако дозволите известувања.",
          )}
        </Note>
        <Note>
          {t(
            "The server stores your username, a salted password hash if you set a password, hashed sign-in tokens, contribution points and history, parking reports, confirmed sign details, prices, coordinates, boundaries and confirmations. Your password is never stored as plain text. Price reports and location confirmations are displayed for 90 days. Shared parking details and confirmation counts are public. Do not include names, registration plates or other personal information in notes. Availability reports expire after 15 minutes.",
            "Серверот зачувува корисничко име, безбедно хеширана лозинка ако ја поставите, хеширани токени за најава, поени и историја на придонеси, пријави, потврдени податоци од табли, цени, координати, граници и потврди. Лозинката не се чува како обичен текст. Цените и потврдите се прикажуваат 90 дена. Деталите за паркинзи и бројот на потврди се јавни. Не внесувајте имиња, регистарски таблички или лични податоци. Пријавите за достапност истекуваат по 15 минути.",
          )}
        </Note>
        <Text style={s.subhead}>
          {t("Delete contributor data", "Избриши кориснички податоци")}
        </Text>
        <Note>
          {t(
            "Deleting removes your username, password, all sign-in sessions, points, sign details, zone-label edits, price and availability reports and confirmations. Published parking locations and boundaries remain on the shared map. To keep your account and use it later, sign out from Your account instead.",
            "Бришењето ги отстранува името, лозинката, сите сесии, поените, податоците од табли, измените на ознаки, пријавите и потврдите. Објавените паркинзи и граници остануваат на заедничката мапа. За да го зачувате профилот за подоцна, одјавете се преку Вашиот профил.",
          )}
        </Note>
        {/* Above the button: after deletion the button disables and this is the only feedback. */}
        {message ? <Note>{message}</Note> : null}
        <Button
          title={
            busy
              ? t("Deleting…", "Се брише…")
              : t("Delete my contributor data", "Избриши ги моите податоци")
          }
          variant="danger"
          disabled={busy || !connected || !account.profile}
          onPress={() => setConfirmDelete(true)}
        />
      </ScrollView>
      <Sheet visible={confirmDelete} title={t("Delete your account?", "Да се избрише профилот?")} onClose={() => { if (!busy) setConfirmDelete(false); }}>
        <Note>{t("Your username, points and private account data will be permanently removed. You cannot sign back in to this account after deletion.", "Вашето име, поени и приватни податоци трајно ќе се избришат. По бришењето нема да можете повторно да се најавите на овој профил.")}</Note>
        <Button title={busy ? t("Deleting…", "Се брише…") : t("Delete account permanently", "Трајно избриши профил")} variant="danger" disabled={busy} onPress={() => void remove()} />
        <Button title={t("Keep my account", "Задржи го профилот")} variant="secondary" disabled={busy} onPress={() => setConfirmDelete(false)} />
      </Sheet>
    </Page>
  );
}
const styles = (colors: ThemeColors) =>
  StyleSheet.create({
    content: {
      padding: 24,
      gap: 20,
      maxWidth: 720,
      width: "100%",
      alignSelf: "center",
    },
    title: { fontSize: 30, color: colors.ink, fontWeight: "800" },
    subhead: { fontSize: 19, color: colors.ink, fontWeight: "700" },
  });
