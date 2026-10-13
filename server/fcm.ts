// Firebase Cloud Messaging HTTP v1: Android delivers server pushes only through FCM. WebCrypto signs the
// service account's token request, so this runs unchanged in Node and the Supabase (Deno) runtime.
export type ServiceAccount = { project_id: string; client_email: string; private_key: string };
export type FcmMessage = { title: string; body: string; data: Record<string, string>; channelId: string; tag: string };
type FcmError = { error?: { message?: string; details?: { errorCode?: string; fieldViolations?: { field?: string }[] }[] } };

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encoded = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

export async function serviceAccountJwt(account: ServiceAccount, now: number) {
  const der = Uint8Array.from(atob(account.private_key.replace(/-----[A-Z ]+-----|\s/g, "")), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const iat = Math.floor(now / 1000);
  const unsigned = `${encoded({ alg: "RS256", typ: "JWT" })}.${encoded({ iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: GOOGLE_TOKEN_URL, iat, exp: iat + 3600 })}`;
  return `${unsigned}.${base64url(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned))))}`;
}

// UNREGISTERED: the app was uninstalled or the token rotated. A malformed token or one from another
// Firebase project fails the same way on every retry.
function permanent(error: FcmError) {
  return Boolean(error.error?.details?.some(detail => detail.errorCode === "UNREGISTERED" || detail.errorCode === "SENDER_ID_MISMATCH" ||
    detail.fieldViolations?.some(violation => violation.field === "message.token")) || /registration token/i.test(error.error?.message ?? ""));
}

/** Rejections carry statusCode 410 when the device token is gone for good, 503 when a retry may work. */
export function createFcmSender(account: ServiceAccount, fetcher: typeof fetch = fetch, clock: () => number = Date.now) {
  let cached: { token: string; renewAt: number } | null = null, pending: Promise<string> | null = null;
  const accessToken = () => cached && cached.renewAt > clock() ? Promise.resolve(cached.token) : pending ??= (async () => {
    const response = await fetcher(GOOGLE_TOKEN_URL, {
      method: "POST", signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: await serviceAccountJwt(account, clock()) }).toString(),
    });
    if (!response.ok) throw Object.assign(new Error("Firebase sign-in failed."), { statusCode: 503 });
    const result = await response.json() as { access_token: string; expires_in: number };
    // Renew a few minutes early so a token never expires between reading it and sending.
    cached = { token: result.access_token, renewAt: clock() + Math.max(0, result.expires_in - 300) * 1000 };
    return cached.token;
  })().finally(() => { pending = null; });
  return async (token: string, message: FcmMessage) => {
    const response = await fetcher(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`, {
      method: "POST", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await accessToken()}` },
      body: JSON.stringify({ message: {
        token, notification: { title: message.title, body: message.body },
        // expo-notifications names a notification shown in the foreground by data.tag, so repeats replace it there too.
        data: { ...message.data, tag: message.tag },
        android: { priority: "high", ttl: "300s", notification: { channel_id: message.channelId, tag: message.tag } },
      } }),
    });
    if (response.ok) return;
    if (response.status === 401) cached = null;
    const error = await response.json().catch(() => ({})) as FcmError;
    throw Object.assign(new Error("Firebase did not accept the notification."), { statusCode: permanent(error) ? 410 : 503 });
  };
}

let configured: ReturnType<typeof createFcmSender> | null | undefined;
/** The FIREBASE_SERVICE_ACCOUNT secret (the key file's JSON), or null until it is set. */
export function fcmSender() {
  if (configured === undefined) {
    try {
      const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT ?? "null") as ServiceAccount | null;
      configured = account?.project_id && account.client_email && account.private_key ? createFcmSender(account) : null;
    } catch { configured = null; }
  }
  return configured;
}
