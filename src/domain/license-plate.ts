/** Macedonian plates: two city letters, four (older series: three) digits and two serial letters. */
export function isCompactLicensePlate(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{2}\d{3,4}[A-Z]{2}$/.test(value);
}

/** Accept familiar pasted spacing, but always store and send the compact format. */
export function normalizeLicensePlate(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 24 || !/^[A-Za-z0-9 -]+$/.test(value)) return null;
  const plate = value.toUpperCase().replace(/[ -]/g, "");
  return isCompactLicensePlate(plate) ? plate : null;
}

export function validSmsDraft(recipient: unknown, message: unknown): recipient is string {
  return typeof recipient === "string" && /^\d{3,15}$/.test(recipient) &&
    typeof message === "string" && /^[A-Za-z0-9 -]{1,160}$/.test(message) && message.trim().length > 0;
}

export function smsDraftUri(recipient: string, message: string, ios: boolean): string | null {
  return validSmsDraft(recipient, message) ? `sms:${recipient}${ios ? "&" : "?"}body=${encodeURIComponent(message)}` : null;
}

export type PendingSmsStop = {
  zoneId: string; zoneName: string; recipient: string; stopMessage: string; photoId: string;
  protocolExpiresAt: string; openedAt: number; plate: string;
};
export function validPendingSmsStop(value: unknown): value is PendingSmsStop {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<PendingSmsStop>;
  return [p.zoneId, p.zoneName, p.photoId].every(v => typeof v === "string" && v.length > 0 && v.length <= 256 && !/[\u0000-\u001f\u007f]/.test(v)) &&
    validSmsDraft(p.recipient, p.stopMessage) && normalizeLicensePlate(p.plate) === p.plate &&
    typeof p.protocolExpiresAt === "string" && Number.isFinite(Date.parse(p.protocolExpiresAt)) &&
    typeof p.openedAt === "number" && Number.isFinite(p.openedAt) && p.openedAt > 0;
}
