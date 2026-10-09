import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { placeName } from "../domain/language";
import { AppState, Linking, Pressable, Text, View } from "react-native";
import type { Coordinate, ParkingPlace } from "../domain/types";
import { api } from "../services/api";
import { openSmsComposer } from "../services/smsComposer";
import { cancelParkingLimitReminder, scheduleParkingLimitReminder } from "../services/parkingReminder";
import { useLicensePlate } from "../state/LicensePlateContext";
import { useParking } from "../state/ParkingContext";
import { useTheme } from "../state/ThemeContext";
import { Button, Icon, Note, Sheet } from "./ui";
import LicensePlateEditor from "./LicensePlateEditor";
import { isOfficialProtocol, isVerifiedSmsPayment } from "../domain/sms-payment";
import { parkingPrice } from "../domain/parking";
import { OPERATOR_HELP, officialChargingHours, officialZoneRules, skopjeTime } from "../domain/skopje-rules";
import { knownFreeTime, payableZones } from "../domain/zone-payment";

export function smsMessage(template: string, zone: string, plate: string, hours: number | null) {
  return template.replaceAll("{zone}", zone).replaceAll("{plate}", plate).replaceAll("{hours}", String(hours));
}
function ZoneOutline({ place }: { place: ParkingPlace }) {
  const { colors } = useTheme();
  const ring = place.geometry?.coordinates[0] ?? [];
  if (ring.length < 4) return null;
  const xs = ring.map(point => point[0]), ys = ring.map(point => point[1]);
  const left = Math.min(...xs), top = Math.max(...ys), scale = Math.min(200 / (Math.max(...xs) - left || 1), 90 / (top - Math.min(...ys) || 1));
  return <View accessibilityLabel={place.name} style={{ width: 220, height: 110, alignSelf: "center", backgroundColor: colors.mint, borderRadius: 10 }}>
    {ring.slice(0, -1).map((point, i) => {
      const x = 10 + (point[0] - left) * scale, y = 10 + (top - point[1]) * scale;
      const dx = (ring[i + 1][0] - point[0]) * scale, dy = (point[1] - ring[i + 1][1]) * scale, width = Math.hypot(dx, dy);
      return <View key={i} style={{ position: "absolute", left: x + dx / 2 - width / 2, top: y + dy / 2 - 1, height: 2, width, backgroundColor: colors.green, transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }] }} />;
    })}
  </View>;
}
function useOperatorName() {
  const { t } = useParking();
  return (operator: "gradski" | "poc" | undefined) => operator === "gradski" ? t("Gradski Parking (City of Skopje)", "Градски паркинг (Град Скопје)")
    : operator === "poc" ? t("POC – Centar municipality parking", "ПОЦ – Паркинзи на Општина Центар") : null;
}
/** Start/confirm one SMS payment. `manual` means the driver chose the zone instead of GPS dwell detection. */
export default function ZonePaymentSheet({ place, validate, onClose, onInvalidated = onClose, manual = false }: { place: ParkingPlace | null; validate: (id: string, places?: ParkingPlace[]) => ParkingPlace | null; onClose: () => void; onInvalidated?: () => void; manual?: boolean }) {
  const { t, now, language, latestCatalog } = useParking(), { colors } = useTheme(), account = useLicensePlate(), operatorName = useOperatorName();
  const latestAccount = useRef(account); useLayoutEffect(() => { latestAccount.current = account; });
  const invalidated = useRef(onInvalidated); useLayoutEffect(() => { invalidated.current = onInvalidated; });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [choice, setChoice] = useState<{ signature: string; hours: number } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [checked, setChecked] = useState<{ signature: string; place: ParkingPlace } | null>(null);
  const [checkAttempt, setCheckAttempt] = useState(0), [checkError, setCheckError] = useState("");
  const [signConfirmed, setSignConfirmed] = useState("");
  const protocol = place?.smsPayment, plate = account.savedPlate;
  const signature = protocol ? JSON.stringify(protocol) : "", accountId = account.accountId, placeId = place?.id;
  const hours = choice && choice.signature === signature ? choice.hours : null;
  const checkedPlace = checked && checked.signature === signature && checked.place.id === placeId ? checked.place : null;
  // The driver compares the zone with the sign at their car; GPS cannot tell two operators' streets apart.
  const confirmation = `${placeId}|${signature}|${plate}`, matchesSign = signConfirmed === confirmation;
  const duration = protocol?.mode === "fixed-hours" ? hours : null;
  const body = protocol && plate ? smsMessage(protocol.startTemplate, protocol.zoneCode, plate, duration) : "";
  const official = isOfficialProtocol(protocol);
  const operator = protocol?.photoId === "official:gradski" ? "gradski" : protocol?.photoId === "official:poc" ? "poc" : checkedPlace ? officialZoneRules(checkedPlace)?.operator : undefined;
  useEffect(() => {
    let active = true;
    if (!placeId || !signature) return;
    void Promise.all([latestCatalog(), api.smsPayment(placeId)]).then(([catalog, fresh]) => {
      if (!active) return;
      const places = catalog.places.map(value => value.id === placeId ? { ...fresh.place, smsPayment: fresh.protocol ?? undefined } : value);
      if (!validate(placeId, places) || JSON.stringify(fresh.protocol) !== signature) { invalidated.current(); return; }
      setChecked({ signature, place: { ...fresh.place, smsPayment: fresh.protocol! } }); setError("");
      setCheckError("");
    }).catch(cause => { if (active) setCheckError(cause instanceof Error ? cause.message : t("Could not check payment details. Try again.", "Податоците за плаќање не се проверени. Обидете се повторно.")); });
    return () => { active = false; };
  }, [placeId, signature, validate, checkAttempt, t, latestCatalog]);
  const ready = Boolean(checkedPlace && plate && matchesSign && (protocol?.mode !== "fixed-hours" || protocol.allowedHours?.includes(duration!)));
  async function open() {
    if (!ready || !checkedPlace || !place || !protocol || !plate || busy) return;
    setBusy(true); setError("");
    try {
      // Catalog overlap and immutable photo status both have to be current at send time.
      const [catalog, fresh] = await Promise.all([latestCatalog(), api.smsPayment(place.id)]);
      const places = catalog.places.map(value => value.id === place.id ? { ...fresh.place, smsPayment: fresh.protocol ?? undefined } : value);
      const valid = validate(place.id, places);
      if (!valid || JSON.stringify(fresh.protocol) !== signature) { invalidated.current(); return; }
      const stillValid = () => mounted.current && Boolean(validate(place.id)) && isVerifiedSmsPayment(fresh.protocol) && latestAccount.current.accountId === accountId && latestAccount.current.savedPlate === plate;
      const result = await openSmsComposer(protocol.destination, body, stillValid);
      if (result === "opened") {
        if (protocol.mode === "start-stop" && protocol.stopTemplate) {
          const openedAt = Date.now(), stopMessage = smsMessage(protocol.stopTemplate, protocol.zoneCode, plate, null);
          await account.setPendingStop({ zoneId: place.id, zoneName: place.name, recipient: protocol.destination, stopMessage, photoId: protocol.photoId, protocolExpiresAt: protocol.expiresAt, openedAt, plate });
          if (protocol.maxStayMinutes) {
            const end = skopjeTime(openedAt + protocol.maxStayMinutes * 60_000);
            const clock = `${String(Math.floor(end.minute / 60)).padStart(2, "0")}:${String(end.minute % 60).padStart(2, "0")}`;
            void scheduleParkingLimitReminder(openedAt + (protocol.maxStayMinutes - 15) * 60_000, t("Parking time limit", "Ограничување на паркирањето"),
              t("Parking time ends soon", "Времето за паркирање истекува наскоро"),
              t("Zone {zone} allows parking until {time}. Send {stop} to {number} when you leave.", "Зоната {zone} дозволува паркирање до {time}. Кога ќе заминете, испратете {stop} на {number}.")
                .replace("{zone}", protocol.zoneCode).replace("{time}", clock).replace("{stop}", stopMessage).replace("{number}", protocol.destination));
          }
        }
        onClose();
      } else if (result !== "cancelled") setError(t("SMS is unavailable here. Use the number and message shown.", "SMS не е достапна. Користете ги прикажаните број и порака."));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not open SMS. Try again.", "SMS не се отвори. Обидете се повторно.")); }
    finally { setBusy(false); }
  }
  const sign = checkedPlace?.signInfo;
  const price = checkedPlace ? parkingPrice(checkedPlace, now) : null;
  const chargingHours = sign?.chargingHours ?? checkedPlace?.paymentSchedule?.chargingHours ?? (checkedPlace ? officialChargingHours(checkedPlace, now) : null);
  const officialHoursNote = checkedPlace && !sign?.chargingHours && !checkedPlace.paymentSchedule?.chargingHours && operator === "gradski" && chargingHours
    ? checkedPlace.id === "gradski:zone:A0" ? t("Also on public holidays", "И на државни празници") : t("Free on Sundays and public holidays", "Бесплатно во недела и на државни празници") : null;
  const zoneLabel = checkedPlace?.zoneCode ?? protocol?.zoneCode ?? "";
  const help = operator ? OPERATOR_HELP[operator] : null;
  return <Sheet visible={Boolean(place && protocol && (plate || manual))} title={t("Pay for parking by SMS", "Платете паркинг со SMS")} onClose={onClose} footer={plate ? <Button title={busy || !checkedPlace ? t("Checking…", "Се проверува…") : t("Open SMS", "Отвори SMS")} disabled={busy || !ready} onPress={() => void open()} /> : undefined}>
    {!plate ? <>
      <Note>{t("Add your licence plate to pay by SMS. It stays on this device.", "Додајте ја регистарската табличка за плаќање со SMS. Се чува само на овој уред.")}</Note>
      <LicensePlateEditor key={account.accountId} onDone={() => {}} onCancel={onClose} />
    </> : checkedPlace ? <>
    <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "700" }}>{zoneLabel} · {placeName(checkedPlace, language)}</Text>
    {operator ? <Text style={{ color: colors.muted }}>{operatorName(operator)}</Text> : null}
    <ZoneOutline place={checkedPlace} />
    {price ? <>
      <Text style={{ color: colors.ink }}>{t("First hour", "Прв час")}: {price.firstHour} MKD</Text>
      <Text style={{ color: colors.ink }}>{t("Following hour", "Следен час")}: {price.nextHour} MKD</Text>
    </> : <Text style={{ color: colors.ink }}>{t("Price not shown", "Нема наведена цена")}</Text>}
    {protocol?.maxStayMinutes ? <Text style={{ color: colors.ink }}>{t("Maximum stay", "Максимален престој")}: {protocol.maxStayMinutes} {t("min", "мин")}</Text> : null}
    <Text style={{ color: colors.ink }}>{t("Paying hours", "Часови за плаќање")}: {chargingHours || t("Not on sign / unknown", "Нема на таблата / непознато")}{officialHoursNote ? ` · ${officialHoursNote}` : ""}</Text>
    {knownFreeTime(checkedPlace, now) ? <Note>{t("Parking here is free at this time. You do not need to pay now.", "Паркирањето овде е бесплатно во ова време. Не треба да платите сега.")}</Note> : null}
    {protocol?.mode === "fixed-hours" ? <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>{protocol.allowedHours?.map(value => <Button key={value} title={`${value} ${value === 1 ? t("Hour", "Час").toLocaleLowerCase() : t("hours", "часа")}`} variant={hours === value ? "primary" : "secondary"} onPress={() => setChoice({ signature, hours: value })} />)}</View> : null}
    <Text selectable style={{ color: colors.ink }}>{t("SMS number", "SMS број")}: {protocol?.destination}</Text>
    <Text selectable style={{ color: colors.ink, fontWeight: "700" }}>{protocol?.mode === "fixed-hours" && duration === null ? smsMessage(protocol.startTemplate.replace("{hours}", "…"), protocol.zoneCode, plate, null) : body}</Text>
    {protocol?.mode === "start-stop" && protocol.stopTemplate ? <Text selectable style={{ color: colors.ink }}>{t("When you leave, send", "Кога ќе заминете, испратете")}: {smsMessage(protocol.stopTemplate, protocol.zoneCode, plate, null)}</Text> : null}
    {official && protocol?.mode === "fixed-hours" ? <Note>{t("The operator texts you 10 minutes before your time ends. No SMS is needed when you leave.", "Операторот ве известува со SMS 10 минути пред истекот. Не треба SMS кога заминувате.")}</Note> : null}
    {official && help ? <View style={{ gap: 6 }}>
      <Note>{t("Payment rules published by the operator. Parkino is not affiliated with the operator, and the sign at your car always takes priority.", "Правила објавени од операторот. Parkino не е поврзан со операторот, а знакот покрај возилото секогаш има предност.")}</Note>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Button variant="secondary" icon="external-link" title={t("Operator website", "Веб-страница на операторот")} onPress={() => void Linking.openURL(help.url).catch(() => {})} />
        <Button variant="secondary" icon="phone" title={t("Call operator", "Јави се на операторот")} onPress={() => void Linking.openURL(`tel:${help.phone}`).catch(() => {})} />
      </View>
    </View> : null}
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: matchesSign }} aria-checked={matchesSign} onPress={() => setSignConfirmed(matchesSign ? "" : confirmation)}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: matchesSign ? colors.green : colors.line }}>
      <Icon name={matchesSign ? "check-square" : "square"} size={22} />
      <Text style={{ flex: 1, color: colors.ink, fontWeight: "600" }}>{t("The sign at my car shows zone {zone}", "Знакот покрај моето возило покажува зона {zone}").replace("{zone}", zoneLabel)}</Text>
    </Pressable>
    <Note>{t("Wait for the operator’s confirmation.", "Почекајте потврда од операторот.")}</Note>
    </> : checkError ? <>
      <Note>{checkError}</Note>
      <Button variant="secondary" title={t("Retry", "Обиди се повторно")} onPress={() => { setCheckError(""); setCheckAttempt(value => value + 1); }} />
    </> : <Note>{t("Checking…", "Се проверува…")}</Note>}
    {error ? <Note>{error}</Note> : null}
  </Sheet>;
}

