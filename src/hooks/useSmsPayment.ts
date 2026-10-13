import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Fix } from "../domain/arrival";
import type { ParkingPlace } from "../domain/types";
import { isVerifiedSmsPayment, smsMessage } from "../domain/sms-payment";
import { carPosition, paymentSession, skopjeClock } from "../domain/my-car";
import { api } from "../services/api";
import { openSmsComposer } from "../services/smsComposer";
import { scheduleParkingLimitReminder } from "../services/parkingReminder";
import { saveParkingSession } from "../services/parkingSessions";
import { useLicensePlate } from "../state/LicensePlateContext";
import { useParking } from "../state/ParkingContext";

type Options = {
  /** The offer's own check: still the right zone, protocol and moment to pay. */
  validate: (id: string, places?: ParkingPlace[]) => ParkingPlace | null;
  /** The phone's position becomes the car's when it is precise at payment time. */
  fix?: Fix | null;
  onOpened: () => void;
  onInvalidated: () => void;
};
/**
 * Opens the SMS composer for one zone after a fresh check of its protocol, then records the
 * parking session, the pending stop SMS and the time-limit reminder. The payment sheet and the
 * quick pay card both pay through this.
 */
export function useSmsPayment(options: Options) {
  const { t, latestCatalog } = useParking(), account = useLicensePlate();
  const latest = useRef({ ...options, account }); useLayoutEffect(() => { latest.current = { ...options, account }; });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function pay(place: ParkingPlace, hours: number | null) {
    const protocol = place.smsPayment, plate = account.savedPlate, accountId = account.accountId, signature = JSON.stringify(protocol);
    const duration = protocol?.mode === "fixed-hours" ? hours : null;
    if (!protocol || !plate || busy || (protocol.mode === "fixed-hours" && !protocol.allowedHours?.includes(duration!))) return;
    setBusy(true); setError("");
    try {
      // Catalog overlap and the operator's rules both have to be current at send time.
      const [catalog, fresh] = await Promise.all([latestCatalog(), api.smsPayment(place.id)]);
      const places = catalog.places.map(value => value.id === place.id ? { ...fresh.place, smsPayment: fresh.protocol ?? undefined } : value);
      if (!latest.current.validate(place.id, places) || JSON.stringify(fresh.protocol) !== signature) { latest.current.onInvalidated(); return; }
      const stillValid = () => mounted.current && Boolean(latest.current.validate(place.id)) && isVerifiedSmsPayment(fresh.protocol) && latest.current.account.accountId === accountId && latest.current.account.savedPlate === plate;
      const result = await openSmsComposer(protocol.destination, smsMessage(protocol.startTemplate, protocol.zoneCode, plate, duration), stillValid);
      if (result === "opened") {
        const openedAt = Date.now();
        void saveParkingSession(paymentSession(fresh.place, protocol, duration, carPosition(latest.current.fix, openedAt), openedAt)).catch(() => {});
        if (protocol.mode === "start-stop" && protocol.stopTemplate) {
          const stopMessage = smsMessage(protocol.stopTemplate, protocol.zoneCode, plate, null);
          await account.setPendingStop({ zoneId: place.id, zoneName: place.name, recipient: protocol.destination, stopMessage, photoId: protocol.photoId, protocolExpiresAt: protocol.expiresAt, openedAt, plate });
          if (protocol.maxStayMinutes) {
            void scheduleParkingLimitReminder(openedAt + (protocol.maxStayMinutes - 15) * 60_000, t("Parking time limit", "Ограничување на паркирањето"),
              t("Parking time ends soon", "Времето за паркирање истекува наскоро"),
              t("Zone {zone} allows parking until {time}. Send {stop} to {number} when you leave.", "Зоната {zone} дозволува паркирање до {time}. Кога ќе заминете, испратете {stop} на {number}.")
                .replace("{zone}", protocol.zoneCode).replace("{time}", skopjeClock(openedAt + protocol.maxStayMinutes * 60_000)).replace("{stop}", stopMessage).replace("{number}", protocol.destination));
          }
        }
        latest.current.onOpened();
      } else if (result !== "cancelled") setError(t("SMS is unavailable here. Use the number and message shown.", "SMS не е достапна. Користете ги прикажаните број и порака."));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not open SMS. Try again.", "SMS не се отвори. Обидете се повторно.")); }
    finally { setBusy(false); }
  }
  return { pay, busy, error };
}
