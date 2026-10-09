import { useSyncExternalStore } from "react";
import type { SignInfo } from "../domain/types";
import { readSignWith, SIGN_READING_SCHEMA } from "../domain/sign-reading";

export type SignReaderProvider = "gemini" | "groq";
export type SignReader = { provider: SignReaderProvider; key: string };
/** First model that answers wins; the rest cover a model being retired or overloaded. */
export const SIGN_READER_MODELS: Record<SignReaderProvider, string[]> = {
  gemini: ["gemini-3.8-flash", "gemini-3.7-flash"],
  groq: ["qwen/qwen3.8-27b"],
};
export const SIGN_READER_KEY_PAGES: Record<SignReaderProvider, string> = {
  gemini: "https://aistudio.google.com/apikey",
  groq: "https://console.groq.com/keys",
};
export class SignReaderError extends Error {
  constructor(readonly kind: "key" | "quota" | "offline" | "unavailable") { super(`Sign reader ${kind}`); this.name = "SignReaderError"; }
}
export const validSignReader = (value: unknown): value is SignReader => Boolean(value && typeof value === "object" &&
  ["gemini", "groq"].includes((value as SignReader).provider) && typeof (value as SignReader).key === "string" && /^[A-Za-z0-9_.-]{20,200}$/.test((value as SignReader).key));
/** Pasted keys reveal their provider: Groq keys start with gsk_, Google keys with AIza. */
export const guessProvider = (key: string): SignReaderProvider | null => /^gsk_/.test(key.trim()) ? "groq" : /^AIza/.test(key.trim()) ? "gemini" : null;

let current: SignReader | null | undefined;
let loading: Promise<void> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
function load() {
  // Loaded lazily so the reader itself stays testable without the native keystore.
  loading ??= import("./readerKey").then(({ readerKeyStorage }) => readerKeyStorage.get()).then(raw => {
    try { const value = raw ? JSON.parse(raw) : null; current = validSignReader(value) ? value : null; } catch { current = null; }
  }, () => { current = null; }).finally(emit);
  return loading;
}
export const signReaderState = {
  subscribe(listener: () => void) { listeners.add(listener); if (current === undefined) void load(); return () => { listeners.delete(listener); }; },
  get: () => current,
  async current() { if (current === undefined) await load(); return current ?? null; },
  async save(value: SignReader | null) {
    if (value && !validSignReader(value)) throw new SignReaderError("key");
    const { readerKeyStorage } = await import("./readerKey");
    if (value) await readerKeyStorage.set(JSON.stringify(value)); else await readerKeyStorage.remove();
    current = value; emit();
  },
};
/** undefined while the keystore loads, null when the driver has not added a key. */
export const useSignReader = () => useSyncExternalStore(signReaderState.subscribe, signReaderState.get, signReaderState.get);

type Fetch = typeof fetch;
async function request(fetcher: Fetch, url: string, init: RequestInit, timeoutMs = 60_000) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetcher(url, { ...init, signal: controller.signal }); }
  catch { throw new SignReaderError("offline"); }
  finally { clearTimeout(timer); }
}
async function failure(response: Response) {
  const body = await response.text().catch(() => "");
  if (response.status === 401 || response.status === 403 || (response.status === 400 && /api[ _-]?key/i.test(body))) return new SignReaderError("key");
  return new SignReaderError(response.status === 429 ? "quota" : "unavailable");
}
type Image = { base64: string; mimeType: string };
async function askGemini(fetcher: Fetch, key: string, model: string, prompt: string, image: Image) {
  const response = await request(fetcher, "https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      model, store: false, generation_config: { thinking_level: "low", thinking_summaries: "none" },
      input: [{ type: "text", text: prompt }, { type: "image", mime_type: image.mimeType, data: image.base64 }],
      response_format: { type: "text", mime_type: "application/json", schema: SIGN_READING_SCHEMA },
    }),
  });
  if (!response.ok) throw Object.assign(await failure(response), { status: response.status });
  const data = await response.json() as { output_text?: string; status?: string; outputs?: { type: string; text?: string }[]; steps?: { type: string; content?: { type: string; text?: string }[] }[] };
  if (data.status && !["completed", "succeeded"].includes(data.status)) throw new SignReaderError("unavailable");
  const parts = (values: { type: string; text?: string }[] | undefined) => values?.filter(part => part.type === "text").map(part => part.text ?? "").join("") ?? "";
  return data.output_text?.trim() || parts(data.steps?.filter(step => step.type === "model_output").flatMap(step => step.content ?? [])) || parts(data.outputs);
}
async function askGroq(fetcher: Fetch, key: string, model: string, prompt: string, image: Image) {
  const response = await request(fetcher, "https://api.groq.com/openai/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, temperature: 0,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.base64}` } }] }],
      response_format: { type: "json_schema", json_schema: { name: "parking_sign", strict: true, schema: SIGN_READING_SCHEMA } },
    }),
  });
  if (!response.ok) throw Object.assign(await failure(response), { status: response.status });
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}
/** Sends the photo straight from the phone to the driver's chosen provider under their own key. */
export async function readSignOnDevice(image: Image, reader: SignReader, fetcher: Fetch = fetch): Promise<{ info: SignInfo; model: string }> {
  let last: unknown;
  for (const model of SIGN_READER_MODELS[reader.provider]) {
    try {
      const ask = (prompt: string) => (reader.provider === "gemini" ? askGemini : askGroq)(fetcher, reader.key, model, prompt, image);
      return { info: await readSignWith(ask), model: `${reader.provider}:${model}` };
    } catch (error) {
      last = error;
      // Only a missing or overloaded model is worth another model on the same key.
      const status = (error as { status?: number }).status;
      if (!(error instanceof SignReaderError) || (status !== 404 && !(status && status >= 500))) break;
    }
  }
  throw last instanceof SignReaderError ? last : new SignReaderError("unavailable");
}
/** Checks a key without sending any photo. */
export async function testSignReader(reader: SignReader, fetcher: Fetch = fetch): Promise<"ok" | SignReaderError["kind"]> {
  try {
    const response = reader.provider === "gemini"
      ? await request(fetcher, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": reader.key } }, 15_000)
      : await request(fetcher, "https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${reader.key}` } }, 15_000);
    return response.ok ? "ok" : (await failure(response)).kind;
  } catch (error) { return error instanceof SignReaderError ? error.kind : "unavailable"; }
}
