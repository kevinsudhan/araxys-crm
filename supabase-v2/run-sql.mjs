/**
 * Applies a migration to the v2 project.
 *
 *   node supabase-v2/run-sql.mjs 013-partners.sql
 *
 * There is no Supabase CLI on this machine, so migrations go through the
 * Management API's query endpoint. The whole file is sent as one statement
 * block, which means it is applied in a single transaction -- a migration that
 * fails halfway leaves nothing behind.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
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

const file = process.argv[2];
if (!file) {
  console.error("usage: node supabase-v2/run-sql.mjs <file.sql>");
  process.exit(1);
}

const sql = readFileSync(join(root, "supabase-v2", file), "utf-8");

const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});

const text = await r.text();
console.log(`${file} -> ${r.status}`);
console.log(text.slice(0, 1200));
process.exit(r.ok ? 0 : 1);
