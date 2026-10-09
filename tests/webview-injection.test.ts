import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as basemap from "../src/domain/basemap-lifecycle";
import * as layers from "../src/domain/layer-cache";
import * as camera from "../src/domain/map-selection-camera";

// Release builds run Hermes, whose Function#toString returns "{ [bytecode] }" unless the
// function opts in. A stub breaks the whole Android map script (no basemap, no pins).
test("every function injected into the Android map WebView keeps its source under Hermes", () => {
  const html = readFileSync("src/components/offlineMapHtml.ts", "utf8");
  const injected = [...html.matchAll(/\$\{(\w+)\.toString\(\)\}/g)].map(match => match[1]);
  assert.ok(injected.length >= 4);
  const modules: Record<string, unknown> = { ...basemap, ...layers, ...camera };
  for (const name of injected) {
    const fn = modules[name];
    assert.equal(typeof fn, "function", `${name} must come from an audited module`);
    assert.match((fn as () => void).toString(), /^[^{]*\{\s*(\/\/[^\n]*\n\s*)?"show source";/, `${name} needs a leading "show source" directive`);
  }
});
