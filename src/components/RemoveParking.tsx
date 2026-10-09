import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { api } from "../services/api";
import { useAccount } from "../state/AccountContext";
import { useParking } from "../state/ParkingContext";
import { useTheme } from "../state/ThemeContext";
import { Button, Note } from "./ui";

export default function RemoveParking({ id, onRemoved }: { id: string; onRemoved: () => void }) {
  const { profile } = useAccount();
  return profile ? <RemovalControl key={`${profile.id}:${id}`} id={id} onRemoved={onRemoved} /> : null;
}
function RemovalControl({ id, onRemoved }: { id: string; onRemoved: () => void }) {
  const { t, refresh, forgetParking, connected } = useParking(), { colors } = useTheme();
  const [allowed, setAllowed] = useState(false), [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (id.startsWith("community:")) void api.removal(id).then(value => { if (active) setAllowed(value.canRemove); }).catch(() => {});
    return () => { active = false; };
  }, [id, connected]);
  if (!allowed) return null;
  async function remove() {
    if (busy) return;
    setBusy(true); setError("");
    try { await api.removeParking(id); await refresh(); forgetParking(id); onRemoved(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t("Could not remove parking. Try again.", "Паркингот не е избришан. Обидете се повторно.")); }
    finally { setBusy(false); }
  }
  return <View style={{ gap: 10, paddingTop: 16 }}>
    {confirming ? <View accessibilityRole="alert" style={{ gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.red }}>
      <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 17 }}>{t("Are you sure?", "Дали сте сигурни?")}</Text>
      <Note>{t("Remove this parking spot and its community information? This cannot be undone.", "Да се избрише овој паркинг и информациите од заедницата? Ова не може да се врати.")}</Note>
      <Button title={busy ? t("Removing…", "Се брише…") : t("Yes, remove parking", "Да, избриши паркинг")} disabled={busy || !connected} onPress={() => void remove()} />
      <Button variant="secondary" title={t("Cancel", "Откажи")} disabled={busy} onPress={() => setConfirming(false)} />
    </View> : <Button variant="secondary" icon="trash-2" title={t("Remove my parking spot", "Избриши го мојот паркинг")} disabled={!connected} onPress={() => setConfirming(true)} />}
    {error ? <Text accessibilityRole="alert" style={{ color: colors.red }}>{error}</Text> : null}
  </View>;
}
