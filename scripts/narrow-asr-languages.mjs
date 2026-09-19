/**
 * Narrows the speech recogniser's candidate languages on Priya and Arun.
 *
 *   node scripts/narrow-asr-languages.mjs            # show what would change
 *   node scripts/narrow-asr-languages.mjs --apply
 *   node scripts/narrow-asr-languages.mjs --revert   # put the backup back
 *
 * ---------------------------------------------------------------------------
 * WHY
 *
 * Both agents were configured with twenty-three candidate languages and
 * languageAutoDetect on: Assamese, Bodo, Dogri, Kashmiri, Konkani, Maithili, Manipuri,
 * Santali, Sanskrit, Sindhi and the rest. A recogniser given twenty-three ways to be
 * wrong takes them. The transcript behind ARX-ENQ-0004 came back as Portuguese and
 * Spanish sentences that were never spoken:
 *
 *   Caller: A gente não vendeu teu. Ah, Anna Nagar de um petroleiro.
 *
 * Extraction then did its job faithfully on nonsense and wrote "You After" into the
 * company field. No amount of prompt work fixes that — the words were never there.
 *
 * This desk answers in English and Tamil. Priya's own prompt says so: "If unsupported,
 * offer English or Tamil." The recogniser should be told the same thing.
 *
 * Only agentConfig is touched. The system prompt, the voice, the knowledge sources and
 * the webhook are left exactly as they are — this script never sends them.
 * ---------------------------------------------------------------------------
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");

const env = Object.fromEntries(
  readFileSync(join(root, "snapserve-setup", ".env"), "utf-8")
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_0-9]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
);

const SNAP = env.SNAPSERVE_BASE_URL;
const H = { Authorization: `Bearer ${env.SNAPSERVE_API_KEY}`, "Content-Type": "application/json" };

/** What this desk actually answers in. */
const KEEP = ["en-IN", "ta-IN"];

const AGENTS = [717, 758];
const backupDir = join(root, "snapserve-setup", "backups");
const backupPath = (id) => join(backupDir, `agent-${id}-asr-languages.json`);

const get = async (id) => {
  const r = await fetch(`${SNAP}/agents/${id}`, { headers: H });
  if (!r.ok) throw new Error(`GET agent ${id}: HTTP ${r.status}`);
  return r.json();
};

const patch = async (id, body) => {
  const r = await fetch(`${SNAP}/agents/${id}`, { method: "PATCH", headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PATCH agent ${id}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json();
};

if (REVERT) {
  for (const id of AGENTS) {
    const p = backupPath(id);
    if (!existsSync(p)) {
      console.log(`agent ${id}: no backup, nothing to revert`);
      continue;
    }
    const saved = JSON.parse(readFileSync(p, "utf-8"));
    const live = await get(id);
    await patch(id, { agentConfig: { ...live.agentConfig, ...saved } });
    console.log(`agent ${id}: reverted to ${saved.multilingualLanguages.length} languages`);
  }
  process.exit(0);
}

for (const id of AGENTS) {
  const a = await get(id);
  const cfg = a.agentConfig ?? {};
  const before = {
    multilingualLanguages: cfg.multilingualLanguages ?? [],
    secondaryLanguages: cfg.secondaryLanguages ?? [],
  };

  const dropped = before.multilingualLanguages.filter((l) => !KEEP.includes(l));
  console.log(`\n${a.name} (${id})`);
  console.log(`  now:  ${before.multilingualLanguages.length} languages`);
  console.log(`  keep: ${KEEP.join(", ")}`);
  console.log(`  drop: ${dropped.length ? dropped.join(", ") : "(none)"}`);

  if (!APPLY) continue;
  if (!dropped.length) {
    console.log("  already narrowed — not writing");
    continue;
  }

  mkdirSync(backupDir, { recursive: true });
  writeFileSync(backupPath(id), JSON.stringify(before, null, 2) + "\n");

  // The whole agentConfig goes back because it is one JSON column; every other key is
  // carried across untouched, and the prompt and voice are not in this request at all.
  await patch(id, {
    agentConfig: { ...cfg, multilingualLanguages: KEEP, secondaryLanguages: KEEP },
  });

  const after = await get(id);
  console.log(`  applied: ${after.agentConfig.multilingualLanguages.join(", ")}`);
  console.log(`  prompt unchanged: ${after.systemPrompt === a.systemPrompt}`);
}

if (!APPLY) console.log("\nDry run. Add --apply to write, --revert to undo.");
