// Uploads a Firebase service-account key file as the FIREBASE_SERVICE_ACCOUNT Edge Function secret,
// after checking Google accepts it. Prints no key material. Usage: node scripts/set-firebase-secret.mjs <key.json>
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serviceAccountJwt, GOOGLE_TOKEN_URL } from "../server/fcm.ts";

const account = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (account.type !== "service_account" || !account.private_key || !account.client_email) throw new Error("Not a service-account key file.");
const response = await fetch(GOOGLE_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: await serviceAccountJwt(account, Date.now()) }) });
if (!response.ok) throw new Error(`Google rejected the key: ${response.status}`);
console.log(`Google accepted the key for ${account.client_email} (project ${account.project_id}).`);

const env = Object.fromEntries(readFileSync(".env", "utf8").split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const file = join(tmpdir(), `firebase-secret-${process.pid}.env`);
// Single quotes keep the one-line JSON literal for the CLI's dotenv parser.
writeFileSync(file, `FIREBASE_SERVICE_ACCOUNT='${JSON.stringify(account)}'\n`, { mode: 0o600 });
try {
  execFileSync("npx", ["supabase@latest", "secrets", "set", "--env-file", file, "--project-ref", "vkqxtqcuoobiijbnpxod"],
    { env: { ...process.env, SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN }, stdio: "ignore", shell: true });
} finally { rmSync(file, { force: true }); }
console.log("FIREBASE_SERVICE_ACCOUNT set on Supabase.");
