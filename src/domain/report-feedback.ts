import type { Availability, ParkingPlace, SignInfo } from "./types";
import { currentAvailability, parkingPrice } from "./parking";
import type { Language } from "./language";
import { isPocSector } from "./zone-interaction";

/** A zero tariff is known pricing, just like a paid tariff or confirmed report.
 * Tariff zones never take availability reports (the API rejects them), only a missing price. */
export function arrivalQuestion(place: ParkingPlace | null | undefined, followup = false, now = Date.now()): "availability" | "price" | null {
  if (!place) return null;
  if (followup || place.kind === "zone" || isPocSector(place)) return parkingPrice(place, now) ? null : "price";
  return "availability";
}

/** Show the original observation time in the driver's local clock, never a refresh time. */
export function availabilityReportTime(value: Availability | undefined, language: Language, now = Date.now()): string | null {
  const availability = currentAvailability(value, now);
  const observed = availability.observedAt ? Date.parse(availability.observedAt) : NaN;
  const expires = availability.expiresAt ? Date.parse(availability.expiresAt) : NaN;
  if (availability.status === "unknown" || !Number.isFinite(observed) || observed > now || !Number.isFinite(expires) || expires <= now) return null;
  const locale = { en: "en-GB", mk: "mk-MK", tr: "tr-TR", sq: "sq-AL" }[language];
  const date = new Date(observed), today = new Date(now);
  const sameDay = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  return new Intl.DateTimeFormat(locale, { ...(sameDay ? {} : { day: "2-digit" as const, month: "short" as const }), hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
}

export function hasSignDetails(info: SignInfo | null | undefined): boolean {
  return Boolean(info?.isParkingSign && (info.zoneCode?.trim() || info.operator?.trim() ||
    [info.firstHour, info.nextHour, info.maxStayMinutes].some(value => typeof value === "number" && Number.isFinite(value)) ||
    info.freeWeekends || info.chargingHours?.trim() || info.paymentInstructions?.trim() ||
    info.restrictions?.trim() || (info.rawText?.trim().length ?? 0) >= 3));
}
