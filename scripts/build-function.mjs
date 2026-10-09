// Bundles the Fastify API, its npm dependencies, the catalog and the database CA into one ES module
// for the Supabase Edge runtime (Deno). Run after changing server code or data/catalog.json.
import { readFileSync } from "node:fs";
import { build } from "esbuild";

await build({
  entryPoints: ["server/edge.ts"],
  outfile: "supabase/functions/api/server.js",
  bundle: true, platform: "node", format: "esm", target: "es2022", minify: true, legalComments: "none",
  define: { __DATABASE_CA__: JSON.stringify(readFileSync("certs/supabase-ca.crt", "utf8")) },
  // Dependencies written for Node still call require() for built-ins.
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
  plugins: [{
    name: "no-local-sqlite",
    // The function always uses Postgres; the local SQLite store is never constructed there.
    setup(build) {
      build.onResolve({ filter: /^node:sqlite$/ }, () => ({ path: "sqlite", namespace: "stub" }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export class DatabaseSync { constructor() { throw new Error('SQLite is not available in the function.'); } }", loader: "js" }));
    },
  }],
});
console.log("Wrote supabase/functions/api/server.js");
