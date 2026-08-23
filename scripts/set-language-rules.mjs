/**
 * Teaches both desk agents which language to speak, and when to switch.
 *
 *   node scripts/set-language-rules.mjs          # apply
 *   node scripts/set-language-rules.mjs --revert # restore from the backups it writes
 *
 * Two problems this fixes, both reported off real calls:
 *
 *   1. A caller who mixes Tamil and English was being answered in English. Mixing is how
 *      people talk at a Chennai freight desk — it is not a request to switch languages.
 *      Tamil is the language of the conversation; the English words inside it are just
 *      the trade vocabulary, and translating "container" or "demurrage" into formal
 *      Tamil that nobody uses at a port makes the agent harder to follow, not easier.
 *
 *   2. Language was not remembered between calls. Someone who rang in Tamil last week
 *      was greeted in English this week and had to ask, again. The preference now rides
 *      in on caller memory (see languageByPhone in _shared/records.ts, which reads it off
 *      what they actually spoke rather than a field anyone has to maintain) — but caller
 *      memory only works if the prompt tells the agent to obey it.
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
const H = {
  Authorization: `Bearer ${process.env.SNAPSERVE_API_KEY}`,
  "Content-Type": "application/json",
};

const AGENTS = [
  { id: 717, name: "Priya" },
  { id: 758, name: "Arun" },
];

const backupPath = (id) => join(root, "snapserve-setup", `agent-${id}-prompt-backup.json`);

const HEADING = "LANGUAGE -- WHICH ONE TO SPEAK, AND WHEN TO SWITCH:";

const LANGUAGE_BLOCK = `${HEADING}
The CRM update block injected at the start of this call may name the language this caller speaks with us. If it does, open in that language, greeting included. Someone who rang last week in Tamil must not be greeted in English this week and made to ask again for their own language.
- If the block says Tamil, greet in Tamil and keep the whole call in Tamil.
- If the block says nothing, follow whatever the caller uses in their first sentence or two.
WHEN A CALLER MIXES TAMIL AND ENGLISH, THE CONVERSATION IS IN TAMIL, NOT ENGLISH. Mixing is simply how people speak here. It is not a request to switch to English, and answering a Tamil-and-English caller in English is the single most common way this goes wrong.
- Do not translate trade vocabulary into formal Tamil nobody uses at a freight desk. Container, booking, invoice, BL, CBM, reefer, customs, demurrage, cut-off: say those in English inside the Tamil sentence, exactly as the customer does.
- If the caller says one whole sentence in English, answer that sentence in English and then carry on in Tamil. A single English sentence is not a permanent switch.
- If the caller genuinely moves to English for the rest of the call, follow them and stay there.
- Never announce which language you are speaking, and never ask which they would prefer. Just speak it.
Numbers are where mixed-language calls break down. Say dates, amounts and reference numbers slowly and clearly in whichever language you are in, and confirm the important ones once.`;

const OLD_LINE =
  "You speak fluent Tamil and English and switch naturally to whichever the customer uses first.";
const NEW_LINE = "You speak fluent Tamil and English -- see the language section below.";

const revert = process.argv.includes("--revert");

for (const agent of AGENTS) {
  const live = await fetch(`${SNAP}/agents/${agent.id}`, { headers: H }).then((r) => r.json());
  const current = (live.systemPrompt ?? "").replace(/\r/g, "");

  let next;
  if (revert) {
    if (!existsSync(backupPath(agent.id))) {
      console.log(`  ${agent.name}: no backup, skipped`);
      continue;
    }
    next = JSON.parse(readFileSync(backupPath(agent.id), "utf-8")).systemPrompt;
  } else {
    if (current.includes(HEADING)) {
      console.log(`  ${agent.name}: language rules already present, skipped`);
      continue;
    }
    // Back up only on a real change, so a re-run cannot overwrite the original with an
    // already-modified prompt and destroy the way back.
    writeFileSync(backupPath(agent.id), JSON.stringify({ systemPrompt: current }, null, 2));
    next = `${current.replace(OLD_LINE, NEW_LINE).trim()}\n\n${LANGUAGE_BLOCK}`;
  }

  const r = await fetch(`${SNAP}/agents/${agent.id}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ systemPrompt: next }),
  });
  if (!r.ok) {
    console.error(`  ${agent.name}: PATCH failed ${r.status} ${(await r.text()).slice(0, 200)}`);
    continue;
  }

  const after = await fetch(`${SNAP}/agents/${agent.id}`, { headers: H }).then((x) => x.json());
  const ok = revert ? !after.systemPrompt.includes(HEADING) : after.systemPrompt.includes(HEADING);
  console.log(
    `  ${agent.name}: ${current.length} -> ${after.systemPrompt.length} chars, language rules ${
      ok ? (revert ? "removed" : "present") : "NOT APPLIED"
    }`
  );
}
