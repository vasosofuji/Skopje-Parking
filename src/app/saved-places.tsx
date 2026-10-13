import React, { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import Page from "../components/Page";
import { SAVED_PLACE_ICONS } from "../components/SavedPlaces";
import { Icon, IconButton, Note } from "../components/ui";
import { SAVED_NAME_MAX, type SavedPlace } from "../domain/saved-places";
import { changeSavedPlaces, useSavedPlaces } from "../services/savedPlaces";
import { useParking } from "../state/ParkingContext";
import { useTheme } from "../state/ThemeContext";

export default function SavedPlacesScreen() {
  const { t } = useParking(), { colors } = useTheme(), places = useSavedPlaces();
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null), [message, setMessage] = useState("");
  const change = (update: (list: SavedPlace[]) => SavedPlace[]) => changeSavedPlaces(update).then(() => { setMessage(""); setEditing(null); }, () => setMessage(t("Could not save. Try again.", "Не е зачувано. Обидете се повторно.")));
  function rename() {
    const name = editing?.name.trim();
    if (editing && name) void change(list => list.map(place => place.id === editing.id ? { ...place, name } : place));
  }
  return <Page title={t("Saved places", "Зачувани места")}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ width: "100%", maxWidth: 680, alignSelf: "center", padding: 16, paddingBottom: 28, gap: 16 }}>
      <Note>{t("Saved places appear when you tap the search field. Save a search result or your destination with the bookmark. They stay on this phone and are cleared when you sign out.", "Зачуваните места се појавуваат кога ќе го допрете полето за пребарување. Зачувајте резултат или дестинација со обележувачот. Остануваат на овој телефон и се бришат кога ќе се одјавите.")}</Note>
      {places.length ? <View style={{ backgroundColor: colors.input, borderRadius: 20, borderWidth: 1, borderColor: colors.line, overflow: "hidden" }}>
        {places.map((place, index) => <View key={place.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 64, paddingLeft: 18, paddingRight: 8, borderTopWidth: index ? 1 : 0, borderColor: colors.line }}>
          <Icon name={SAVED_PLACE_ICONS[place.kind]} size={19} color={colors.accentText} />
          {editing?.id === place.id ? <>
            <TextInput autoFocus value={editing.name} onChangeText={name => setEditing({ id: place.id, name })} maxLength={SAVED_NAME_MAX} returnKeyType="done" onSubmitEditing={rename}
              accessibilityLabel={t("Name", "Име")} style={{ flex: 1, minHeight: 44, paddingHorizontal: 10, fontSize: 15, borderRadius: 10, borderWidth: 1, borderColor: colors.line, color: colors.ink, backgroundColor: colors.paper }} />
            <IconButton name="check" label={t("Save", "Зачувај")} disabled={!editing.name.trim()} onPress={rename} />
            <IconButton name="x" label={t("Cancel", "Откажи")} onPress={() => setEditing(null)} />
          </> : <>
            <Text numberOfLines={2} style={{ flex: 1, color: colors.ink, fontSize: 15, fontWeight: "500" }}>{place.name}</Text>
            <IconButton name="edit-2" compact label={`${t("Rename", "Преименувај")}: ${place.name}`} onPress={() => setEditing({ id: place.id, name: place.name })} />
            <IconButton name="trash-2" compact label={`${t("Delete", "Избриши")}: ${place.name}`} onPress={() => void change(list => list.filter(item => item.id !== place.id))} />
          </>}
        </View>)}
      </View> : <Note>{t("No saved places yet.", "Сè уште нема зачувани места.")}</Note>}
      {message ? <Text accessibilityLiveRegion="polite" style={{ color: colors.red }}>{message}</Text> : null}
    </ScrollView>
  </Page>;
}
