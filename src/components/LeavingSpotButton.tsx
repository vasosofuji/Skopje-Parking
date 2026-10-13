import React, { useState } from "react";
import { Button } from "./ui";
import { useParking } from "../state/ParkingContext";
import { useContributionFeedback } from "../state/ContributionFeedback";
import type { ParkingSession } from "../domain/parking-sessions";
import { leaveSpot } from "../services/spotOpenings";

/** "I'm leaving my spot" while a paid session runs: it stops, and drivers heading nearby hear about it now. */
export default function LeavingSpotButton({ session }: { session: ParkingSession | null }) {
  const { t } = useParking();
  const { thankYou } = useContributionFeedback();
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  if (!session) return null;
  return <Button variant="secondary" icon="log-out" disabled={busy}
    title={busy ? t("Please wait…", "Почекајте…") : failed ? t("Could not save. Try again.", "Не е зачувано. Обидете се повторно.") : t("I'm leaving my spot", "Го напуштам местото")}
    onPress={() => {
      setBusy(true); setFailed(false);
      void leaveSpot(session).then(shared => { if (shared) thankYou(); }, () => setFailed(true)).finally(() => setBusy(false));
    }} />;
}
