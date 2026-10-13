import { sessionCost, sessionEffectiveEnd, type ParkingSession } from "./parking-sessions";
import { skopjeTime } from "./skopje-rules";

/** Estimated MKD; sessions without a known price are counted but never guessed. */
export type SpendingTotal = { key: string; label: string; total: number; count: number; unknown: number };
const monthOf = (time: number) => skopjeTime(time).date.slice(0, 7);
export const sessionZoneLabel = (s: ParkingSession) => !s.zoneName || s.zoneName === s.zoneCode ? s.zoneCode : s.zoneName.includes(s.zoneCode) ? s.zoneName : `${s.zoneCode} · ${s.zoneName}`;
/** Hours bought, else minutes until the session's effective end, matching sessionCost. */
export const sessionMinutes = (s: ParkingSession, now: number) =>
  s.paidHours !== null ? s.paidHours * 60 : Math.max(0, Math.round((sessionEffectiveEnd(s, now) - s.startedAt) / 60000));

/** Totals per Skopje calendar month (newest first) and per zone (highest first). */
export function spendingSummary(sessions: ParkingSession[], now: number) {
  const months = new Map<string, SpendingTotal>(), zones = new Map<string, SpendingTotal>();
  const add = (map: Map<string, SpendingTotal>, key: string, label: string, cost: number | null) => {
    const row = map.get(key) ?? { key, label, total: 0, count: 0, unknown: 0 };
    row.count++;
    if (cost === null) row.unknown++; else row.total += cost;
    map.set(key, row);
  };
  for (const session of sessions) {
    const cost = sessionCost(session, now), month = monthOf(session.startedAt);
    add(months, month, month, cost);
    add(zones, `${session.operator ?? ""}:${session.zoneCode}`, sessionZoneLabel(session), cost);
  }
  const current = monthOf(now);
  return {
    thisMonth: months.get(current) ?? { key: current, label: current, total: 0, count: 0, unknown: 0 },
    previousMonths: [...months.values()].filter(row => row.key < current).sort((a, b) => b.key.localeCompare(a.key)),
    zones: [...zones.values()].sort((a, b) => b.total - a.total || b.count - a.count),
  };
}
