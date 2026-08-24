/**
 * Makes Priya ask for one thing at a time.
 *
 *   node scripts/set-pacing-rules.mjs          # apply
 *   node scripts/set-pacing-rules.mjs --revert # restore from the backup it writes
 *
 * On a real call she was reading whole checklists out — dimensions, count, weight, date
 * and container type in a single turn. Nobody answers a paragraph of questions on the
 * phone; they answer the last one they can remember, and the rest has to be asked again.
 *
 * The prompt already contains those lists, and they are correct as lists — they say what
 * the desk needs on file. What was missing was anything telling her they are a checklist
 * to work through, not a script to read. This adds only that, and deliberately points at
 * the existing sections by name rather than rewriting them, so nothing else about her
 * behaviour changes.
 *
 * The acknowledgement wording is left open on purpose. An existing tone rule already
 * forbids opening every turn with the same reflexive "Got it!", so this asks for a short,
 * varied, human acknowledgement rather than prescribing a phrase that would then repeat
 * forty times in one call.
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

const AGENT = { id: 717, name: "Priya" };
const backupPath = join(root, "snapserve-setup", "agent-717-pacing-backup.json");

const HEADING = "ONE QUESTION AT A TIME -- HOW TO ASK FOR ANYTHING:";

const BLOCK = `${HEADING}
Ask for ONE piece of information, then stop talking and let them answer. This is the single most important thing about how you sound on a call.
- Never ask two questions in one turn. Not "what are the dimensions and how many boxes" -- just "what size is one box?", wait, then ask how many.
- Never read a list aloud. The lists elsewhere in this prompt -- what to collect before answering a space question, and what the documentation desk needs -- are checklists for YOU to work through one item at a time. They are not a script to recite at the customer. A caller who hears six questions in one breath answers the last one and forgets the rest, and you end up asking everything again.
- When they answer, acknowledge it briefly and naturally before moving on. Vary how you do it -- a short "right", "okay", "perfect, noted", "sari", repeating the number back once -- and keep it to a few words. Never use the same acknowledgement every turn; that is what makes an agent sound like a form.
- Then ask the next thing. One question, wait, acknowledge, next. That rhythm is the whole job.
- Keep each question short enough to say in one breath. If a question needs explaining, ask it first and explain only if they sound unsure.
- If they volunteer several things at once -- "40 boxes, each a metre square, going to Colombo" -- take all of it, say so briefly, and never ask again for something they already told you.
- If an answer is unclear, ask about that one thing again rather than moving on and collecting it later.
- Do not tell the customer how many questions are coming, and do not announce the process. No "I need six details from you". Just start asking.
Silence after your question is the customer thinking, not a cue to fill it with the next question. Wait.`;

const revert = process.argv.includes("--revert");

const live = await fetch(`${SNAP}/agents/${AGENT.id}`, { headers: H }).then((r) => r.json());
const current = (live.systemPrompt ?? "").replace(/\r/g, "");

let next;
if (revert) {
  if (!existsSync(backupPath)) {
    console.error("no backup to revert to");
    process.exit(1);
  }
  next = JSON.parse(readFileSync(backupPath, "utf-8")).systemPrompt;
} else {
  if (current.includes(HEADING)) {
    console.log(`  ${AGENT.name}: pacing rules already present, nothing to do`);
    process.exit(0);
  }
  // Back up only on a real change, so a re-run cannot overwrite the original.
  writeFileSync(backupPath, JSON.stringify({ systemPrompt: current }, null, 2));
  next = `${current.trim()}\n\n${BLOCK}`;
}

const r = await fetch(`${SNAP}/agents/${AGENT.id}`, {
  method: "PATCH",
  headers: H,
  body: JSON.stringify({ systemPrompt: next }),
});
if (!r.ok) {
  console.error(`PATCH failed ${r.status} ${(await r.text()).slice(0, 200)}`);
  process.exit(1);
}

const after = await fetch(`${SNAP}/agents/${AGENT.id}`, { headers: H }).then((x) => x.json());
const present = after.systemPrompt.includes(HEADING);

// Everything else must be untouched — this script only ever appends or restores.
const untouched = revert || after.systemPrompt.startsWith(current.trim().slice(0, 400));
console.log(
  `  ${AGENT.name}: ${current.length} -> ${after.systemPrompt.length} chars, pacing rules ${
    revert ? (present ? "STILL PRESENT" : "removed") : present ? "present" : "NOT APPLIED"
  }, rest of prompt ${untouched ? "unchanged" : "CHANGED — CHECK"}`
);
