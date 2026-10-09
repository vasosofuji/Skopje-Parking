import type { Cosmetics } from "./cosmetics";
export const TERMS_VERSION = "2026-10-09";
export type Profile = {
  id: string;
  username: string;
  termsVersion: string;
  acceptedAt: string;
  secured: boolean;
  points: number;
  guest?: boolean;
  cosmetics?: Cosmetics;
};
export const REWARD_POINTS = {
  parking: 10,
  boundary: 20,
  pricing: 10,
  capacity: 10,
  sign: 25,
  availability: 3,
} as const;
export type RewardKind = keyof typeof REWARD_POINTS;
export type RewardEvent = {
  id: string;
  kind: RewardKind;
  points: number;
  createdAt: string;
};
export type Rewards = { total: number; events: RewardEvent[] };
export type AuthResult = { token: string; profile: Profile };
export function validPassword(value: string) {
  return value.length >= 10 && value.length <= 128 && value.trim().length >= 10;
}
export function cleanUsername(value: string) {
  return value.normalize("NFKC").trim();
}
export function usernameKey(value: string) {
  return cleanUsername(value).toLowerCase();
}
export function validUsername(value: string) {
  return /^[\p{L}\p{N}_]{3,20}$/u.test(cleanUsername(value));
}
