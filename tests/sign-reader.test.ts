import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { ParkingStore } from "../server/store";
import { PostgresParkingStore } from "../server/postgres/store";
import { postgresSql, type StoreDatabase } from "../server/postgres/database";
import { buildApp } from "../server/app";
import { readSignWith, SIGN_PROMPT, SIGN_READING_SCHEMA } from "../src/domain/sign-reading";
import { guessProvider, readSignOnDevice, SignReaderError, testSignReader } from "../src/services/signReader";
import { zoneGeometry } from "../src/domain/geometry";
import type { Catalog, Contribution, SignInfo } from "../src/domain/types";

const reading: SignInfo = {
  isParkingSign: true, confidence: 0.97, zoneCode: "B2", operator: "Gradski", currency: "MKD", firstHour: 30, nextHour: 30,
  maxStayMinutes: null, chargingHours: "Mon-Sat 07:00-23:00", freeWeekends: "sunday", paymentInstructions: "SMS 144 144", restrictions: null,
  rawText: "ЗОНА B2\n144 144\nB2 SK1234AB\nЗа крај испратете S на 144 144",
};
const image = { base64: "aW1hZ2U=", mimeType: "image/jpeg" };

test("the provider schema is strict: every field required and nullable, no extra keys, ranges enforced locally", () => {
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    for (const banned of ["maxLength", "minimum", "maximum", "pattern", "$schema"]) assert.equal(banned in node, false, banned);
    if (node.type === "object") { assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort()); assert.equal(node.additionalProperties, false); }
    Object.values(node).forEach(walk);
  };
  walk(SIGN_READING_SCHEMA);
  assert.equal("smsPayment" in (SIGN_READING_SCHEMA as any).properties, false, "SMS rules come only from the operators, never from a photo");
});

test("one AI reading is validated; range limits stripped from the provider schema still apply", async () => {
  const prompts: string[] = [];
  const answer = (value: unknown) => async (prompt: string) => { prompts.push(prompt); return JSON.stringify(value); };
  assert.deepEqual(await readSignWith(answer(reading)), reading);
  assert.deepEqual(prompts, [SIGN_PROMPT]);
  await assert.rejects(readSignWith(answer({ ...reading, firstHour: -5 })));
  await assert.rejects(readSignWith(answer({ ...reading, zoneCode: null, firstHour: null, nextHour: null, chargingHours: null, paymentInstructions: null, rawText: "" })), /Empty sign reading/);
});

test("device reader calls Gemini or Groq directly with the driver's key, never Skopje Parking", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const gemini = async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init: init! }); return calls.length === 1 ? respond(404, {}) : respond(200, { status: "completed", output_text: JSON.stringify(reading) }); };
  const result = await readSignOnDevice(image, { provider: "gemini", key: "AIzaSyTESTKEY000000000000000000000000000" }, gemini as typeof fetch);
  assert.deepEqual(result, { info: reading, model: "gemini:gemini-3.7-flash" }, "a retired model falls back to the next");
  assert.ok(calls.every(call => call.url === "https://generativelanguage.googleapis.com/v1beta/interactions"));
  const body = JSON.parse(String(calls[1].init.body));
  assert.equal((calls[1].init.headers as Record<string, string>)["x-goog-api-key"], "AIzaSyTESTKEY000000000000000000000000000");
  assert.equal(body.store, false); assert.deepEqual(body.input[1], { type: "image", mime_type: "image/jpeg", data: "aW1hZ2U=" });
  assert.deepEqual(body.response_format.schema, SIGN_READING_SCHEMA);
  calls.length = 0;
  const groq = async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init: init! }); return respond(200, { choices: [{ message: { content: JSON.stringify(reading) } }] }); };
  assert.equal((await readSignOnDevice(image, { provider: "groq", key: "gsk_TESTKEY0000000000000000" }, groq as typeof fetch)).model, "groq:qwen/qwen3.8-27b");
  const groqBody = JSON.parse(String(calls[0].init.body));
  assert.equal(calls[0].url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer gsk_TESTKEY0000000000000000");
  assert.equal(groqBody.response_format.json_schema.strict, true);
  assert.equal(groqBody.messages[0].content[1].image_url.url, "data:image/jpeg;base64,aW1hZ2U=");
  // A rejected key or exhausted quota stops at once instead of trying other models on the same account.
  for (const [status, kind] of [[401, "key"], [429, "quota"]] as const) {
    calls.length = 0;
    const failing = async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init: init! }); return respond(status, { error: "x" }); };
    await assert.rejects(readSignOnDevice(image, { provider: "gemini", key: "AIzaSyTESTKEY000000000000000000000000000" }, failing as typeof fetch), (error: unknown) => error instanceof SignReaderError && error.kind === kind);
    assert.equal(calls.length, 1);
  }
  assert.equal(await testSignReader({ provider: "groq", key: "gsk_TESTKEY0000000000000000" }, (async () => respond(401, {})) as typeof fetch), "key");
  assert.equal(await testSignReader({ provider: "gemini", key: "AIzaSyTESTKEY000000000000000000000000000" }, (async () => respond(200, { models: [] })) as typeof fetch), "ok");
  assert.equal(guessProvider(" gsk_abc"), "groq"); assert.equal(guessProvider("AIzaXYZ"), "gemini"); assert.equal(guessProvider("sk-other"), null);
});