/** Lists nearby SMS-payable zones so the driver can pick the one printed on the sign. */
export function PayParkingChooser({ visible, places, origin, onPick, onClose }: { visible: boolean; places: ParkingPlace[]; origin: Coordinate | null; onPick: (place: ParkingPlace) => void; onClose: () => void }) {
  const { t, language, now } = useParking(), { colors } = useTheme(), operatorName = useOperatorName();
  const rows = useMemo(() => visible && origin ? payableZones(places, origin, now) : [], [visible, places, origin, now]);
  return <Sheet visible={visible} title={t("Pay for parking by SMS", "Платете паркинг со SMS")} onClose={onClose}>
    <Note>{t("Choose the zone printed on the sign next to your car.", "Изберете ја зоната напишана на знакот покрај вашето возило.")}</Note>
    {rows.map(({ place, distance, inside }) => <Pressable key={place.id} accessibilityRole="button" onPress={() => onPick(place)}
      style={{ gap: 2, padding: 12, minHeight: 56, borderRadius: 12, borderWidth: 1, borderColor: inside ? colors.green : colors.line }}>
      <Text style={{ color: colors.ink, fontWeight: "700" }}>{place.zoneCode} · {placeName(place, language)}</Text>
      <Text style={{ color: colors.muted, fontSize: 13 }}>{[operatorName(officialZoneRules(place)?.operator), inside ? t("You are inside this zone", "Се наоѓате во оваа зона") : `${distance} m`].filter(Boolean).join(" · ")}</Text>
    </Pressable>)}
    {!rows.length ? <Note>{t("No zone with SMS payment nearby. Pay as the sign at your car says.", "Нема зона со SMS плаќање во близина. Платете според знакот покрај возилото.")}</Note> : null}
  </Sheet>;
}

