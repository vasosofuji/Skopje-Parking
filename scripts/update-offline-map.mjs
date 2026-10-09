// Downloads the Skopje basemap that ships inside the app: OpenFreeMap vector tiles (OpenMapTiles
// schema, zoom 0–14; the map overzooms beyond 14) and the font glyphs the style uses.
// Run when you want fresher streets, then rebuild the app:  node scripts/update-offline-map.mjs
import { mkdirSync, rmSync, writeFileSync, renameSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const OUT = "assets/offline-map";
// Skopje with a margin around the area the API accepts (lat 41.91–42.08, lon 21.30–21.58).
const BBOX = { west: 21.22, south: 41.86, east: 21.66, north: 42.13 };
const MAX_ZOOM = 14;
const FONTS = ["Noto Sans Regular", "Noto Sans Bold", "Noto Sans Italic"];
// Basic Latin, Latin-1, Latin Extended (š ž ć ë ç), Cyrillic, general punctuation (– ’ “).
const RANGES = ["0-255", "256-511", "1024-1279", "8192-8447"];
const AGENT = { "User-Agent": "Parkino offline map builder (one-off Skopje extract)" };

const tile = (lon, lat, z) => {
  const n = 2 ** z, rad = (lat * Math.PI) / 180;
  return { x: Math.floor(((lon + 180) / 360) * n), y: Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n) };
};
async function get(url) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { headers: AGENT });
    if (response.ok) return new Uint8Array(await response.arrayBuffer());
    if (response.status === 404 || response.status === 204) return null;
    if (attempt >= 4) throw new Error(`${response.status} ${url}`);
    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
  }
}
async function pool(jobs, size = 6) {
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (next < jobs.length) await jobs[next++](); }));
}

const tilejson = await (await fetch("https://tiles.openfreemap.org/planet", { headers: AGENT })).json();
const template = tilejson.tiles[0];
const temp = `${OUT}.download`;
rmSync(temp, { recursive: true, force: true });
const jobs = [];
let tiles = 0, empty = 0;
for (let z = 0; z <= MAX_ZOOM; z++) {
  const a = tile(BBOX.west, BBOX.north, z), b = tile(BBOX.east, BBOX.south, z);
  for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) jobs.push(async () => {
    const data = await get(template.replace("{z}", z).replace("{x}", x).replace("{y}", y));
    if (!data) { empty++; return; }
    mkdirSync(join(temp, "tiles", String(z), String(x)), { recursive: true });
    writeFileSync(join(temp, "tiles", String(z), String(x), `${y}.pbf`), data);
    tiles++;
  });
}
for (const font of FONTS) for (const range of RANGES) jobs.push(async () => {
  const data = await get(`https://tiles.openfreemap.org/fonts/${encodeURIComponent(font)}/${range}.pbf`);
  if (!data) throw new Error(`missing glyphs ${font} ${range}`);
  mkdirSync(join(temp, "fonts", font), { recursive: true });
  writeFileSync(join(temp, "fonts", font, `${range}.pbf`), data);
});
await pool(jobs);
writeFileSync(join(temp, "manifest.json"), JSON.stringify({
  source: template, downloadedAt: new Date().toISOString(), bbox: BBOX, minzoom: 0, maxzoom: MAX_ZOOM, fonts: FONTS, ranges: RANGES,
  attribution: "© OpenMapTiles © OpenStreetMap contributors", license: "Map data ODbL (OpenStreetMap); tiles via OpenFreeMap",
}, null, 2));
rmSync(OUT, { recursive: true, force: true });
renameSync(temp, OUT);
const size = (dir) => readdirSync(dir).reduce((sum, name) => { const path = join(dir, name), info = statSync(path); return sum + (info.isDirectory() ? size(path) : info.size); }, 0);
console.log(`${tiles} tiles (${empty} empty) + glyphs, ${(size(OUT) / 1048576).toFixed(1)} MB in ${OUT}${existsSync(OUT) ? "" : " (missing!)"}`);
