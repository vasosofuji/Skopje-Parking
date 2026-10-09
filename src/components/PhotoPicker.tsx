import React, { useEffect, useRef, useState } from "react";
import { Image, Linking, View } from "react-native";
import { Button, IconButton, Note } from "./ui";
import { chooseSignPhoto, PhotoPermissionError, type ChosenPhoto } from "../services/photos";
import { useParking } from "../state/ParkingContext";

/** Source choices live in the caller's popup, so Photograph a sign is one tap. */
export default function PhotoPicker({ value, onChange, disabled = false, onBusyChange, onCancel }: {
  value: ChosenPhoto | null;
  onChange: (photo: ChosenPhoto | null) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onCancel?: () => void;
}) {
  const { t } = useParking();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [permissionBlocked, setPermissionBlocked] = useState(false), [changing, setChanging] = useState(false);
  const launching = useRef(false), mounted = useRef(true), busyCallback = useRef(onBusyChange);
  useEffect(() => { busyCallback.current = onBusyChange; }, [onBusyChange]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; busyCallback.current?.(false); };
  }, []);
  async function pick(camera: boolean) {
    if (launching.current || disabled) return;
    launching.current = true;
    setBusy(true); busyCallback.current?.(true); setError(""); setPermissionBlocked(false);
    try {
      // No nested source modal is dismissed before launching. This stays a direct
      // user gesture on web, and the native picker presents over the source popup.
      const photo = await chooseSignPhoto(camera);
      if (photo && mounted.current) { onChange(photo); setChanging(false); }
    } catch (error) {
      if (!mounted.current) return;
      setPermissionBlocked(error instanceof PhotoPermissionError && error.blocked);
      setError(error instanceof PhotoPermissionError
        ? t("Allow camera access to take a photo, or choose one from your gallery.", "Дозволете пристап до камерата или изберете слика од галеријата.")
        : error instanceof Error ? error.message : t("Could not open photo.", "Сликата не се отвора."));
    } finally {
      launching.current = false;
      if (mounted.current) { setBusy(false); busyCallback.current?.(false); }
    }
  }
  return <View style={{ gap: 10 }}>
    {!value || changing ? <>
      <Note>{t("Capture the whole sign so prices and hours are readable.", "Фотографирајте ја целата табла за цените и часовите да се читливи.")}</Note>
      <Button icon="camera" title={busy ? t("Opening…", "Се отвора…") : t("Take photo", "Фотографирај")} variant="secondary" disabled={busy || disabled} onPress={() => void pick(true)} />
      <Button icon="image" title={t("Open gallery", "Отвори галерија")} variant="secondary" disabled={busy || disabled} onPress={() => void pick(false)} />
      <Button title={t("Cancel", "Откажи")} variant="secondary" disabled={busy || disabled} onPress={() => { if (value) setChanging(false); else onCancel?.(); }} />
    </> : <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Image source={{ uri: value.uri }} accessibilityLabel={t("Selected parking sign", "Избрана паркинг табла")} style={{ width: 64, height: 64, borderRadius: 10 }} resizeMode="cover" />
      <Button style={{ flex: 1 }} title={t("Change photo", "Смени слика")} icon="camera" variant="secondary" disabled={busy || disabled} onPress={() => setChanging(true)} />
      <IconButton name="x" label={t("Remove photo", "Отстрани слика")} disabled={busy || disabled} onPress={() => onChange(null)} />
    </View>}
    {error ? <Note>{error}</Note> : null}
    {permissionBlocked ? <Button title={t("Open camera settings", "Отвори поставки за камерата")} variant="secondary" onPress={() => { void Linking.openSettings().catch(() => setError(t("Open this app's permissions in your phone settings.", "Отворете ги дозволите за апликацијата во поставките на телефонот."))); }} /> : null}
  </View>;
}
