/**
 * Deploys an Edge Function through the Management API, without the Supabase CLI.
 *
 *   node scripts/deploy-function.mjs ingest
 *   node scripts/deploy-function.mjs ingest api
 *
 * The CLI is the normal way to do this. This exists because it is not installed here and
 * a deploy should not be blocked on that — the Management API takes the same multipart
 * upload the CLI sends, so the result is identical.
 *
 * Every file is uploaded with its repo-relative path as the part filename, which is what
 * makes `../_shared/records.ts` resolve inside the deployed bundle the same way it does
 * locally. `_shared` goes with every function: both functions import from it, and sending
 * the directory wholesale is cheaper than tracing each import graph by hand.
 *
 * verify_jwt is read from the live function rather than assumed. Both of these are called
 * by SnapServe webhooks and by the browser, so flipping it on would break them silently —
 * the deploy would succeed and every subsequent request would 401.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const line of readFileSync(join(root, "snapserve-setup", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const REF = process.env.SUPABASE_PROJECT_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const API = "https://api.supabase.com/v1/projects/" + REF;

const slugs = process.argv.slice(2);
if (!slugs.length) {
  console.error("usage: node scripts/deploy-function.mjs <slug> [slug...]");
  process.exit(1);
}

/** Source files only — tests are not part of the deployed function. */
function sharedFiles() {
  const dir = join(root, "supabase", "functions", "_shared");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => ({ path: `supabase/functions/_shared/${f}`, disk: join(dir, f) }));
}

async function deploy(slug) {
  const current = await fetch(`${API}/functions/${slug}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  // A function that does not exist yet is created by the same deploy call, so a 404 is a
  // first deploy rather than an error. verify_jwt defaults off to match the others here:
  // these are reached by pg_cron and by SnapServe webhooks, neither of which carries a JWT.
  let live = { version: 0, verify_jwt: false };
  if (current.ok) live = await current.json();
  else if (current.status !== 404) {
    console.error(`  ${slug}: could not read current config (${current.status})`);
    return false;
  }

  const entrypoint = `supabase/functions/${slug}/index.ts`;
  const files = [
    { path: entrypoint, disk: join(root, "supabase", "functions", slug, "index.ts") },
    ...sharedFiles(),
  ];

  const form = new FormData();
  form.append(
    "metadata",
    new Blob(
      [
        JSON.stringify({
          name: slug,
          entrypoint_path: entrypoint,
          verify_jwt: live.verify_jwt,
        }),
      ],
      { type: "application/json" },
    ),
  );

  for (const f of files) {
    form.append("file", new Blob([readFileSync(f.disk)], { type: "application/typescript" }), f.path);
  }

  const r = await fetch(`${API}/functions/deploy?slug=${encodeURIComponent(slug)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: form,
  });

  if (!r.ok) {
    console.error(`  ${slug}: deploy failed ${r.status}\n    ${(await r.text()).slice(0, 400)}`);
    return false;
  }

  const out = await r.json();
  console.log(`  ${slug}: v${live.version} -> v${out.version}  (${files.length} files, verify_jwt ${live.verify_jwt})`);
  return true;
}

let ok = true;
for (const slug of slugs) {
  console.log(`deploying ${slug}...`);
  if (!(await deploy(slug))) ok = false;
}
process.exit(ok ? 0 : 1);
