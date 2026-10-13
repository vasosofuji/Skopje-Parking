import { useEffect, useMemo, useState } from "react";
import { activeSession, type ParkingSession } from "../domain/parking-sessions";
import { carPaidUntil, carSession } from "../domain/my-car";
import { listParkingSessions, onParkingSessionsChanged } from "../services/parkingSessions";

/** The local parking session log: the session behind "My car", its paid end and whether one is still running. */
export function useMyCar() {
  const [log, setLog] = useState<{ sessions: ParkingSession[]; at: number }>({ sessions: [], at: 0 });
  useEffect(() => {
    let version = 0;
    const load = () => { const current = ++version; void listParkingSessions().then(sessions => { if (current === version) setLog({ sessions, at: Date.now() }); }).catch(() => {}); };
    load();
    const stop = onParkingSessionsChanged(load);
    // Sessions end on their own; a minute is fine for hiding the button.
    const timer = setInterval(() => setLog(value => ({ ...value, at: Date.now() })), 60_000);
    return () => { version = -1; stop(); clearInterval(timer); };
  }, []);
  return useMemo(() => {
    const session = carSession(log.sessions, log.at);
    return { session, paidUntil: carPaidUntil(log.sessions, session), active: activeSession(log.sessions, log.at) };
  }, [log]);
}
