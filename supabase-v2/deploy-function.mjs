/**
 * Deploys a v2 Edge Function through the Management API.
 *
 *   node supabase-v2/deploy-function.mjs kb-sync
 *
 * The Supabase CLI is the normal route and is not installed here. The
 * Management API takes the same multipart upload the CLI sends, so the result
 * is identical.
 *
 * verify_jwt is left OFF for kb-sync: it is called by pg_cron and by a button
 * in the admin console, and turning it on would make both fail with a 401 that
 * the deploy itself would report as success.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const line of readFileSync(
  join(root, "..", "araxys-crm", "snapserve-setup", ".env"),
  "utf-8"
).split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT = "izgbrdeybhbepftloxgk";

const slug = process.argv[2];
if (!slug) {
  console.error("usage: node supabase-v2/deploy-function.mjs <slug>");
  process.exit(1);
}

const dir = join(root, "supabase-v2", "functions", slug);

function walk(d) {
  return readdirSync(d).flatMap((entry) => {
    const p = join(d, entry);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(dir).filter((f) => /\.(ts|js|json)$/.test(f));

const form = new FormData();
form.append(
  "metadata",
  new Blob(
    [
      JSON.stringify({
        name: slug,
        entrypoint_path: "index.ts",
        verify_jwt: false,
      }),
    ],
    { type: "application/json" }
  )
);

for (const f of files) {
  const rel = relative(dir, f).replace(/\\/g, "/");
  form.append("file", new Blob([readFileSync(f)], { type: "application/typescript" }), rel);
}

const r = await fetch(
  `https://api.supabase.com/v1/projects/${PROJECT}/functions/deploy?slug=${slug}`,
  { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: form }
);

const body = await r.text();
console.log(`deploy ${slug} -> ${r.status}`);
if (!r.ok) {
  console.error(body.slice(0, 500));
  process.exit(1);
}
console.log(`  files: ${files.map((f) => relative(dir, f)).join(", ")}`);
console.log(`  url:   https://${PROJECT}.supabase.co/functions/v1/${slug}`);