const catalog: Catalog = { generatedAt: new Date().toISOString(), places: [], zones: [], destinations: [], coverage: { complete: false, bounds: [], notes: [] } };
const points = [{ latitude: 41.996, longitude: 21.432 }, { latitude: 41.997, longitude: 21.432 }, { latitude: 41.997, longitude: 21.433 }, { latitude: 41.996, longitude: 21.433 }];
const contribution: Contribution = { requestId: "reader-request-1", name: "Reader zone", coordinate: points[0], geometry: zoneGeometry(points), kind: "zone", zoneCode: "B2", firstHour: 30, nextHour: 30 };
const photo = { mimeType: "image/png" as const, base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGqkAAAAASUVORK5CYII=" };

async function backendStore(backend: "sqlite" | "postgres") {
  if (backend === "sqlite") return new ParkingStore(":memory:", catalog);
  const pg = await PGlite.create({ parsers: { 20: Number } });
  for (const file of readdirSync("supabase/migrations").filter(f => f.endsWith(".sql")).sort()) await pg.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  const local = new AsyncLocalStorage<Transaction>();
  const db: StoreDatabase = { prepare(sql) { const query = (v: unknown[]) => (local.getStore() ?? pg).query(postgresSql(sql), v); return { run: (...v) => query(v), get: async (...v) => (await query(v)).rows[0], all: async (...v) => (await query(v)).rows }; }, transaction: work => local.getStore() ? work() : pg.transaction(tx => local.run(tx, work)), close: () => pg.close() };
  const store = new PostgresParkingStore(db, Date.now, true); await store.seed(catalog);
  return store;
}

for (const backend of ["sqlite", "postgres"] as const) test(`${backend}: only confirmed sign details are accepted, never a photo; any driver can add them`, async () => {
  const store = await backendStore(backend);
  const app = await buildApp(catalog, store);
  try {
    const session = async () => ({ authorization: `Bearer ${(await app.inject({ method: "POST", url: "/v1/sessions" })).json().token}` });
    const owner = await session(), other = await session();
    const place = (await app.inject({ method: "POST", url: "/v1/contributions", headers: owner, payload: contribution })).json();
    const add = (headers: Record<string, string>, payload: object) => app.inject({ method: "POST", url: `/v1/places/${place.id}/signs`, headers, payload: payload as Record<string, unknown> });
    assert.equal((await add(owner, { info: reading, model: "openai:gpt" })).statusCode, 400);
    assert.equal((await add(owner, { info: { ...reading, firstHour: -1 } })).statusCode, 400);
    assert.equal((await add(owner, { info: reading, base64: image.base64 })).statusCode, 400, "photos are never accepted");
    assert.equal((await add(owner, { info: { ...reading, smsPayment: { destination: "141515" } } })).statusCode, 400, "no SMS rules from photos");
    const saved = await add(owner, { info: reading, model: "ocr:mlkit-text-v2" });
    assert.equal(saved.statusCode, 201, saved.body);
    assert.equal((await add(other, { info: { ...reading, firstHour: 40, nextHour: 40 }, model: "gemini:gemini-3.8-flash" })).statusCode, 201);
    const shown = (await app.inject("/v1/catalog")).json().places.find((value: { id: string }) => value.id === place.id);
    assert.equal(shown.signInfo.firstHour, 40, "the latest confirmed reading is the public sign");
    assert.equal(shown.signInfo.model, "gemini:gemini-3.8-flash"); assert.equal(shown.signReadingCount, 2);
  } finally { await app.close(); }
});

for (const backend of ["sqlite", "postgres"] as const) test(`${backend}: reported sign details hide after two reports and stay hidden until an admin decides`, async () => {
  const store = await backendStore(backend);
  const app = await buildApp(catalog, store, { adminKey: "admin-secret-key-123456" });
  try {
    const session = async () => ({ authorization: `Bearer ${(await app.inject({ method: "POST", url: "/v1/sessions" })).json().token}` });
    const owner = await session(), first = await session(), second = await session();
    const admin = { authorization: "Bearer admin-secret-key-123456" };
    const place = (await app.inject({ method: "POST", url: "/v1/contributions", headers: owner, payload: { ...contribution, requestId: `flag-${backend}` } })).json();
    const id = (await app.inject({ method: "POST", url: `/v1/places/${place.id}/signs`, headers: owner, payload: { info: reading } })).json().id;
    const shown = async () => (await app.inject("/v1/catalog")).json().places.find((value: { id: string }) => value.id === place.id).signInfo?.readingId;
    const flag = (headers: Record<string, string>, reason: string) => app.inject({ method: "POST", url: `/v1/signs/${id}/flag`, headers, payload: { reason } });
    assert.equal((await flag(first, "rude")).statusCode, 400);
    assert.equal((await flag(first, "wrong")).statusCode, 200);
    assert.equal((await flag(first, "spam")).statusCode, 200, "repeat reports by one person count once");
    assert.equal(await shown(), id, "one report is not enough to hide it");
    await flag(second, "offensive");
    assert.equal(await shown(), undefined);
    assert.equal((await app.inject({ url: "/v1/admin/flags", headers: first })).statusCode, 401);
    const flagged = (await app.inject({ url: "/v1/admin/flags", headers: admin })).json();
    assert.equal(flagged[0].reading_id, id); assert.equal(Number(flagged[0].reports), 2);
    assert.equal((await app.inject({ method: "DELETE", url: `/v1/admin/signs/${id}/flags`, headers: admin })).statusCode, 200);
    assert.equal(await shown(), id, "cleared reports restore the details");
    assert.equal((await app.inject({ method: "DELETE", url: `/v1/admin/signs/${id}`, headers: first })).statusCode, 401);
    await app.inject({ method: "DELETE", url: `/v1/admin/signs/${id}`, headers: admin });
    assert.equal(await shown(), undefined, "removed details are gone");
  } finally { await app.close(); }
});
