import type { ParkingPlace } from "./types";
import { parsePayingHours } from "./payment-hours";
import type { SmsPaymentCandidate, VerifiedSmsPayment } from "./sms-payment";

// Official Skopje on-street parking rules, checked 2026-10-08 against the operators' own pages.
// Signs at the parking remain the authority; these rules only fill what a sign photo has not.
//
// JP Gradski Parking (city zones A0/A/B/C/D): SMS 144144, "<ZONE> <PLATE>", stop with "S".
//   https://www.gradskiparking.com.mk/zonsko-nacini-naplata.nspx (and /how-to-pay.nspx)
//   Zones, limits: https://www.gradskiparking.com.mk/zonsko-parking-zoni.nspx
//   Hours: https://www.parking.mk/?page=static&section=town_skopje
// JP Parkinzi na Opshtina Centar (POC zones 0/1/2): SMS 141414, "<zone> <PLATE> <hours>", no stop SMS.
//   https://poc.mk/?page_id=298 · 2026 price list adopted 15.04.2026: https://poc.mk/?page_id=161
export const SKOPJE_RULES_CHECKED = "2026-10-08";
/** The only SMS numbers the app will ever open a composer for, with each operator's message format. */
export const OFFICIAL_SMS_FORMATS: Readonly<Record<string, Pick<SmsPaymentCandidate, "mode" | "startTemplate" | "stopTemplate">>> = {
  "144144": { mode: "start-stop", startTemplate: "{zone} {plate}", stopTemplate: "S" },
  "141414": { mode: "fixed-hours", startTemplate: "{zone} {plate} {hours}", stopTemplate: null },
};

export type OfficialOperator = "gradski" | "poc";
/** Call centres and payment pages of JP Gradski Parking and JP Parkinzi na Opshtina Centar. */
export const OPERATOR_HELP: Record<OfficialOperator, { phone: string; url: string }> = {
  gradski: { phone: "+38923215566", url: "https://www.gradskiparking.com.mk/zonsko-nacini-naplata.nspx" },
  poc: { phone: "+38972251251", url: "https://poc.mk/?page_id=298" },
};

// Official non-working days for all citizens (Ministry of Economy and Labour programme; a holiday
// on Sunday moves to Monday). Gradski Parking does not charge on Sundays and these days.
// Lunar holidays can shift by a day; refresh this list every year.
const HOLIDAYS = new Set([
  "2026-01-01", "2026-01-07", "2026-03-20", "2026-04-13", "2026-05-01", "2026-05-25",
  "2026-08-03", "2026-09-08", "2026-10-12", "2026-10-23", "2026-12-08",
  "2027-01-01", "2027-01-07", "2027-03-09", "2027-05-01", "2027-05-03", "2027-05-24",
  "2027-08-02", "2027-09-08", "2027-10-11", "2027-10-23", "2027-12-08",
]);

const SKOPJE_CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Skopje", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** Local Skopje calendar fields for a timestamp. */
export function skopjeTime(now: number) {
  const parts = SKOPJE_CLOCK.formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    month: Number(value("month")),
    day: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(value("weekday")),
    minute: Number(value("hour")) * 60 + Number(value("minute")),
  };
}
export const isSkopjeHoliday = (now: number) => HOLIDAYS.has(skopjeTime(now).date);

type Rules = {
  operator: OfficialOperator; token: string; maxStayMinutes: number | null;
  /** The published weekly timetable for a month, or null when the operator does not publish one. */
  hours: (month: number) => string | null;
};
// Gradski Parking publishes three timetables (Centar, Aerodrom, Vodno) without zone codes; codes
// are matched to them by the published street names. Sundays and holidays are free except at Vodno.
const CENTRE = (month: number) => month >= 6 && month <= 9 ? "Mon-Sat 07:00-23:00" : "Mon-Fri 07:00-21:00; Sat 07:00-14:00";
const AERODROM = () => "Mon-Sat 07:00-23:00";
// Sredno Vodno: Saturdays, Sundays and holidays 09-16. Weekday hours are not published.
const VODNO = () => "Sat-Sun 09:00-16:00";

