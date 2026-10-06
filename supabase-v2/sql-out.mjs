/**
 * Like run-sql.mjs, but writes the whole answer to a file instead of the first
 * 8,000 characters to the console — for a look at a long result.
 *
 *   node supabase-v2/sql-out.mjs <out.json> "select ..."      (or a .sql file path)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { accessToken, PROJECT } from "./token.mjs";

const [out, arg] = process.argv.slice(2);
if (!out || !arg) {
  console.error('usage: node supabase-v2/sql-out.mjs <out.json> <"select ..." | file.sql>');
  process.exit(1);
}
const sql = arg.endsWith(".sql") ? readFileSync(arg, "utf-8") : arg;
const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
const text = await r.text();
writeFileSync(out, text);
console.log(`-> ${r.status}, ${text.length} chars in ${out}`);
process.exit(r.ok ? 0 : 1);
