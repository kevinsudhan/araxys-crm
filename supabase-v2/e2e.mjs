/**
 * The end-to-end shipment check (e2e-shipment.sql), run safely.
 *
 *   node supabase-v2/e2e.mjs
 *
 * The check itself rolls back, but sequences do not: it books a job and
 * records a warehouse receipt, which take the next ARX-SHP and WR numbers for
 * good. So this reads the sequences first and puts them back afterwards — to
 * where they were, or to the highest number really in use if somebody at the
 * desk booked a job while it ran. Prints the PASS / FAIL lines.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { accessToken, PROJECT } from "./token.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const TOKEN = accessToken();

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  return { ok: r.ok, text };
}

/** The sequences the check uses, and what each numbers. */
const SEQUENCES = {
  shipment_no_seq: "select coalesce(max(substring(id from 9)::int), 0) n from public.shipments where id ~ '^ARX-SHP-[0-9]+$'",
  warehouse_receipt_seq: "select coalesce(max(substring(receipt_no from 4)::int), 0) n from public.warehouse_receipts where receipt_no ~ '^WR-[0-9]+$'",
};

const before = JSON.parse((await sql("select sequencename s, last_value v from pg_sequences where schemaname = 'public'")).text);
const was = Object.fromEntries(before.map((r) => [r.s, r.v]));

const run = await sql(readFileSync(join(here, "e2e-shipment.sql"), "utf-8"));
let message = run.text;
try {
  message = JSON.parse(run.text).message ?? run.text;
} catch {
  /* not JSON: printed as it came */
}
const results = message.includes("RESULTS") ? message.slice(message.indexOf("RESULTS")).split("\nCONTEXT:")[0] : message;
console.log(results);

// Put the numbering back.
const after = JSON.parse((await sql("select sequencename s, last_value v from pg_sequences where schemaname = 'public'")).text);
for (const { s, v } of after) {
  if (String(v) === String(was[s])) continue;
  if (!(s in SEQUENCES)) {
    console.log(`note: ${s} moved from ${was[s]} to ${v}; not one this script resets — look at it.`);
    continue;
  }
  const used = Number(JSON.parse((await sql(SEQUENCES[s])).text)[0].n);
  const back = Math.max(Number(was[s] ?? 0), used);
  const set = back > 0 ? `select setval('public.${s}', ${back}, true)` : `select setval('public.${s}', 1, false)`;
  await sql(set);
  console.log(`reset ${s}: ${v} → ${back || "unused"}`);
}
process.exit(results.includes("failed=0") ? 0 : 1);