function gradskiRules(code: string): Rules | null {
  const family = code.match(/^([ABCD])(\d{1,2})$/);
  if (!family) return null;
  const [, letter, number] = family;
  // D1-D9 are Aerodrom streets; D40-D62 are in Karposh, outside the three published timetables.
  const hours = code === "A0" ? VODNO : letter === "D" ? Number(number) < 10 ? AERODROM : () => null : CENTRE;
  // A3-A8 allow 2 hours and B zones 4 hours; A0x premium streets and C/D zones have no limit.
  return { operator: "gradski", token: code, maxStayMinutes: letter === "A" && !code.startsWith("A0") ? 120 : letter === "B" ? 240 : null, hours };
}

/** Rules for an operator's catalog zone. The seeded id, not an editable label, decides. */
export function officialZoneRules(place: Pick<ParkingPlace, "id" | "kind">): Rules | null {
  if (place.kind !== "zone") return null;
  const gradski = place.id.match(/^gradski:zone:([A-D]\d{1,2})$/);
  if (gradski) return gradskiRules(gradski[1]);
  const poc = place.id.match(/^poc:zone:([012]):\d+$/);
  // POC does not publish its charging hours on poc.mk; the sign at the sector is the source.
  return poc ? { operator: "poc", token: poc[1], maxStayMinutes: null, hours: () => null } : null;
}

/** The current season's official paying hours in the app's paying-hours format. */
export const officialChargingHours = (place: Pick<ParkingPlace, "id" | "kind">, now: number) =>
  officialZoneRules(place)?.hours(skopjeTime(now).month) ?? null;

/** true/false when official hours decide it, null when they are not published. */
export function officiallyCharging(place: Pick<ParkingPlace, "id" | "kind">, now: number): boolean | null {
  const rules = officialZoneRules(place), time = skopjeTime(now), periods = parsePayingHours(rules?.hours(time.month));
  if (!rules || !periods?.length) return null;
  const holiday = HOLIDAYS.has(time.date), vodno = rules.token === "A0" && rules.operator === "gradski";
  if (vodno && time.day < 5 && !holiday) return null;
  if (!vodno && (time.day === 6 || holiday)) return false;
  const day = holiday ? 6 : time.day; // Vodno holidays follow its weekend timetable.
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  return periods.some(period => period.days.includes(day) && time.minute >= minutes(period.from) && time.minute < minutes(period.to));
}

/** The operator's published SMS protocol for this zone, shaped like a verified sign protocol. */
export function officialSmsPayment(place: Pick<ParkingPlace, "id" | "kind">): VerifiedSmsPayment | null {
  const rules = officialZoneRules(place);
  if (!rules) return null;
  // Registry entries expire a year after checking, so stale rules stop rather than mislead.
  const dates = { confirmedAt: `${SKOPJE_RULES_CHECKED}T00:00:00.000Z`, expiresAt: `${Number(SKOPJE_RULES_CHECKED.slice(0, 4)) + 1}${SKOPJE_RULES_CHECKED.slice(4)}T00:00:00.000Z` };
  if (rules.operator === "gradski") return {
    ...OFFICIAL_SMS_FORMATS["144144"], destination: "144144", zoneCode: rules.token, plateFormat: "compact",
    allowedHours: null, maxStayMinutes: rules.maxStayMinutes, confidence: 1,
    evidence: { destinationText: "144 144", startExample: `${rules.token} SK1234AB`, samplePlate: "SK1234AB", sampleHours: null,
      stopExample: "S", stopInstructionText: "S → 144 144", durationText: rules.maxStayMinutes ? `${rules.maxStayMinutes / 60} h` : null },
    photoId: "official:gradski", ...dates, sourceUrl: OPERATOR_HELP.gradski.url,
  };
  // poc.mk documents "<zone> <PLATE> <duration>" (example "1 SK1234MM 2") but no duration range;
  // offering only its example's 1-2 hours is the app's own conservative limit.
  return {
    ...OFFICIAL_SMS_FORMATS["141414"], destination: "141414", zoneCode: rules.token, plateFormat: "compact",
    allowedHours: [1, 2], maxStayMinutes: null, confidence: 1,
    evidence: { destinationText: "14 14 14", startExample: `${rules.token} SK1234MM 2`, samplePlate: "SK1234MM", sampleHours: 2,
      stopExample: null, stopInstructionText: null, durationText: null },
    photoId: "official:poc", ...dates, sourceUrl: OPERATOR_HELP.poc.url,
  };
}
