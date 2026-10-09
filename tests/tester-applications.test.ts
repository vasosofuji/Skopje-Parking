import test from "node:test";
import assert from "node:assert/strict";
import { ParkingStore } from "../server/store";
import { buildApp } from "../server/app";
import seed from "../data/catalog.json";
import type { Catalog } from "../src/domain/types";

const form = { name: "Ana Petrova", email: "ana.petrova@gmail.com", phone: "+389 70 123 456", licence: "yes", car: "no" };

test("tester applications go to Telegram without a session, and bad or bot input never does", async t => {
  const sent: { url: string; body: { chat_id: string; text: string } }[] = [];
  let ok = true;
  t.mock.method(globalThis, "fetch", async (url: string, init: { body: string }) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok }), { status: ok ? 200 : 500 });
  });
  const app = await buildApp(seed as Catalog, new ParkingStore(":memory:", seed as Catalog), { telegram: { token: "123:abc", chatId: "42" } });
  try {
    const post = (payload: object) => app.inject({ method: "POST", url: "/v1/tester-applications", payload });
    assert.equal((await post(form)).statusCode, 201);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, "https://api.telegram.org/bot123:abc/sendMessage");
    assert.equal(sent[0].body.chat_id, "42");
    assert.match(sent[0].body.text, /Google account: ana\.petrova@gmail\.com/);
    assert.match(sent[0].body.text, /Driving licence: Yes\nCar: No/);
    for (const bad of [{ ...form, email: "nope" }, { ...form, phone: "call me" }, { ...form, car: "maybe" }, { ...form, extra: "x" }])
      assert.equal((await post(bad)).statusCode, 400);
    assert.equal((await post({ ...form, website: "http://spam.example" })).statusCode, 201, "bots get a quiet success");
    assert.equal(sent.length, 1);
    ok = false;
    assert.equal((await post(form)).statusCode, 502, "a lost application is reported so the person can retry");
  } finally { await app.close(); }
  const closed = await buildApp(seed as Catalog, new ParkingStore(":memory:", seed as Catalog));
  try { assert.equal((await closed.inject({ method: "POST", url: "/v1/tester-applications", payload: form })).statusCode, 503); }
  finally { await closed.close(); }
});
