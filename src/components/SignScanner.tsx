import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { type ChosenPhoto } from "../services/photos";
import { discardSignPhoto, scanSign, type SignDraft } from "../services/signScan";
import { useSignReader } from "../services/signReader";
import { signOcrAvailable } from "../services/signOcr";
import { useParking } from "../state/ParkingContext";
import { Button, Note } from "./ui";
import PhotoPicker from "./PhotoPicker";

/** Photograph a sign and read it on this phone. The photo is never uploaded. */
export default function SignScanner({ placeId, onCancel, onBusyChange, onReview }: { placeId: string; onCancel?: () => void; onBusyChange?: (busy: boolean) => void; onReview: (draft: SignDraft) => void }) {
  const { t, catalog } = useParking(), reader = useSignReader();
  const [chosen, setChosen] = useState<ChosenPhoto | null>(null);
  const [busy, setBusy] = useState(false), [photoBusy, setPhotoBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => { onBusyChange?.(busy || photoBusy); return () => onBusyChange?.(false); }, [busy, photoBusy, onBusyChange]);
  function choose(photo: ChosenPhoto | null) {
    // A replaced or removed photo is deleted straight away.
    if (chosen && chosen.uri !== photo?.uri) void discardSignPhoto(chosen.uri);
    setChosen(photo);
  }
  async function read() {
    if (!chosen || busy || photoBusy) return;
    setBusy(true); setMessage("");
    try {
      const draft = await scanSign(placeId, chosen, catalog.places.flatMap(place => place.kind === "zone" && place.zoneCode ? [place.zoneCode] : []));
      setChosen(null);
      onReview(draft);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : t("Could not read the photo. Try again.", "Сликата не е прочитана. Обидете се повторно.")); }
    finally { setBusy(false); }
  }
  return <View style={{ gap: 12 }}>
    <PhotoPicker value={chosen} onChange={choose} disabled={busy} onBusyChange={setPhotoBusy} onCancel={onCancel} />
    {chosen ? <Button title={busy ? t("Reading sign…", "Се чита таблата…") : reader || signOcrAvailable ? t("Read sign & review", "Прочитај и провери табла") : t("Enter sign details", "Внеси податоци од таблата")} disabled={busy || photoBusy} onPress={() => void read()} /> : null}
    <Note>{t("The photo is read on this phone and deleted afterwards. Only the details you confirm are shared.", "Сликата се чита на овој телефон и потоа се брише. Се споделуваат само податоците што ги потврдувате.")}</Note>
    {message ? <Note>{message}</Note> : null}
  </View>;
}
