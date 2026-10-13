import { sessionCost, type ParkingSession } from "./parking-sessions";
import { POC_PRICES, type PocCardZone } from "./poc-cards";

// JP Gradski Parking price list, row "месечна претплата за користење на сите јавни површини наменети
// за паркирање во една зона" (monthly subscription for all public parking in one zone; A includes A0).
// https://www.gradskiparking.com.mk/javni-parkiralishta-i-zonsko.nspx, checked 2026-10-13.
// The same list's cheaper 4000/3000/2000/1000 monthly row does not state its coverage, so it is not used.
export const GRADSKI_MONTHLY_ZONE_PASS = { A: 4500, B: 3500, C: 2500, D: 1500 } as const;
export type GradskiPassZone = keyof typeof GRADSKI_MONTHLY_ZONE_PASS;
export type PassZone = { operator: "poc"; zone: PocCardZone } | { operator: "gradski"; zone: GradskiPassZone };
export type CardOffer = { key: string } & ({ kind: "visits"; operator: "poc"; zone: PocCardZone } | (PassZone & { kind: "paid"; visits: number; price: number; saving: number }));
export const PASS_WINDOW_MS = 7 * 86400000, PASS_COOLDOWN_MS = 30 * 86400000;
const VISIT_GAP_MS = 6 * 3600000;

/** The zone a monthly card would cover. The seeded zone id decides, then the operator's zone token. */
export function passZone(session: Pick<ParkingSession, "placeId" | "operator" | "zoneCode">): PassZone | null {
  const code = session.zoneCode.toUpperCase().replace(/\s/g, "");
  const gradski = /^gradski:zone:([A-D])\d{1,2}$/.exec(session.placeId)?.[1] ?? (session.operator === "gradski" ? /^([A-D])\d{1,2}$/.exec(code)?.[1] : undefined);
  if (gradski) return { operator: "gradski", zone: gradski as GradskiPassZone };
  const poc = /^poc:zone:([12]):\d+$/.exec(session.placeId)?.[1] ?? (session.operator === "poc" ? /^(?:POC)?(1|2|I|II)$/.exec(code)?.[1] : undefined);
  return poc ? { operator: "poc", zone: poc === "1" || poc === "I" ? "I" : "II" } : null;
}
const passKey = (zone: PassZone) => `${zone.operator}:${zone.zone}`;

export function readCardPrompts(raw: string | null, now: number): Record<string, number> {
  try {
    const data = JSON.parse(raw ?? "{}");
    return Object.fromEntries(Object.entries(data && typeof data === "object" && !Array.isArray(data) ? data : {})
      .filter((entry): entry is [string, number] => Number.isFinite(entry[1]) && (entry[1] as number) <= now && now - (entry[1] as number) < PASS_COOLDOWN_MS));
  } catch { return {}; }
}

/**
 * The card prompt to show, at most once per zone per cooldown. Paid sessions are the stronger
 * signal: 3+ separate visits in 7 days whose cost, projected to a month, exceeds the monthly card.
 * Unknown prices count as 0, so the saving is never overstated. Recorded visits are the fallback.
 */
export function cardOffer(sessions: ParkingSession[], now: number, prompts: Record<string, number>, visitZone: PocCardZone | null = null): CardOffer | null {
  const groups = new Map<string, { zone: PassZone; sessions: ParkingSession[] }>();
  for (const session of sessions) {
    const zone = session.startedAt <= now && now - session.startedAt < PASS_WINDOW_MS ? passZone(session) : null;
    if (!zone || passKey(zone) in prompts) continue;
    const group = groups.get(passKey(zone)) ?? { zone, sessions: [] };
    group.sessions.push(session);
    groups.set(passKey(zone), group);
  }
  let best: CardOffer | null = null;
  for (const [key, { zone, sessions: paid }] of groups) {
    // An extension or re-park within a few hours is the same visit.
    let visits = 0, last = -Infinity;
    for (const session of [...paid].sort((a, b) => a.startedAt - b.startedAt)) if (session.startedAt - last >= VISIT_GAP_MS) { visits++; last = session.startedAt; }
    const price = zone.operator === "poc" ? POC_PRICES[zone.zone].monthly : GRADSKI_MONTHLY_ZONE_PASS[zone.zone];
    const projected = paid.reduce((sum, session) => sum + (sessionCost(session, now) ?? 0), 0) * 30 / 7;
    const saving = Math.floor((projected - price) / 10) * 10;
    if (visits >= 3 && saving > 0 && (!best || best.kind !== "paid" || saving > best.saving)) best = { ...zone, kind: "paid", key, visits, price, saving };
  }
  if (best || !visitZone || `poc:${visitZone}` in prompts) return best;
  return { kind: "visits", key: `poc:${visitZone}`, operator: "poc", zone: visitZone };
}
