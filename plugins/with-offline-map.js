const { withDangerousMod } = require("expo/config-plugins");
const { cpSync, existsSync, rmSync } = require("node:fs");
const { join } = require("node:path");

// The Skopje basemap (scripts/update-offline-map.mjs) ships as Android assets, so the map needs no
// tile server: the map WebView reads file:///android_asset/offline-map/... through its offline:// protocol.
module.exports = function withOfflineMap(config) {
  return withDangerousMod(config, ["android", async (result) => {
    const source = join(result.modRequest.projectRoot, "assets", "offline-map");
    if (!existsSync(join(source, "manifest.json"))) throw new Error("Run `node scripts/update-offline-map.mjs` first: assets/offline-map is missing.");
    const target = join(result.modRequest.platformProjectRoot, "app", "src", "main", "assets", "offline-map");
    rmSync(target, { recursive: true, force: true });
    cpSync(source, target, { recursive: true });
    return result;
  }]);
};
