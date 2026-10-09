import { ACCENT_POINTS, PALETTE_POINTS, eligibleCosmetics, type CosmeticsUpdate } from "../src/domain/cosmetics";
import type { Profile } from "../src/domain/account";
import { accountError } from "./account-security";

export function checkCosmetics(profile: Profile | null, update: CosmeticsUpdate) {
  if (!profile) throw accountError("Accept the current Terms of Service first.", 403);
  if (!Object.keys(update).length || Object.keys(update).some(key => key !== "palette" && key !== "accent"))
    throw accountError("Choose a palette or contribution accent.");
  for (const [kind, rules] of [["palette", PALETTE_POINTS], ["accent", ACCENT_POINTS]] as const) {
    const choice = update[kind];
    if (choice === undefined) continue;
    if (!Object.hasOwn(rules, choice)) throw accountError("Choose an available style.");
    if (profile.points < (rules as Record<string, number>)[choice])
      throw accountError("Earn more contribution points to unlock this style.", 403);
  }
  return { ...eligibleCosmetics(profile.points, profile.cosmetics?.palette, profile.cosmetics?.accent), ...update };
}

// Original creation only: reporting, labeling, or drawing an existing lot never transfers an accent.
// Sum points only for drivers who chose an accent; reward_events grows with every report.
export const CONTRIBUTION_COSMETICS_QUERY = `SELECT d.place_id,c.accent,
  (SELECT COALESCE(SUM(r.points),0) FROM reward_events r WHERE r.session_id=d.session_id) AS points
  FROM contribution_details d JOIN account_cosmetics c ON c.session_id=d.session_id
  WHERE c.accent<>'default'`;
export type ContributionCosmeticRow = { place_id: string; accent: string; points: number };
export function contributionAccents(rows: ContributionCosmeticRow[]) {
  return new Map(rows.flatMap(row => {
    const accent = eligibleCosmetics(Number(row.points), undefined, row.accent).accent;
    return accent === "default" ? [] : [[row.place_id, accent] as const];
  }));
}
