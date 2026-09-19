/**
 * Sets the company name the voice agents use.
 *
 *   node scripts/set-agent-brand.mjs                 # show what each agent says now
 *   node scripts/set-agent-brand.mjs --apply         # write the name in BRAND below
 *   node scripts/set-agent-brand.mjs --revert        # restore from the backup
 *
 * The name appears in two places per agent and both matter: the system prompt, which is
 * how the agent refers to the company mid-call, and the greeting, which is the very first
 * thing a caller hears. They have disagreed on this account before — one agent opened as
 * "Araxys Logistics" while its own prompt said "Aashish Logistics Global", so a caller
 * transferred between the two heard the company rename itself mid-call.
 *
 * This replaces any known company name with BRAND, rather than mapping one specific name
 * to another, so running it twice is a no-op and it cannot leave a half-renamed prompt.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(join(root, "snapserve-setup", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const SNAP = process.env.SNAPSERVE_BASE_URL;
if (!SNAP || !process.env.SNAPSERVE_API_KEY) {
  console.error("SNAPSERVE_BASE_URL and SNAPSERVE_API_KEY must be in snapserve-setup/.env");
  process.exit(1);
}
const H = {
  Authorization: `Bearer ${process.env.SNAPSERVE_API_KEY}`,
  "Content-Type": "application/json",
};

/** The name the agents should use. */
const BRAND = process.env.ARAXYS_BRAND ?? "Araxys Logistics";

/**
 * Every company name this account has used, longest first.
 *
 * Longest first is load-bearing: "Aashish Logistics" is a prefix of "Aashish Logistics
 * Global", so replacing the short one first would leave a stray " Global" behind.
 */
const KNOWN = ["Aashish Logistics Global", "Aashish Logistics", "Araxys Logistics"]
  .sort((a, b) => b.length - a.length);

const AGENTS = [717, 758];
const backupPath = (id) => join(root, "snapserve-setup", `agent-${id}-brand-backup.json`);

const get = async (id) => {
  const r = await fetch(`${SNAP}/agents/${id}`, { headers: H });
  if (!r.ok) throw new Error(`GET agent ${id}: HTTP ${r.status}`);
  return r.json();
};
const patch = async (id, body) => {
  const r = await fetch(`${SNAP}/agents/${id}`, { method: "PATCH", headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PATCH agent ${id}: HTTP ${r.status} ${await r.text()}`);
  return r.json();
};

/** Replaces any known company name with BRAND. Idempotent by construction. */
function rename(text) {
  let out = String(text ?? "");
  for (const name of KNOWN) {
    if (name === BRAND) continue;
    out = out.split(name).join(BRAND);
  }
  return out;
}

const countOf = (text, needle) => String(text ?? "").split(needle).length - 1;

const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");

if (REVERT) {
  for (const id of AGENTS) {
    const p = backupPath(id);
    if (!existsSync(p)) { console.log(`${id}: no backup at ${p}`); continue; }
    const b = JSON.parse(readFileSync(p, "utf-8"));
    await patch(id, { systemPrompt: b.systemPrompt, greetingMessage: b.greetingMessage });
    console.log(`${id} ${b.name}: restored`);
  }
  process.exit(0);
}

console.log(`brand: "${BRAND}"${APPLY ? "" : "   (dry run — pass --apply to write)"}\n`);

for (const id of AGENTS) {
  const live = await get(id);
  const prompt = rename(live.systemPrompt);
  const greeting = rename(live.greetingMessage);

  const changed = prompt !== live.systemPrompt || greeting !== live.greetingMessage;
  console.log(`${id} ${live.name}:`);
  for (const name of KNOWN) {
    const n = countOf(live.systemPrompt, name) + countOf(live.greetingMessage, name);
    if (n) console.log(`  now says "${name}" x${n}`);
  }
  if (!changed) { console.log(`  already "${BRAND}" everywhere\n`); continue; }

  if (!APPLY) {
    console.log(`  would become: ${JSON.stringify(greeting)}`);
    console.log(`  prompt ${live.systemPrompt.length} -> ${prompt.length} chars\n`);
    continue;
  }

  if (!existsSync(backupPath(id))) {
    writeFileSync(backupPath(id), JSON.stringify(live, null, 2), "utf-8");
    console.log(`  backed up to ${backupPath(id)}`);
  }

  await patch(id, { systemPrompt: prompt, greetingMessage: greeting });
  const after = await get(id);
  const leftovers = KNOWN.filter((n) => n !== BRAND)
    .map((n) => [n, countOf(after.systemPrompt, n) + countOf(after.greetingMessage, n)])
    .filter(([, c]) => c > 0);

  console.log(`  prompt    ${live.systemPrompt.length} -> ${after.systemPrompt.length} chars`);
  console.log(`  greeting  ${JSON.stringify(after.greetingMessage)}`);
  console.log(`  readback  ${after.systemPrompt === prompt && after.greetingMessage === greeting ? "matches" : "*** MISMATCH ***"}`);
  console.log(`  old names ${leftovers.length ? `*** ${leftovers.map(([n, c]) => `${n} x${c}`).join(", ")} ***` : "none left"}\n`);
}
