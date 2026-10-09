// Isolated USB test server. It never connects to the shared database.
import { readFileSync, mkdirSync } from "node:fs";
import { ParkingStore } from "../server/store";
import { buildApp } from "../server/app";
import type { Catalog } from "../src/domain/types";

async function main() {
const catalog = JSON.parse(readFileSync("data/catalog.json", "utf8")) as Catalog;
mkdirSync("data/runtime", { recursive: true });
const store = new ParkingStore("data/runtime/device-test.sqlite", catalog, Date.now, true);
const app = await buildApp(catalog, store, {
  requireOnboarding: true,
  origins: ["http://localhost:8082", "http://127.0.0.1:8082"],
});
await app.listen({ host: "127.0.0.1", port: 3002 });
console.log("Device test API: http://127.0.0.1:3002 (isolated SQLite)");
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { void app.close().then(() => process.exit(0)); });

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