export function ParkingSmsStopSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const account = useLicensePlate(), { t } = useParking(), { colors } = useTheme();
  const latest = useRef({ account, visible }); useLayoutEffect(() => { latest.current = { account, visible }; });
  const mounted = useRef(true); useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const session = account.pendingStop;
  async function stop() {
    if (!session || busy) return;
    setBusy(true); setError("");
    try {
      const fresh = await api.smsPayment(session.zoneId), protocol = fresh.protocol;
      const valid = () => Boolean(mounted.current && AppState.currentState === "active" && latest.current.visible && latest.current.account.accountId === account.accountId && latest.current.account.pendingStop === session && protocol && isVerifiedSmsPayment(protocol) && protocol.photoId === session.photoId && protocol.destination === session.recipient && protocol.mode === "start-stop" && protocol.stopTemplate && smsMessage(protocol.stopTemplate, protocol.zoneCode, session.plate, null) === session.stopMessage);
      if (!valid()) throw new Error(t("Parking details changed. Review them again.", "Податоците се сменети. Проверете ги повторно."));
      const result = await openSmsComposer(session.recipient, session.stopMessage, valid);
      if (result === "opened") { void cancelParkingLimitReminder(); onClose(); }
      else if (result !== "cancelled") setError(t("SMS is unavailable here. Use the number and message shown.", "SMS не е достапна. Користете ги прикажаните број и порака."));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not open SMS. Try again.", "SMS не се отвори. Обидете се повторно.")); }
    finally { setBusy(false); }
  }
  return <Sheet visible={visible && Boolean(session)} title={t("Parking SMS", "Паркинг SMS")} onClose={onClose} footer={<Button title={t("Open stop SMS", "Отвори SMS за крај")} disabled={busy} onPress={() => void stop()} />}>
    <Text style={{ color: colors.ink, fontWeight: "700" }}>{session?.zoneName}</Text>
    <Text style={{ color: colors.ink }}>{session?.plate}</Text>
    <Text selectable style={{ color: colors.ink }}>{t("SMS number", "SMS број")}: {session?.recipient}</Text>
    <Text selectable style={{ color: colors.ink }}>{session?.stopMessage}</Text>
    <Note>{t("Wait for the operator’s confirmation.", "Почекајте потврда од операторот.")}</Note>
    <Button variant="secondary" title={t("Dismiss reminder", "Отстрани потсетник")} disabled={busy} onPress={() => {
      setBusy(true);
      void account.clearPendingStop().then(() => { void cancelParkingLimitReminder(); onClose(); }).catch(() => setError(t("Could not save. Try again.", "Не е зачувано. Обидете се повторно."))).finally(() => setBusy(false));
    }} />
    {error ? <Note>{error}</Note> : null}
  </Sheet>;
}
