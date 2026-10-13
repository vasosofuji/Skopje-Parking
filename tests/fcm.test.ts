import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { createFcmSender, GOOGLE_TOKEN_URL, serviceAccountJwt } from "../server/fcm";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const account = { project_id: "skopje-parking", client_email: "push@skopje-parking.iam.gserviceaccount.com", private_key: privateKey };
const message = { title: "Title", body: "Body", channelId: "parking-spots", tag: "parking-spot-opening:p1", data: { kind: "parking-spot-opening", placeId: "p1" } };
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString());

test("the service account JWT is RS256, signed by the key and scoped to Firebase messaging for an hour", async () => {
  const now = Date.parse("2026-10-13T10:00:00Z");
  const [header, claims, signature] = (await serviceAccountJwt(account, now)).split(".");
  assert.deepEqual(decode(header), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(decode(claims), { iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: GOOGLE_TOKEN_URL, iat: now / 1000, exp: now / 1000 + 3600 });
  assert.equal(verify("RSA-SHA256", Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, "base64url")), true);
});

test("FCM sends a high-priority notification with string data, caches its access token and sorts out dead tokens", async () => {
  let now = Date.parse("2026-10-13T10:00:00Z"), tokens = 0, reply: () => Response = () => new Response("{}");
  const sends: { url: string; authorization: string; body: { message: Record<string, unknown> } }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    if (url === GOOGLE_TOKEN_URL) {
      const form = new URLSearchParams(String(init.body));
      assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
      assert.equal(form.get("assertion")!.split(".").length, 3);
      await new Promise(resolve => setTimeout(resolve, 5));
      return new Response(JSON.stringify({ access_token: `access-${++tokens}`, expires_in: 3600 }));
    }
    sends.push({ url, authorization: (init.headers as Record<string, string>).Authorization, body: JSON.parse(String(init.body)) });
    return reply();
  }) as typeof fetch;
  const send = createFcmSender(account, fetcher, () => now);
  await Promise.all([send("device-token", message), send("device-token", message)]);
  assert.equal(tokens, 1, "concurrent first sends share one token request");
  assert.equal(sends[0].url, "https://fcm.googleapis.com/v1/projects/skopje-parking/messages:send");
  assert.equal(sends[0].authorization, "Bearer access-1");
  assert.deepEqual(sends[0].body.message, {
    token: "device-token", notification: { title: "Title", body: "Body" },
    data: { kind: "parking-spot-opening", placeId: "p1", tag: "parking-spot-opening:p1" },
    android: { priority: "high", ttl: "300s", notification: { channel_id: "parking-spots", tag: "parking-spot-opening:p1" } },
  });
  now += 50 * 60000;
  await send("device-token", message);
  assert.equal(tokens, 1, "a cached token is reused until shortly before it expires");
  now += 6 * 60000;
  await send("device-token", message);
  assert.equal(tokens, 2, "renewed 5 minutes before expiry");

  const failure = async (status: number, error: object) => {
    reply = () => new Response(JSON.stringify({ error }), { status });
    return send("device-token", message).then(() => 0, (rejected: { statusCode: number }) => rejected.statusCode);
  };
  assert.equal(await failure(404, { status: "NOT_FOUND", details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }] }), 410);
  assert.equal(await failure(400, { status: "INVALID_ARGUMENT", message: "The registration token is not a valid FCM registration token" }), 410);
  assert.equal(await failure(400, { status: "INVALID_ARGUMENT", details: [{ "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [{ field: "message.token" }] }] }), 410);
  assert.equal(await failure(403, { status: "PERMISSION_DENIED", details: [{ errorCode: "SENDER_ID_MISMATCH" }] }), 410);
  assert.equal(await failure(503, { status: "UNAVAILABLE", details: [{ errorCode: "UNAVAILABLE" }] }), 503, "provider outages retry");
  assert.equal(await failure(429, { status: "RESOURCE_EXHAUSTED", details: [{ errorCode: "QUOTA_EXCEEDED" }] }), 503);
  assert.equal(await failure(401, { status: "UNAUTHENTICATED" }), 503);
  reply = () => new Response("{}");
  await send("device-token", message);
  assert.equal(tokens, 3, "a rejected access token is replaced");
});
