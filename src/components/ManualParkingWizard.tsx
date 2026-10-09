import React, { useEffect, useRef, useState } from "react";
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { Button, Icon, Note, useSheetBack, useSheetContinue, useSheetReveal } from "./ui";
import PaymentScheduleFields from "./PaymentScheduleFields";
import LoadingIndicator from "./LoadingIndicator";
import { useParking } from "../state/ParkingContext";
import { useAccount } from "../state/AccountContext";
import { useTheme, type ThemeColors } from "../state/ThemeContext";
import { normalizeZoneCode, parkingPrice } from "../domain/parking";
import { createProgressiveEntry, manualPriceInput, manualSpacesInput, priceInput, incompleteManualStep, type EntryApi } from "../domain/progressive-entry";
import { validZone } from "../domain/geometry";
import type { Coordinate, Geometry, ParkingKind, ParkingPlace, PaymentSchedule } from "../domain/types";
import { createEntryDraftStore, entryDraftKey, readEntryDraft, type EntryDraft, type EntryOperation, type EntryStep } from "../services/entryDrafts";
import { api } from "../services/api";
import { useContributionFeedback } from "../state/ContributionFeedback";
import { usePriceCheck } from "../hooks/usePriceCheck";

type Props = {
  place?: ParkingPlace; existingPlaceId?: string; coordinate: Coordinate;
  /** Stable draft identity for a new parking, so creating it mid-entry does not restart the wizard. */
  entryKey?: string; geometry?: Geometry; returnedGeometry?: Geometry; initialZone?: string; kind?: ParkingKind;
  initialStep?: "spaces";
  onSaved?: (id: string) => void; onDone: () => void; onDrawBoundary?: (geometry?: Geometry) => void; onBack?: () => void;
};
export default function ManualParkingWizard(props: Props) {
  const { profile } = useAccount(), { t } = useParking();
  const accountId = profile?.id ?? "signed-out";
  const target = props.entryKey ?? props.place?.id ?? props.existingPlaceId ?? `${props.kind ?? "surface"}:${props.coordinate.latitude.toFixed(6)}:${props.coordinate.longitude.toFixed(6)}`;
  const draftKey = entryDraftKey(accountId, target);
  const [loaded, setLoaded] = useState<{ key: string; value: EntryDraft | null } | null>(null);
  useEffect(() => { let active = true; void readEntryDraft(draftKey).then(value => { if (active) setLoaded({ key: draftKey, value }); }); return () => { active = false; }; }, [draftKey]);
  if (!loaded || loaded.key !== draftKey) return <View style={{ minHeight: 188, justifyContent: "center" }}><LoadingIndicator label={t("Opening entry…", "Се отвора внесот…")} /></View>;
  return <WizardBody key={draftKey} {...props} restored={loaded.value} draftKey={draftKey} accountId={accountId} />;
}
function WizardBody({ place, existingPlaceId, coordinate, geometry, returnedGeometry, initialZone, kind = "surface", initialStep, onSaved, onDone, onDrawBoundary, onBack, restored, draftKey, accountId }: Props & { restored: EntryDraft | null; draftKey: string; accountId: string }) {
  const { t, refresh } = useParking(), { colors } = useTheme(), s = styles(colors);
  const { thankYou } = useContributionFeedback();
  const checkPrice = usePriceCheck(t);
  const initialPrice = place ? parkingPrice(place) : null;
  const [step, setStep] = useState<EntryStep>(restored?.detailed && restored.step !== "choose" ? "details" : restored?.step ?? (initialStep ? "details" : "choose")), [detailed, setDetailed] = useState(restored?.detailed ?? Boolean(initialStep));
  const [expanded, setExpanded] = useState<EntryStep | null>(null);
  const [finishingDetails, setFinishingDetails] = useState(false);
  const [code, setCode] = useState(restored?.code ?? initialZone ?? place?.zoneCode ?? "");
  const [first, setFirst] = useState(restored?.first ?? initialPrice?.firstHour.toString() ?? ""), [next, setNext] = useState(restored?.next ?? initialPrice?.nextHour.toString() ?? "");
  const [capacity, setCapacity] = useState(restored?.capacity ?? place?.capacity?.toString() ?? "");
  const [schedule, setSchedule] = useState<PaymentSchedule>({ chargingHours: restored?.chargingHours !== undefined ? restored.chargingHours : place?.paymentSchedule ? place.paymentSchedule.chargingHours : place?.signInfo?.chargingHours ?? null, freeWeekends: restored?.freeWeekends !== undefined ? restored.freeWeekends : place?.paymentSchedule ? place.paymentSchedule.freeWeekends : place?.signInfo?.freeWeekends ?? null });
  const [saving, setBusy] = useState(false), [saved, setSaved] = useState(Boolean(restored?.snapshot?.id)), [message, setMessage] = useState("");
  const busy = saving || finishingDetails;
  const [failed, setFailed] = useState<EntryOperation | null>(restored?.pending ?? null);
  const [currentGeometry, setCurrentGeometry] = useState(returnedGeometry ?? restored?.geometry ?? geometry);
  const [initialDraft] = useState<EntryDraft>(() => restored ?? { version: 1, updatedAt: Date.now(), requestId: randomUUID(), step: "choose", detailed: false, code, first, next, capacity, freeSpaces: "", geometry, pending: null });
  const [draftStore] = useState(() => createEntryDraftStore(accountId, draftKey, initialDraft));
  const [writer] = useState(() => {
    const client = api.progressiveWriter();
    void client.catch(() => {});
    const bound: EntryApi = {
      contribute: value => client.then(service => service.contribute(value)),
      label: (id, value) => client.then(service => service.label(id, value)),
      price: (id, a, b) => client.then(service => service.price(id, a, b)),
      paymentSchedule: (id, value) => client.then(service => service.paymentSchedule(id, value)),
      capacity: (id, value) => client.then(service => service.capacity(id, value)),
      report: (id, status, count) => client.then(service => service.report(id, status, count)),
      boundary: (id, value) => client.then(service => service.boundary(id, value)),
    };
    return createProgressiveEntry(bound, {
      place, placeId: existingPlaceId, onSaved, snapshot: restored?.snapshot,
      contribution: place || existingPlaceId ? undefined : { requestId: initialDraft.requestId, name: kind === "zone" ? t("Parking zone", "Паркинг зона") : t("Parking", "Паркинг"), coordinate, kind, geometry: currentGeometry, zoneCode: initialZone ?? null, firstHour: null, nextHour: null },
    });
  });
  // Android unmounts Modal children while drawing. Compare the returned map
  // boundary with the stored draft on remount so it is still saved immediately.
  const previousGeometry = useRef(JSON.stringify(returnedGeometry ? restored?.geometry ?? geometry : geometry));
  // Draft writes merge with save results, so typing in the next step cannot erase an in-flight operation.
  useEffect(() => { void draftStore.update({ step, detailed, code, first, next, capacity, chargingHours: schedule.chargingHours ?? "", freeWeekends: schedule.freeWeekends, geometry: currentGeometry }).catch(() => {}); }, [draftStore, step, detailed, code, first, next, capacity, schedule, currentGeometry]);
  async function save(operation: EntryOperation, nextStep?: EntryStep) {
    Keyboard.dismiss(); setMessage(""); setBusy(true); setFailed(null);
    if (nextStep) setStep(nextStep);
    try {
      // Persist intent before starting the network write. Retry is explicit after reopening.
      await draftStore.update({ pending: operation, step: nextStep ?? step });
      if (operation.type === "label") await writer.label(operation.code);
      else if (operation.type === "price") await writer.price(operation.first, operation.next);
      else if (operation.type === "schedule") await writer.paymentSchedule(operation.value);
      else if (operation.type === "spaces") await writer.spaces(operation.total, null);
      else if (operation.type === "boundary") await writer.boundary(operation.geometry);
      else await writer.ensure();
      await draftStore.update({ snapshot: writer.snapshot(), pending: null });
      setSaved(true); void refresh();
      return true;
    } catch (error) {
      await draftStore.update({ snapshot: writer.snapshot(), pending: operation }).catch(() => {});
      setFailed(operation);
      setMessage(error instanceof Error ? error.message : t("Could not save. Try again.", "Не е зачувано. Обидете се повторно."));
      return false;
    } finally { setBusy(false); }
  }
  useEffect(() => {
    const nextGeometry = returnedGeometry ?? geometry, signature = JSON.stringify(nextGeometry);
    if (nextGeometry && signature !== previousGeometry.current) {
      previousGeometry.current = signature; setCurrentGeometry(nextGeometry);
      void save({ type: "boundary", geometry: nextGeometry });
    }
    // New map geometry only arrives when a completed boundary returns to the mounted wizard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, returnedGeometry]);
  async function finish() {
    if (busy || failed) return;
    const incomplete = incompleteManualStep(writer.snapshot(), { detailed, zone: kind === "zone", afterSign: Boolean(initialStep), geometry: currentGeometry, existingGeometry: place?.geometry });
    if (incomplete) {
      setStep(incomplete);
      setMessage(incomplete === "price" ? t("Enter a price or choose It's free.", "Внесете цена или изберете Бесплатно е.") : incomplete === "spaces" ? t("Enter the total number of parking spaces.", "Внесете го вкупниот број паркинг места.") : t("Draw the perimeter to finish the detailed entry.", "Означете го периметарот за да го завршите деталниот внес."));
      return;
    }
    if (detailed && currentGeometry && writer.snapshot().boundary !== JSON.stringify(currentGeometry) && !await save({ type: "boundary", geometry: currentGeometry })) return;
    await draftStore.clear().catch(() => {}); if (writer.snapshot().contributed) thankYou(); onDone();
  }
  async function finishDetails() {
    if (busy) return;
    // Validate every entered section before writing anything; blank sections stay unknown.
    const operations: EntryOperation[] = [];
    let section: EntryStep = "zone";
    try {
      const normalized = normalizeZoneCode(code);
      if (normalized) operations.push({ type: "label", code: normalized });
      section = "price";
      const price = priceInput(first, next);
      if (price && !checkPrice([price.first, price.next], (warning: string) => { setExpanded("price"); setMessage(warning); })) return;
      if (price) operations.push({ type: "price", ...price });
      section = "schedule";
      const chargingHours = schedule.chargingHours?.trim() || null;
      if (chargingHours || schedule.freeWeekends !== null || writer.snapshot().schedule) operations.push({ type: "schedule", value: { chargingHours, freeWeekends: schedule.freeWeekends } });
      section = "spaces";
      if (kind !== "zone" && capacity.trim()) operations.push({ type: "spaces", ...manualSpacesInput(capacity) });
      section = "perimeter";
      if (currentGeometry) {
        const unchanged = place?.geometry && JSON.stringify(place.geometry) === JSON.stringify(currentGeometry);
        if (!unchanged && !validZone(currentGeometry)) throw new Error("boundary");
        operations.push({ type: "boundary", geometry: currentGeometry });
      }
    } catch {
      setExpanded(section);
      setMessage(section === "price" ? t("Enter a first-hour price from 0 to 10,000 MKD, or choose It's free.", "Внесете цена за прв час од 0 до 10.000 денари или изберете Бесплатно е.") : section === "spaces" ? t("Enter a whole number from 0 to 100,000.", "Внесете цел број од 0 до 100.000.") : t("Draw the perimeter again.", "Означете го периметарот повторно."));
      return;
    }
    setFinishingDetails(true);
    try {
      if (!operations.length) operations.push({ type: "ensure" });
      for (const operation of operations) if (!await save(operation)) return;
      await draftStore.clear().catch(() => {});
      if (writer.snapshot().contributed) thankYou();
      onDone();
    } finally { setFinishingDetails(false); }
  }
  function back() {
    if (busy) return;
    if (step === "details") {
      if (expanded) { setExpanded(null); return; }
      setFailed(null); setMessage("");
      if (initialStep) onBack?.(); else setStep("choose");
      return;
    }
    if (step === "choose") { onBack?.(); return; }
    if (initialStep === "spaces" && step === "schedule" && !failed) { onBack?.(); return; }
    const previous: EntryStep = failed?.type === "label" ? "zone" : failed?.type === "price" ? "price" : failed?.type === "schedule" ? "schedule" : failed?.type === "spaces" ? "spaces" : failed?.type === "boundary" ? "perimeter" : step === "price" ? "zone" : step === "schedule" ? "price" : step === "spaces" ? "schedule" : step === "perimeter" ? kind === "zone" ? "schedule" : "spaces" : step === "done" ? detailed ? "perimeter" : "price" : "choose";
    setFailed(null); setMessage(""); setStep(previous);
    void draftStore.update({ pending: null, step: previous }).catch(() => {});
  }
  useSheetBack({ onPress: back, disabled: busy, label: failed ? t("Correct this step", "Поправи го чекорот") : t("Back", "Назад") });
  function advance(skip = false) {
    if (busy || failed) return;
    if (step === "zone") {
      void save({ type: "label", code: skip ? "" : normalizeZoneCode(code) }, "price");
    } else if (step === "price") {
      try {
        const value = manualPriceInput(first, next);
        if (checkPrice([value.first, value.next], setMessage)) void save({ type: "price", ...value }, detailed ? "schedule" : "done");
      } catch { setMessage(t("Enter a first-hour price from 0 to 10,000 MKD, or choose It's free.", "Внесете цена за прв час од 0 до 10.000 денари или изберете Бесплатно е.")); }
    } else if (step === "schedule") {
      void save({ type: "schedule", value: { ...schedule, chargingHours: schedule.chargingHours?.trim() || null } }, kind === "zone" ? "perimeter" : "spaces");
    } else if (step === "spaces") {
      try {
        const value = manualSpacesInput(capacity);
        void save({ type: "spaces", ...value }, "perimeter");
      } catch { setMessage(t("Enter a whole number from 0 to 100,000.", "Внесете цел број од 0 до 100.000.")); }
    }
  }
  const field = (label: string, value: string, change: (value: string) => void, numeric = false, placeholder = t("Optional", "Опционално"), showLabel = true) => <View style={s.field}>
    {showLabel ? <Text style={s.label}>{label}</Text> : null}<TextInput accessibilityLabel={label} value={value} onChangeText={change} editable={!busy} style={s.input} keyboardType={numeric ? "decimal-pad" : "default"} autoCapitalize={numeric ? "none" : "characters"} maxLength={numeric ? 9 : 16} placeholder={placeholder} placeholderTextColor={colors.muted} />
  </View>;
  const ordered: EntryStep[] = initialStep ? ["schedule", ...(kind === "zone" ? [] : ["spaces" as const]), "perimeter"] : ["zone", "price", ...(detailed ? ["schedule" as const, ...(kind === "zone" ? [] : ["spaces" as const]), "perimeter" as const] : [])];
  const index = ordered.indexOf(step) + 1;
  const action = step === "choose" ? null : {
    title: failed ? t("Retry saving", "Повтори зачувување") : step === "details" || step === "perimeter" || step === "done" ? t("Done", "Готово") : t("Next", "Следно"),
    disabled: busy,
    onPress: () => { if (step === "details") void finishDetails(); else if (failed) void save(failed); else if (step === "perimeter" || step === "done") void finish(); else advance(); },
  };
  const footerRegistered = useSheetContinue(action);
  const section = (key: EntryStep, title: string, summary: string, children: React.ReactNode) => <DetailSection key={key} title={title} summary={summary} expanded={expanded === key} busy={busy} colors={colors} onPress={() => { setExpanded(expanded === key ? null : key); setMessage(""); }}>{children}</DetailSection>;
  return <View style={s.root}>
    {step === "choose" ? <>
      {([false, true] as const).map(value => <Pressable key={String(value)} accessibilityRole="button" accessibilityLabel={value ? t("Detailed entry", "Детален внес") : t("Simple entry", "Брз внес")} style={s.choice} onPress={() => { setDetailed(value); setStep(value ? "details" : "zone"); }}>
        <View pointerEvents="none" style={s.choiceContent}><Icon name={value ? "map" : "zap"} color={colors.accentText} /><View style={s.flex}><Text style={s.title}>{value ? t("Detailed entry", "Детален внес") : t("Simple entry", "Брз внес")}</Text><Note>{value ? kind === "zone" ? t("Zone, price, paying hours and perimeter", "Зона, цена, часови на наплата и периметар") : t("Zone, price, paying hours, spaces and perimeter", "Зона, цена, часови на наплата, места и периметар") : t("Just the zone and price", "Само зона и цена")}</Note></View><Icon name="chevron-right" size={18} /></View>
      </Pressable>)}
    </> : step === "details" ? <>
      {section("zone", t("Zone label", "Ознака на зона"), code, field(t("Zone label", "Ознака на зона"), code, setCode, false, "B2, A0…", false))}
      {section("price", t("Price", "Цена"), first ? `${first} / ${next || first} ${t("MKD", "ден.")}` : "", <>
        <Button title={t("It's free", "Бесплатно е")} variant="secondary" disabled={busy} onPress={() => { setFirst("0"); setNext("0"); }} />
        <View style={s.row}><View style={s.flex}>{field(t("MKD / first hour", "ден. / прв час"), first, setFirst, true)}</View><View style={s.flex}>{field(t("Following hour", "Следен час"), next, setNext, true, first || t("Same as first hour", "Како првиот час"))}</View></View>
      </>)}
      {section("schedule", t("Paying hours", "Часови на наплата"), schedule.chargingHours ?? "", <PaymentScheduleFields value={schedule} onChange={setSchedule} disabled={busy} showHeading={false} />)}
      {kind !== "zone" ? section("spaces", t("Total parking spaces", "Вкупно паркинг места"), capacity, field(t("Total parking spaces", "Вкупно паркинг места"), capacity, setCapacity, true, t("Optional", "Опционално"), false)) : null}
      {section("perimeter", t("Parking perimeter", "Периметар на паркингот"), currentGeometry ? t("Added", "Додадено") : "", <Button icon="map" title={currentGeometry ? t("Edit perimeter", "Промени периметар") : t("Draw on map", "Означи на мапата")} disabled={busy || !onDrawBoundary} variant="secondary" onPress={() => { Keyboard.dismiss(); onDrawBoundary?.(currentGeometry); }} />)}
    </> : step === "done" ? <>
      <Icon name={busy ? "clock" : failed ? "alert-circle" : "check-circle"} color={colors.accentText} size={30} />
      <Text style={s.title}>{busy ? t("Saving…", "Се зачувува…") : failed ? t("One detail still needs saving", "Уште еден детал треба да се зачува") : t("Details saved", "Деталите се зачувани")}</Text>
    </> : <>
      <Text style={s.progress}>{t("Step", "Чекор")} {index} / {ordered.length}</Text>
      {step === "zone" ? <><Text style={s.title}>{t("What is the zone label?", "Која е ознаката на зоната?")}</Text>{field(t("Zone label", "Ознака на зона"), code, setCode, false, "B2, A0…")}</> : null}
      {step === "price" ? <><Text style={s.title}>{t("How much does it cost?", "Колку чини?")}</Text><Button title={t("It's free", "Бесплатно е")} variant="secondary" disabled={busy || Boolean(failed)} onPress={() => { setFirst("0"); setNext("0"); void save({ type: "price", first: 0, next: 0 }, detailed ? "schedule" : "done"); }} /><View style={s.row}><View style={s.flex}>{field(t("MKD / first hour", "ден. / прв час"), first, setFirst, true, t("Required", "Задолжително"))}</View><View style={s.flex}>{field(t("Following hour", "Следен час"), next, setNext, true, first || t("Same as first hour", "Како првиот час"))}</View></View></> : null}
      {step === "schedule" ? <PaymentScheduleFields value={schedule} onChange={setSchedule} disabled={busy || Boolean(failed)} /> : null}
      {step === "spaces" ? <><Text style={s.title}>{t("How many parking spaces?", "Колку паркинг места има?")}</Text><Note>{t("An estimate is fine.", "Може и процена.")}</Note>{field(t("Total parking spaces", "Вкупно паркинг места"), capacity, setCapacity, true, t("Required", "Задолжително"))}</> : null}
      {step === "perimeter" ? <><Text style={s.title}>{t("Mark the parking perimeter", "Означете го периметарот")}</Text><Button icon="map" title={currentGeometry ? t("Edit perimeter", "Промени периметар") : t("Draw on map", "Означи на мапата")} disabled={busy || Boolean(failed) || !onDrawBoundary} variant="secondary" onPress={() => { Keyboard.dismiss(); onDrawBoundary?.(currentGeometry); }} /></> : null}
      {step === "zone" ? <Button title={t("Skip", "Прескокни")} variant="secondary" disabled={busy || Boolean(failed)} onPress={() => advance(true)} /> : null}
    </>}
    {busy ? <Note>{t("Saving…", "Се зачувува…")}</Note> : saved && step !== "done" && step !== "details" ? <Note>{t("Completed steps saved", "Завршените чекори се зачувани")}</Note> : null}
    {message ? <Note>{message}</Note> : null}
    {failed ? <Note>{t("Retry to save this step. Earlier completed steps are kept.", "Повторете го зачувувањето. Претходно завршените чекори се задржани.")}</Note> : null}
    {!footerRegistered && action ? <View style={s.row}>
      <Button style={s.flex} title={t("Back", "Назад")} variant="secondary" disabled={busy} onPress={back} />
      <Button style={s.flex} title={action.title} disabled={action.disabled} onPress={action.onPress} />
    </View> : null}
  </View>;
}
function DetailSection({ title, summary, expanded, busy, colors, onPress, children }: { title: string; summary: string; expanded: boolean; busy: boolean; colors: ThemeColors; onPress: () => void; children: React.ReactNode }) {
  const s = styles(colors), reveal = useSheetReveal(expanded);
  return <View style={s.section} {...reveal} collapsable={false}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded, disabled: busy }} aria-expanded={expanded} disabled={busy} onPress={onPress} style={s.sectionHeader}>
      <View style={s.flex}><Text style={s.label}>{title}</Text>{summary && !expanded ? <Text numberOfLines={1} style={s.summary}>{summary}</Text> : null}</View><Icon name={expanded ? "chevron-up" : "chevron-down"} size={18} />
    </Pressable>
    {expanded ? <View style={s.sectionBody}>{children}</View> : null}
  </View>;
}
const styles = (colors: ThemeColors) => StyleSheet.create({
  root: { gap: 16, minHeight: 188 }, field: { gap: 7 }, flex: { flex: 1 }, row: { flexDirection: "row", gap: 10 },
  choiceContent: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  section: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, overflow: "hidden" },
  sectionHeader: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 12, padding: 15 },
  sectionBody: { gap: 12, padding: 15, paddingTop: 0 },
  summary: { color: colors.muted, fontSize: 12, marginTop: 4 },
  choice: { minHeight: 78, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14 },
  title: { color: colors.ink, fontSize: 18, fontWeight: "700" }, label: { color: colors.ink, fontSize: 13, fontWeight: "600" }, progress: { color: colors.muted, fontSize: 12 },
  input: { color: colors.ink, fontSize: 16, backgroundColor: colors.input, minHeight: 50, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 13 },
});
