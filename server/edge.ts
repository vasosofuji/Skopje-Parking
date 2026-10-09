// Supabase Edge Function handler. `npm run build:function` bundles this file (with the catalog and the
// database CA) into supabase/functions/api/server.js; supabase/functions/api/index.ts serves it.
import type { FastifyInstance } from "fastify";
import seed from "../data/catalog.json";
import type { Catalog } from "../src/domain/types";
import { createApp } from "./bootstrap";

declare const EdgeRuntime: { waitUntil(task: Promise<unknown>): void } | undefined;
// certs/supabase-ca.crt, inlined by scripts/build-function.mjs.
declare const __DATABASE_CA__: string | undefined;
const MAX_BODY = 512 * 1024;
const unavailable = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

let application: Promise<FastifyInstance> | undefined;
function app() {
  application ??= createApp(task => {
    const work = task.catch(() => {});
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
  }, structuredClone(seed) as Catalog, typeof __DATABASE_CA__ === "string" ? __DATABASE_CA__ : undefined).then(async instance => { await instance.ready(); return instance; }).catch(error => {
    application = undefined;
    throw error;
  });
  return application;
}

/** Reads at most MAX_BODY bytes; the API's own limits are smaller. */
async function body(request: Request) {
  if (!request.body || request.method === "GET" || request.method === "HEAD") return undefined;
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return null;
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export const handle = edgeHandler(app);

export function edgeHandler(app: () => Promise<FastifyInstance>) { return async (request: Request): Promise<Response> => {
  let instance: FastifyInstance;
  try { instance = await app(); } catch (error) {
    // Do not expose connection strings or provider errors to public clients; the private log gets the cause.
    const cause = error instanceof Error ? `${error.name}: ${error.message} @ ${(error.stack ?? "").split("\n").slice(1, 5).join(" | ")}` : String(error);
    console.error("API initialization failed:", cause.replace(/postgres(ql)?:\/\/\S+/gi, "<database url>"));
    return unavailable(503, "unavailable");
  }
  const payload = await body(request);
  if (payload === null) return unavailable(413, "Request body is too large.");
  const url = new URL(request.url);
  // Supabase passes /api/v1/... for https://<project>.supabase.co/functions/v1/api/v1/...
  const path = url.pathname.replace(/^\/api(?=\/|$)/, "") || "/";
  const response = await instance.inject({
    method: request.method as "GET", url: path + url.search, payload,
    headers: Object.fromEntries(request.headers), remoteAddress: "127.0.0.1",
  });
  const headers = new Headers();
  for (const [key, value] of Object.entries(response.headers))
    if (value !== undefined && key !== "content-length" && key !== "transfer-encoding" && key !== "connection")
      for (const item of Array.isArray(value) ? value : [value]) headers.append(key, String(item));
  const raw = new Uint8Array(response.rawPayload);
  // Phones send Accept-Encoding: gzip and inflate transparently; JSON shrinks about 6x.
  if (raw.byteLength > 1024 && /\bgzip\b/.test(request.headers.get("accept-encoding") ?? "") && !headers.has("content-encoding")) {
    headers.set("Content-Encoding", "gzip");
    headers.append("Vary", "Accept-Encoding");
    return new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip")), { status: response.statusCode, headers });
  }
  return new Response(response.statusCode === 204 || request.method === "HEAD" ? null : raw, { status: response.statusCode, headers });
}; }
