import { normalizeZoneCode } from "./parking";
import { officialSmsPayment } from "./skopje-rules";

export type SmsPaymentCandidate = {
  mode: "start-stop" | "fixed-hours";
  destination: string;
  zoneCode: string;
  plateFormat: "compact";
  startTemplate: string;
  stopTemplate: string | null;
  allowedHours: number[] | null;
  maxStayMinutes: number | null;
  confidence: number;
  evidence: {
    destinationText: string;
    startExample: string;
    samplePlate: string;
    sampleHours: number | null;
    stopExample: string | null;
    stopInstructionText: string | null;
    durationText: string | null;
  };
};
export type VerifiedSmsPayment = SmsPaymentCandidate & {
  /** A sign photo id, or "official:gradski" / "official:poc" for the operator's published rules. */
  photoId: string;
  confirmedAt: string;
  expiresAt: string;
  sourceUrl?: string;
};
export function smsZoneMatches(label: string | null | undefined, token: string | null | undefined) {
  if (!label || !token) return false;
  const normalized = normalizeZoneCode(label), printed = normalizeZoneCode(token);
  return normalized === printed || (/^POC\s*\d+$/i.test(label.trim()) && normalized.slice(3) === printed);
}
/** What a driver's phone would send: everything except evidence and provenance. */
export const smsRuleKey = (p: SmsPaymentCandidate) => JSON.stringify([p.mode, p.destination, p.zoneCode, p.plateFormat, p.startTemplate, p.stopTemplate, p.allowedHours ? [...p.allowedHours].sort((a, b) => a - b) : null, p.maxStayMinutes]);
export const isOfficialProtocol = (value: Pick<VerifiedSmsPayment, "photoId"> | null | undefined) => typeof value?.photoId === "string" && value.photoId.startsWith("official:");
/** An official protocol must equal the operator registry entry for its zone token. */
function isOfficialSmsPayment(value: VerifiedSmsPayment) {
  const operator = value.photoId === "official:gradski" ? "gradski" : value.photoId === "official:poc" ? "poc" : null;
  const expected = operator && officialSmsPayment({ kind: "zone", id: operator === "gradski" ? `gradski:zone:${value.zoneCode}` : `poc:zone:${value.zoneCode}:0` });
  return Boolean(expected) && smsRuleKey(expected!) === smsRuleKey(value) && expected!.confirmedAt === value.confirmedAt && expected!.expiresAt === value.expiresAt && expected!.sourceUrl === value.sourceUrl;
}

/** Only the operators' published rules can open an SMS composer; checked again before sending. */
export function isVerifiedSmsPayment(value: VerifiedSmsPayment | null | undefined, now = Date.now()): value is VerifiedSmsPayment {
  if (!value || typeof value.photoId !== "string" || !Number.isFinite(Date.parse(value.expiresAt))) return false;
  // Registry entries are checked by date only for expiry; a phone clock set slightly back must not hide them.
  return isOfficialProtocol(value) && isOfficialSmsPayment(value) && Date.parse(value.expiresAt) > now;
}
