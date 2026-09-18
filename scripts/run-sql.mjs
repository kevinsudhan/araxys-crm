/**
 * Applies a .sql file to the Araxys v1 Supabase project.
 *
 * Uses the Management API's query endpoint, which runs statements as the database owner —
 * the only route that can create tables, since the service_role key goes through PostgREST
 * and PostgREST does not do DDL.
 *
 *   node scripts/run-sql.mjs supabase/schema-quoting.sql            # show what it would run
 *   node scripts/run-sql.mjs supabase/schema-quoting.sql --apply
 *
 * Dry run first, always. This is the live desk's database: `real_records` holds the
 * customers the voice agents captured, and there is one copy of it.
 *
 * The file is sent whole rather than split on semicolons. Splitting breaks the moment a
 * function body contains one — `touch_updated_at_quoting` has two — and a half-applied
 * migration is worse than a rejected one.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const env = {};
for (const file of [
  path.join(root, "snapserve-setup", ".env"),
  path.join(root, ".env"),
]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].trim();
  }
}

const TOKEN = env.SUPABASE_ACCESS_TOKEN ?? process.env.SUPABASE_ACCESS_TOKEN;
const REF = env.SUPABASE_PROJECT_REF ?? process.env.SUPABASE_PROJECT_REF;

if (!TOKEN || !REF) {
  console.error("\nSUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF must be in snapserve-setup/.env\n");
  process.exit(1);
}

const file = process.argv[2];
const apply = process.argv.includes("--apply");

if (!file) {
  console.error("Usage: node scripts/run-sql.mjs <file.sql> [--apply]\n");
  process.exit(1);
}

const sql = fs.readFileSync(path.resolve(root, file), "utf-8");

// Statement-ish count, for the summary only — comments and function bodies make an exact
// count unreliable, and the file is executed as one unit regardless.
const statements = sql
  .split("\n")
  .filter((l) => /^\s*(create|alter|drop|insert|update|comment)\b/i.test(l)).length;

console.log(`\n${file}`);
console.log(`  project: ${REF}`);
console.log(`  ${sql.split("\n").length} lines, ~${statements} statements`);

const destructive = /\b(drop\s+table|truncate|delete\s+from)\b/i.exec(sql);
if (destructive) {
  // `drop trigger if exists` before `create trigger` is normal and safe; dropping a table
  // is not, and on this database it would take real customers with it.
  console.error(`\n  REFUSING: this file contains "${destructive[0]}".`);
  console.error("  Run destructive statements by hand, against a backup you have tested.\n");
  process.exit(1);
}

if (!apply) {
  console.log("\n  DRY RUN — nothing sent. Re-run with --apply.\n");
  process.exit(0);
}

const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});

const body = await r.text();
if (!r.ok) {
  console.error(`\n  FAILED: HTTP ${r.status}`);
  console.error(`  ${body.slice(0, 600)}\n`);
  process.exit(1);
}

console.log(`\n  applied (HTTP ${r.status})`);
try {
  const parsed = JSON.parse(body);
  if (Array.isArray(parsed) && parsed.length) console.log(`  ${JSON.stringify(parsed).slice(0, 300)}`);
} catch {
  /* an empty result is the normal answer to DDL */
}
console.log("");
