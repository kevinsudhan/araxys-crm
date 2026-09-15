/**
 * Puts Priya and Arun on v2's knowledge instead of v1's.
 *
 *   node supabase-v2/point-agents-at-v2.mjs           # show what would change
 *   node supabase-v2/point-agents-at-v2.mjs --apply
 *   node supabase-v2/point-agents-at-v2.mjs --restore # put v1's sources back
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NEEDED
 *
 * v2's ingest now claims calls from agents 717 and 758, so a call to Priya is
 * recorded in v2's CRM. But the agents themselves still read v1's rate card,
 * v1's container space and v1's customer records -- so she would quote a price
 * from one system into an enquiry stored in another, and could read a v1
 * customer's shipment to a v2 caller.
 *
 * WHAT THIS COSTS
 *
 * v1's Priya and Arun stop being v1's agents. They are the same two agents on
 * the SnapServe account; there is no way to point them at two sets of knowledge
 * at once, and attaching both sets would be worse than either -- two customer
 * record documents that disagree, with no rule saying which wins.
 *
 * So the previous attachment is written to disk first, and --restore puts it
 * back exactly. Nothing here is one-way.
 * ---------------------------------------------------------------------------
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { apiKey } = JSON.parse(readFileSync(join(root, "server-v2/.snapserve.json"), "utf-8"));

const BASE = "https://app.snapserve.ai/api";
const H = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

const AGENTS = [717, 758]; // Priya, Arun
const backupPath = join(root, "server-v2", ".agent-sources-v1-backup.json");

/** v2's own sources, by name, so a renumbered source is still found. */
const V2_NAMES = [
  "Container specifications (v2)",
  "Route pricing & negotiation bands (v2)",
  "Documents required by cargo type (v2)",
  "Destination customs & regulations (v2)",
  "Araxys v2 — customer records",
  "Araxys v2 — container space availability",
  "Araxys v2 — partner network",
];

const list = await fetch(`${BASE}/knowledge-sources`, { headers: H }).then((r) => r.json());
const all = Array.isArray(list) ? list : (list.data ?? []);
const byName = new Map(all.map((s) => [s.name, s.id]));

const v2Ids = [];
for (const n of V2_NAMES) {
  const id = byName.get(n);
  if (id) v2Ids.push(Number(id));
  else console.log(`  WARNING: no source named "${n}"`);
}

const restore = process.argv.includes("--restore");
const apply = process.argv.includes("--apply");

const current = {};
for (const id of AGENTS) {
  const a = await fetch(`${BASE}/agents/${id}`, { headers: H }).then((r) => r.json());
  current[id] = { name: a.name, ids: (a.knowledgeSourceIds ?? []).map(Number) };
}

if (restore) {
  if (!existsSync(backupPath)) {
    console.error("\n  no backup — nothing to restore\n");
    process.exit(1);
  }
  const saved = JSON.parse(readFileSync(backupPath, "utf-8"));
  for (const id of AGENTS) {
    const ids = saved[id]?.ids;
    if (!ids) continue;
    const r = await fetch(`${BASE}/agents/${id}`, {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({ knowledgeSourceIds: ids }),
    });
    console.log(`  ${saved[id].name} restored to ${JSON.stringify(ids)} -> ${r.status}`);
  }
  console.log("\n  v1's knowledge is back on Priya and Arun.\n");
  process.exit(0);
}

console.log("");
for (const id of AGENTS) {
  console.log(`  ${current[id].name} (${id})`);
  console.log(`    now : ${JSON.stringify(current[id].ids)}`);
  console.log(`    next: ${JSON.stringify(v2Ids)}`);
}

if (!apply) {
  console.log("\n  dry run — pass --apply to switch them to v2's knowledge\n");
  process.exit(0);
}

// Saved before the first write, and never overwritten by a second run, so the
// original v1 attachment survives however many times this is applied.
if (!existsSync(backupPath)) {
  writeFileSync(backupPath, JSON.stringify(current, null, 2));
  console.log(`\n  saved v1's attachment to ${backupPath}`);
} else {
  console.log("\n  backup already exists — keeping the original v1 attachment");
}

for (const id of AGENTS) {
  const r = await fetch(`${BASE}/agents/${id}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ knowledgeSourceIds: v2Ids }),
  });
  const after = await fetch(`${BASE}/agents/${id}`, { headers: H }).then((x) => x.json());
  console.log(
    `  ${after.name} ${r.status} -> ${JSON.stringify((after.knowledgeSourceIds ?? []).map(Number))}`
  );
}

console.log("\n  Priya and Arun now read v2's data. --restore puts v1's back.\n");
