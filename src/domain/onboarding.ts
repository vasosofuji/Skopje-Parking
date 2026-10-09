import { cleanUsername, TERMS_VERSION, validPassword, validUsername, type Profile } from "./account";

export const PREFERENCES_SETUP_KEY = "parkskopje-preferences-setup";
export type OnboardingStep = "language" | "theme" | "account";
export type OnboardingIntent =
  | { mode: "guest" }
  | { mode: "create" | "login"; username: string; password: string };

export function initialOnboardingStep(saved: string | null): OnboardingStep {
  return saved === "1" ? "account" : "language";
}
export function hasCurrentTerms(profile: Pick<Profile, "termsVersion"> | null) {
  return profile?.termsVersion === TERMS_VERSION;
}

/** Returning accounts authenticate first; the saved profile decides whether renewed consent is needed. */
export async function completeOnboarding(
  intent: OnboardingIntent,
  accepted: boolean,
  actions: {
    guest: (accepted: boolean) => Promise<void>;
    register: (username: string, accepted: boolean, password: string) => Promise<void>;
    login: (username: string, password: string, accepted: boolean) => Promise<void>;
  },
) {
  if (!accepted && intent.mode !== "login") throw new Error("Terms must be accepted.");
  if (intent.mode === "guest") return actions.guest(true);
  const username = cleanUsername(intent.username);
  if (!validUsername(username)) throw new Error("Enter a valid username.");
  if (intent.mode === "create") {
    if (!validPassword(intent.password)) throw new Error("Use 10-128 characters for your password.");
    return actions.register(username, true, intent.password);
  }
  if (!intent.password || intent.password.length > 128) throw new Error("Enter your password.");
  return actions.login(username, intent.password, accepted);
}
