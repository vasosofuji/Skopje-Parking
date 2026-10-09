import React, { useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { Button, Icon, Note, Sheet } from "./ui";
import PhotoPicker from "./PhotoPicker";
import SignReviewSheet from "./SignReviewSheet";
import ManualParkingWizard from "./ManualParkingWizard";
import StepActions from "./StepActions";
import { type ChosenPhoto } from "../services/photos";
import { discardSignPhoto, scanSign, type SignDraft } from "../services/signScan";
import type { Coordinate, Geometry, ParkingKind, ParkingPlace } from "../domain/types";
import { useParking } from "../state/ParkingContext";
import { useTheme, type ThemeColors } from "../state/ThemeContext";
import { api } from "../services/api";

export default function ProposalSheet({ coordinate, geometry, visible = true, onClose, onSubmitted, onDrawBoundary, initial, locationAccuracy }: {
  coordinate: Coordinate;
  geometry?: Geometry;
  visible?: boolean;
  onClose: () => void;
  onSubmitted: (id: string) => void;
  onDrawBoundary?: (geometry?: Geometry) => void;
  initial?: { name?: string; zoneCode?: string; kind?: ParkingKind };
  locationAccuracy?: number;
}) {
  const { t, refresh, catalog } = useParking(), { colors } = useTheme(), s = styles(colors);
  const [requestId] = useState(randomUUID), [savedId, setSavedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"manual" | "photo" | null>(null);
  const [photo, setPhoto] = useState<ChosenPhoto | null>(null), [review, setReview] = useState<SignDraft | null>(null);
  const [reviewShown, setReviewShown] = useState(false);
  const [savedPlace, setSavedPlace] = useState<ParkingPlace | null>(null);
  const [afterSign, setAfterSign] = useState<"offer" | "details" | null>(null), [afterSignShown, setAfterSignShown] = useState(false);
  const sourcePresented = useRef(false);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [photoBusy, setPhotoBusy] = useState(false);
  function saved(id: string) { setSavedId(id); onSubmitted(id); }
  function finish() { void refresh(); onClose(); }
  async function submitPhoto() {
    if (!photo || busy) return;
    setBusy(true); setMessage("");
    let id = savedId;
    try {
      if (!id) {
        const kind = initial?.kind ?? "surface";
        const place = await api.contribute({ requestId, name: kind === "zone" ? t("Parking zone", "Паркинг зона") : t("Parking", "Паркинг"), coordinate, kind, geometry, zoneCode: null, firstHour: null, nextHour: null });
        id = place.id; setSavedPlace(place); saved(id);
      }
      // Read on this phone; only the details the driver confirms are uploaded.
      const draft = await scanSign(id, photo, catalog.places.flatMap(place => place.kind === "zone" && place.zoneCode ? [place.zoneCode] : []));
      setPhoto(null);
      setReviewShown(Platform.OS !== "ios" || !sourcePresented.current);
      setReview(draft);
      void refresh();
    } catch (error) {
      setMessage((id ? t("Parking saved. Try reading the sign again. ", "Паркингот е зачуван. Обидете се повторно да ја прочитате таблата. ") : "") + (error instanceof Error ? error.message : t("Could not save.", "Не е зачувано.")));
    } finally { setBusy(false); }
  }
  function confirmed() {
    if (initial?.kind === "zone") { finish(); return; }
    setAfterSign("offer"); setAfterSignShown(Platform.OS !== "ios"); setReviewShown(false);
  }
  const followupPlace = catalog.places.find(place => place.id === savedId) ?? savedPlace;
  const choice = (value: "manual" | "photo", title: string, subtitle: string, icon: "edit-2" | "camera") => <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={() => { setMode(value); setMessage(""); }} style={s.choice}>
    <View pointerEvents="none" style={s.choiceContent}><Icon name={icon} color={colors.accentText} /><View style={s.flex}><Text style={s.title}>{title}</Text><Note>{subtitle}</Note></View><Icon name="chevron-right" size={18} /></View>
  </Pressable>;
  return <>
    <Sheet visible={visible && (!review || Boolean(afterSign && afterSignShown))} title={afterSign ? t("Parking saved", "Паркингот е зачуван") : mode === "photo" ? t("Parking sign photo", "Слика од паркинг табла") : t("Add parking", "Додај паркинг")}
      onShow={() => { sourcePresented.current = true; }}
      onDismiss={() => { sourcePresented.current = false; if (review && !afterSign) setReviewShown(true); }}
      onClose={() => { if (!photoBusy && !busy) finish(); }}
      onBack={!afterSign && mode ? () => setMode(null) : undefined} backDisabled={photoBusy || busy}
      footer={mode === "photo" && !afterSign ? <StepActions onBack={() => setMode(null)} backDisabled={busy || photoBusy} title={busy ? t("Saving…", "Се зачувува…") : t("Read sign & review", "Прочитај и провери табла")} disabled={!photo || busy || photoBusy} onContinue={() => void submitPhoto()} /> : undefined}>
      {afterSign === "offer" ? <>
        <Text style={s.title}>{t("Add a little more?", "Да додадеме уште нешто?")}</Text>
        <Note>{t("The sign details are saved. Spaces and the perimeter are optional.", "Податоците од таблата се зачувани. Местата и периметарот се по избор.")}</Note>
        <Button title={t("Done", "Готово")} onPress={finish} />
        <Button title={t("Add spaces & perimeter", "Додај места и периметар")} variant="secondary" disabled={!followupPlace} onPress={() => setAfterSign("details")} />
      </> : afterSign === "details" && followupPlace ? <ManualParkingWizard place={followupPlace} coordinate={followupPlace.coordinate} geometry={followupPlace.geometry} returnedGeometry={geometry} kind={followupPlace.kind} initialStep="spaces" onDrawBoundary={onDrawBoundary} onDone={finish} onBack={() => setAfterSign("offer")} /> : !mode ? <>
        {locationAccuracy !== undefined ? <Note>{t("Current location", "Тековна локација")} · ±{Math.ceil(locationAccuracy)} m</Note> : null}
        {choice("photo", t("Photograph a sign", "Фотографирај табла"), t("Check the digital sign after the photo", "Проверете ја дигиталната табла по сликањето"), "camera")}
        {choice("manual", t("Enter manually", "Внеси рачно"), t("Simple or detailed entry", "Брз или детален внес"), "edit-2")}
      </> : mode === "manual" ? <ManualParkingWizard entryKey={`${initial?.kind ?? "surface"}:${coordinate.latitude.toFixed(6)}:${coordinate.longitude.toFixed(6)}`} place={followupPlace ?? undefined} existingPlaceId={savedId ?? undefined} coordinate={followupPlace?.coordinate ?? coordinate} geometry={followupPlace?.geometry} returnedGeometry={geometry} initialZone={initial?.zoneCode} kind={followupPlace?.kind ?? initial?.kind} onDrawBoundary={onDrawBoundary} onSaved={saved} onDone={finish} onBack={() => setMode(null)} /> : <>
        <PhotoPicker value={photo} onChange={value => { if (photo && photo.uri !== value?.uri) void discardSignPhoto(photo.uri); setPhoto(value); }} disabled={busy} onBusyChange={setPhotoBusy} onCancel={() => setMode(null)} />
        {message ? <Note>{message}</Note> : null}
      </>}
    </Sheet>
    {review ? <SignReviewSheet key={review.imageUri} draft={review} visible={visible && reviewShown && !afterSign} onClose={finish} onConfirmed={confirmed} onDismiss={() => { if (afterSign) setAfterSignShown(true); }} /> : null}
  </>;
}
const styles = (colors: ThemeColors) => StyleSheet.create({
  flex: { flex: 1, gap: 3 },
  choice: { minHeight: 78, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  choiceContent: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  title: { color: colors.ink, fontSize: 16, fontWeight: "700" },
});
