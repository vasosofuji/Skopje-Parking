import React, { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SAVED_NAME_MAX, savedDestination, savedPlaceAt, withSavedPlace, type SavedPlace } from "../domain/saved-places";
import type { Destination } from "../domain/types";
import { changeSavedPlaces, useSavedPlaces } from "../services/savedPlaces";
import { useParking } from "../state/ParkingContext";
import { useTheme } from "../state/ThemeContext";
import { Button, Icon, Note, Sheet, type IconName } from "./ui";

export const SAVED_PLACE_ICONS: Record<SavedPlace["kind"], IconName> = { home: "home", work: "briefcase", custom: "bookmark" };

/** Quick destinations under an empty, focused search field. */
export function SavedPlaceChips({ onChoose }: { onChoose: (destination: Destination) => void }) {
  const places = useSavedPlaces(), { colors } = useTheme();
  if (!places.length) return null;
  return <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
    {places.map(place => <Pressable key={place.id} accessibilityRole="button" accessibilityLabel={place.name} onPress={() => onChoose(savedDestination(place))}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, opacity: pressed ? 0.75 : 1 })}>
      <Icon name={SAVED_PLACE_ICONS[place.kind]} size={15} color={colors.accentText} />
      <Text numberOfLines={1} style={{ maxWidth: 160, color: colors.ink, fontSize: 14, fontWeight: "600" }}>{place.name}</Text>
    </Pressable>)}
  </ScrollView>;
}

/** Bookmark toggle for a search result or the current destination. */
export function SavePlaceButton({ destination }: { destination: Destination }) {
  const { t } = useParking(), { colors } = useTheme(), places = useSavedPlaces();
  const saved = savedPlaceAt(places, destination.coordinate);
  const [open, setOpen] = useState(false), [kind, setKind] = useState<SavedPlace["kind"]>("custom"), [name, setName] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const names = { home: t("Home", "Дома"), work: t("Work", "Работа"), custom: t("Other place", "Друго место") };
  const replaced = kind !== "custom" ? places.find(place => place.kind === kind) : undefined;
  function start() {
    if (saved) { void changeSavedPlaces(list => list.filter(place => place.id !== saved.id)).catch(() => {}); return; }
    setKind("custom"); setName(destination.name.slice(0, SAVED_NAME_MAX)); setError(""); setOpen(true);
  }
  function pick(value: SavedPlace["kind"]) {
    setKind(value);
    setName(value === "custom" ? destination.name.slice(0, SAVED_NAME_MAX) : names[value]);
  }
  async function save() {
    if (busy || !name.trim()) return;
    setBusy(true); setError("");
    const place: SavedPlace = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), kind, name: name.trim(), coordinate: destination.coordinate };
    if (!withSavedPlace(places, place)) { setBusy(false); setError(t("You can save up to 20 places. Delete one in Settings.", "Може да зачувате најмногу 20 места. Избришете едно во Поставки.")); return; }
    try {
      await changeSavedPlaces(list => withSavedPlace(list, place) ?? list);
      setOpen(false);
    } catch { setError(t("Could not save. Try again.", "Не е зачувано. Обидете се повторно.")); }
    finally { setBusy(false); }
  }
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={saved ? t("Remove saved place", "Отстрани зачувано место") : t("Save place", "Зачувај место")} hitSlop={6} onPress={start}
      style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" }}>
      <Icon name="bookmark" size={18} color={saved ? colors.accentText : colors.muted} />
    </Pressable>
    <Sheet visible={open} title={t("Save place", "Зачувај место")} onClose={() => setOpen(false)}>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {(["home", "work", "custom"] as const).map(value => <Button key={value} icon={SAVED_PLACE_ICONS[value]} title={names[value]} variant={kind === value ? "primary" : "secondary"} disabled={busy} onPress={() => pick(value)} />)}
      </View>
      <TextInput value={name} onChangeText={setName} editable={!busy} maxLength={SAVED_NAME_MAX} returnKeyType="done" onSubmitEditing={() => void save()}
        accessibilityLabel={t("Name", "Име")} placeholder={t("Name", "Име")} placeholderTextColor={colors.muted}
        style={{ minHeight: 52, paddingHorizontal: 14, fontSize: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.line, color: colors.ink, backgroundColor: colors.input }} />
      {replaced ? <Note>{t("This replaces the place saved as {name}.", "Ова го заменува местото зачувано како {name}.").replace("{name}", replaced.name)}</Note> : null}
      {error ? <Text accessibilityLiveRegion="polite" style={{ color: colors.red }}>{error}</Text> : null}
      <Button title={t("Save", "Зачувај")} disabled={busy || !name.trim()} onPress={() => void save()} />
    </Sheet>
  </>;
}
