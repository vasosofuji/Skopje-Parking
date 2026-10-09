import { acknowledgeParkingReport, captureArrivalAccount } from "./arrivalStorage";
import { credentials } from "./credentials";
import { TERMS_VERSION, type Profile, type Rewards } from "../domain/account";
import type { CosmeticsUpdate } from "../domain/cosmetics";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { createTransport } from "./transport";
import { createSessionManager } from "./session";
import { apiEndpoint } from "./apiEndpoint";
import type { CatalogChanges } from "../domain/catalog-cache";
import type {
  Availability,
  PaymentSchedule,
  Geometry,
  Proposal,
  Destination,
  Contribution,
  ParkingPlace,
  SignReading,
  SignInfo,
  VerifiedSmsPayment,
} from "../domain/types";
const developmentHost =
  Constants.expoConfig?.hostUri?.split(":")[0] ?? "localhost";
// React Native aliases `window` to its global object; it has no browser location.
const webHost = Platform.OS === "web" && typeof window !== "undefined"
  ? window.location?.hostname ?? "localhost"
  : "localhost";
const API = apiEndpoint({
  configured: process.env.EXPO_PUBLIC_API_URL,
  development: process.env.NODE_ENV !== "production",
  host: Platform.OS === "web" ? webHost : developmentHost,
  usbTest: Constants.expoConfig?.extra?.usbTest === true,
});
const transport = createTransport(API);
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (process.env.EXPO_PUBLIC_OFFLINE_PREVIEW === "1") {
    throw new Error(
      "This APK is a catalog preview. Live reports need a connected parking API.",
    );
  }
  return transport<T>(path, init);
}
const sessions = createSessionManager(credentials, () => request<{ token: string }>("/v1/sessions", { method: "POST" }));
async function authenticated<T>(
  path: string,
  body?: unknown,
  method = "POST",
  boundToken?: string,
): Promise<T> {
  const token = boundToken ?? await sessions.get();
  try {
    return await request<T>(path, {
      method,
      headers: { Authorization: "Bearer " + token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "A valid session is required."
    ) {
      await sessions.invalidate(token);
    }
    throw error;
  }
}
async function parkingReportWrite<T>(id: string, suffix: string, body: unknown): Promise<T> {
  const version = sessions.generation(), token = await sessions.get(), accountId = await captureArrivalAccount().catch(() => null);
  if (version !== sessions.generation()) throw new Error("Your sign-in changed. Reopen this entry to continue.");
  const result = await authenticated<T>(`/v1/places/${encodeURIComponent(id)}/${suffix}`, body, "POST", token);
  // Storage failure must not make a successfully submitted report look failed.
  await acknowledgeParkingReport(id, accountId).catch(() => {});
  return result;
}
/** Shared reads carry the session when there is one, so their rate limit follows the account
 * instead of a carrier IP that many drivers share (CGNAT). */
async function read<T>(path: string): Promise<T> {
  const token = await sessions.current().catch(() => null);
  return request<T>(path, token ? { headers: { Authorization: "Bearer " + token } } : undefined);
}
export const api = {
  destinationWatcher: async () => {
    const version = sessions.generation(), token = await sessions.get();
    function bound<T>(body: unknown, method: string) {
      if (version !== sessions.generation()) return Promise.reject(new Error("Your sign-in changed. Tap Go again to enable destination alerts."));
      return authenticated<T>("/v1/notifications/destination", body, method, token);
    }
    return {
      start: (placeId: string, language: "en" | "mk", target: { type: "expo"; token: string } | { type: "web"; subscription: { endpoint: string; keys: { p256dh: string; auth: string } } }) => bound<{ expiresAt: number }>({ placeId, language, target }, "PUT"),
      stop: () => bound(undefined, "DELETE"),
    };
  },
  notificationConfig: () => request<{ webPushPublicKey: string | null }>("/v1/notifications/config"),
  watchDestination: (placeId: string, language: "en" | "mk", target: { type: "expo"; token: string } | { type: "web"; subscription: { endpoint: string; keys: { p256dh: string; auth: string } } }) =>
    authenticated<{ expiresAt: number }>("/v1/notifications/destination", { placeId, language, target }, "PUT"),
  stopDestinationWatch: () => authenticated<{ ok: boolean }>("/v1/notifications/destination", undefined, "DELETE"),
  removal: (id: string) => authenticated<{ canRemove: boolean }>(`/v1/places/${encodeURIComponent(id)}/removal`, undefined, "GET"),
  removeParking: (id: string) => authenticated<{ deleted: true }>(`/v1/places/${encodeURIComponent(id)}`, { confirmed: true }, "DELETE"),
  progressiveWriter: async () => {
    const version = sessions.generation(), token = await sessions.get(), accountId = await captureArrivalAccount().catch(() => null);
    function bound<T>(path: string, body: unknown, method = "POST") {
      if (version !== sessions.generation()) return Promise.reject(new Error("Your sign-in changed. Reopen this entry to continue."));
      return authenticated<T>(path, body, method, token);
    }
    async function reportWrite(id: string, suffix: string, body: unknown) {
      const result = await bound(path(id, suffix), body);
      await acknowledgeParkingReport(id, accountId).catch(() => {});
      return result;
    }
    const path = (id: string, suffix: string) => `/v1/places/${encodeURIComponent(id)}/${suffix}`;
    return {
      contribute: (value: Contribution) => bound<ParkingPlace>("/v1/contributions", value),
      label: (id: string, zoneCode: string) => bound(path(id, "labels"), { zoneCode }),
      price: (id: string, firstHour: number, nextHour: number) => reportWrite(id, "prices", { firstHour, nextHour }),
      paymentSchedule: (id: string, value: PaymentSchedule) => bound(path(id, "payment-schedule"), value, "PUT"),
      capacity: (id: string, capacity: number) => bound(path(id, "capacity"), { capacity }, "PUT"),
      report: (id: string, status: "spaces" | "full", freeSpaces?: number) => reportWrite(id, "reports", { status, freeSpaces }),
      boundary: (id: string, geometry: Geometry) => bound(path(id, "boundary"), geometry, "PUT"),
    };
  },
  guest: (accepted: boolean) => authenticated<Profile>("/v1/auth/guest", { accepted, termsVersion: TERMS_VERSION }),
  rewards: () => authenticated<Rewards>("/v1/rewards", undefined, "GET"),
  cosmetics: (update: CosmeticsUpdate) => authenticated<Profile>("/v1/profile/cosmetics", update, "PUT"),
  profile: async () => {
    const token = await sessions.current();
    if (!token) return null;
    return authenticated<Profile | null>("/v1/profile", undefined, "GET");
  },
  usernameAvailable: (username: string) => request<{ available: boolean }>(`/v1/usernames/availability?username=${encodeURIComponent(username)}`),
  register: (username: string, accepted: boolean, password?: string) => authenticated<Profile>("/v1/profile", { username, accepted, password, termsVersion: TERMS_VERSION }),
  login: async (username: string, password: string, accepted: boolean) => {
    const version = sessions.generation();
    const previousToken = await sessions.current();
    if (previousToken) await authenticated("/v1/notifications/destination", undefined, "DELETE", previousToken).catch(() => {});
    const result = await request<{token:string;profile:Profile}>("/v1/auth/login", {method:"POST", body:JSON.stringify({username,password,...(accepted ? {accepted:true,termsVersion:TERMS_VERSION} : {})})});
    await sessions.replace(result.token, version);
    return result.profile;
  },
  secureAccount: async (password: string) => {
    const version = sessions.generation();
    const result = await authenticated<{token:string;profile:Profile}>("/v1/auth/password", {password});
    await sessions.replace(result.token, version);
    return result.profile;
  },
  logout: async () => {
    const token = await sessions.get();
    await authenticated("/v1/auth/logout", undefined, "POST", token);
    await sessions.invalidate(token);
  },
  boundary: (id: string, geometry: Geometry) =>
    authenticated(`/v1/places/${encodeURIComponent(id)}/boundary`, geometry, "PUT"),
  capacity: (id: string, capacity: number) => authenticated(`/v1/places/${encodeURIComponent(id)}/capacity`, {capacity}, "PUT"),
  contribute: (value: Contribution) =>
    authenticated<ParkingPlace>("/v1/contributions", value),
  label: (id: string, zoneCode: string) =>
    authenticated(`/v1/places/${encodeURIComponent(id)}/labels`, { zoneCode }),
  /** Only the details confirmed on this phone are sent; sign photos never leave it. */
  addSignReading: (placeId: string, info: SignInfo, model: string) => authenticated<SignReading>(`/v1/places/${encodeURIComponent(placeId)}/signs`, { info, model }),
  flagSign: (readingId: string, reason: "offensive" | "personal" | "spam" | "wrong") => authenticated<{ flagged: true }>(`/v1/signs/${encodeURIComponent(readingId)}/flag`, { reason }),
  smsPayment: (id: string) => authenticated<{ place: ParkingPlace; protocol: VerifiedSmsPayment | null }>(`/v1/places/${encodeURIComponent(id)}/sms-payment`, undefined, "GET"),
  /** Places changed since a cursor (all places when since = 0). Keyed to the account, not a shared carrier IP. */
  changes: (since: number) => read<CatalogChanges>(`/v1/changes?since=${since}`),
  search: (query: string) =>
    request<Destination[]>(`/v1/search?q=${encodeURIComponent(query)}`),
  proposals: () => read<Proposal[]>("/v1/proposals"),
  price: (id: string, firstHour: number, nextHour: number) =>
    parkingReportWrite(id, "prices", { firstHour, nextHour }),
  confirm: (id: string, present: boolean) =>
    authenticated(`/v1/places/${encodeURIComponent(id)}/confirmations`, {
      present,
    }),
  report: (id: string, status: "spaces" | "full", freeSpaces?: number) =>
    parkingReportWrite<Availability>(id, "reports", { status, freeSpaces }),
  propose: (
    value: Pick<Proposal, "name" | "coordinate" | "kind" | "zoneCode" | "note">,
  ) => authenticated<Proposal>("/v1/proposals", value),
  vote: (id: string) =>
    authenticated<Proposal>(`/v1/proposals/${encodeURIComponent(id)}/votes`),
  deleteSession: async () => {
    const token = await sessions.get();
    await authenticated("/v1/sessions/me", undefined, "DELETE", token);
    await sessions.invalidate(token);
  },
};
