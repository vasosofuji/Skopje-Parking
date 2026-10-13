import React, { useEffect, useState } from "react";
import { Button } from "./ui";
import { useParking } from "../state/ParkingContext";
import { useContributionFeedback } from "../state/ContributionFeedback";
import { activeSession, type ParkingSession } from "../domain/parking-sessions";
import { listParkingSessions, onParkingSessionsChanged } from "../services/parkingSessions";
import { leaveSpot, onSpotSharingChanged, spotLeft } from "../services/spotOpenings";

/** "I'm leaving my spot" while a paid session runs: drivers heading nearby hear about it now. */
export default function LeavingSpotButton() {
  const { t } = useParking();
  const { thankYou } = useContributionFeedback();
  const [session, setSession] = useState<ParkingSession | null>(null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void listParkingSessions().then(async sessions => {
        const current = activeSession(sessions, Date.now());
        const left = current ? await spotLeft(current.id) : false;
        if (active) setSession(left ? null : current);
      }).catch(() => {});
    };
    refresh();
    const removeSessions = onParkingSessionsChanged(refresh), removeSharing = onSpotSharingChanged(refresh);
    return () => { active = false; removeSessions(); removeSharing(); };
  }, []);
  if (!session) return null;
  return <Button variant="secondary" icon="log-out" disabled={busy}
    title={busy ? t("Please wait…", "Почекајте…") : failed ? t("Could not share. Try again.", "Не успеа споделувањето. Обидете се повторно.") : t("I'm leaving my spot", "Го напуштам местото")}
    onPress={() => {
      setBusy(true); setFailed(false);
      void leaveSpot(session).then(thankYou, () => setFailed(true)).finally(() => setBusy(false));
    }} />;
}
