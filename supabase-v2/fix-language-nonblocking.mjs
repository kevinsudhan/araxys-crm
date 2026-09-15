/**
 * Stops the language question from stalling the call.
 *
 *   node supabase-v2/fix-language-nonblocking.mjs
 *   node supabase-v2/fix-language-nonblocking.mjs --revert
 *
 * ---------------------------------------------------------------------------
 * WHAT THE LAST FIX BROKE
 *
 * Asking which language turned into a gate. On call 21567 she asked, the reply
 * was "Hello. Hello.", she asked again, and the call ended at 49 seconds with
 * nothing else said. On 21563 the reply was the single word "down" -- ASR
 * noise -- and she read it as a vote for Tamil and switched.
 *
 * Both come from the same omission: the block said to ask, and said to stay in
 * whatever they chose, but never said what to do when no choice arrives. So she
 * waited for one.
 *
 * A question the caller cannot answer must not be able to stop the call. This
 * version gives the question a default, a way to be skipped entirely, and a
 * hard limit of one asking.
 *
 * It also splits it off the greeting. She was saying "How can I help you today?
 * Which language would you like to use?" in one breath -- two questions, which
 * is the thing the whole prompt is otherwise built to prevent.
 * ---------------------------------------------------------------------------
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { apiKey } = JSON.parse(readFileSync(join(root, "server-v2/.snapserve.json"), "utf-8"));

const BASE = "https://app.snapserve.ai/api";
const H = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
const PRIYA = 717;

const HEADING = "STEP ZERO -- ASK WHICH LANGUAGE, THEN STAY IN IT:";

const NEW_BLOCK = `${HEADING}
Ask once, near the start, which language they would like: English or Tamil. Ask it as its own short turn -- never bolted onto your greeting or onto "how can I help you", which makes it two questions in one breath.

THIS QUESTION MUST NEVER HOLD UP THE CALL. That is the most important thing about it.
- If they answer, use that language from your VERY NEXT sentence.
- If they just start telling you about their shipment instead, that IS your answer. Use the language they used, and never raise it.
- If what comes back is not an answer -- a greeting, a noise, a single word you cannot place -- DO NOT ASK AGAIN and do not wait. Carry on in the language of whatever they have said so far, or English if you have nothing to go on, and move straight to what they need.
- A single unrecognised word is not a language choice. It is not Tamil and it is not English, it is noise, and choosing a language from it is worse than defaulting.
- You may ask about language ONCE in a call. Never twice. Guessing wrong costs one sentence, because they correct you and you switch. Asking twice leaves a caller listening to the same question with nothing to say to it, and that is how a call dies before it starts.
- If the injected CRM block already names this caller's language, do not ask at all. Open in it.

ONCE THE LANGUAGE IS SETTLED, STAY IN IT:
- Every sentence you say for the rest of the call is in that one language.
- DO NOT PUT WORDS FROM THE OTHER LANGUAGE INTO YOUR OWN SENTENCES. On an English call every word you say is English -- no Tamil acknowledgements, no Tamil filler dropped in for warmth. On a Tamil call speak Tamil, keeping only the trade words that are English at every freight desk anyway.
- The caller may mix as much as they like; that is how people speak here. Their mixing is not permission for you to mix -- you answer in the language they settled on.
- If they plainly switch later, follow them without commenting on it.
A caller answered in a language they did not choose has to work out whether you understood them, on top of everything else they rang about.`;

const revert = process.argv.includes("--revert");
const backupPath = join(root, "server-v2", ".agent-717-langblock-backup.json");

const live = await fetch(`${BASE}/agents/${PRIYA}`, { headers: H }).then((r) => r.json());
const current = (live.systemPrompt ?? "").replace(/\r/g, "");

/** Slice the existing block out: heading to the next ALL-CAPS heading. */
function replaceBlock(prompt, heading, replacement) {
  const lines = prompt.split("\n");
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return null;
  const isHeading = (l) => /^[A-Z][A-Z0-9 ,'\-()\/&"]{8,}:?\s*$/.test(l.trim());
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    // The block has its own sub-headings; stop only at the next top-level one.
    if (isHeading(lines[i]) && !lines[i].startsWith("THIS QUESTION") && !lines[i].startsWith("ONCE THE LANGUAGE")) {
      end = i;
      break;
    }
  }
  return [...lines.slice(0, start), replacement, "", ...lines.slice(end)].join("\n");
}

let next;
if (revert) {
  if (!existsSync(backupPath)) {
    console.error("no backup to revert to");
    process.exit(1);
  }
  next = JSON.parse(readFileSync(backupPath, "utf-8")).systemPrompt;
} else {
  writeFileSync(backupPath, JSON.stringify({ systemPrompt: current }, null, 2));
  next = replaceBlock(current, HEADING, NEW_BLOCK);
  if (!next) {
    console.error("could not find the language block — nothing changed");
    process.exit(1);
  }
}

const r = await fetch(`${BASE}/agents/${PRIYA}`, {
  method: "PATCH",
  headers: H,
  body: JSON.stringify({ systemPrompt: next }),
});
const p = (await fetch(`${BASE}/agents/${PRIYA}`, { headers: H }).then((x) => x.json())).systemPrompt;

const occurrences = (p.match(/STEP ZERO -- ASK WHICH LANGUAGE/g) ?? []).length;
console.log(
  `  Priya ${r.status}  ${current.length} -> ${p.length} chars\n` +
    `    one language block : ${occurrences === 1 ? "ok" : `CHECK (${occurrences})`}\n` +
    `    must not block     : ${p.includes("MUST NEVER HOLD UP THE CALL") ? "ok" : "FAIL"}\n` +
    `    never ask twice    : ${p.includes("You may ask about language ONCE in a call") ? "ok" : "FAIL"}\n` +
    `    noise is not a vote: ${p.includes("A single unrecognised word is not a language choice") ? "ok" : "FAIL"}\n` +
    `    own turn, not bolted: ${p.includes("never bolted onto your greeting") ? "ok" : "FAIL"}\n` +
    `    no self-mixing kept : ${p.includes("DO NOT PUT WORDS FROM THE OTHER LANGUAGE") ? "ok" : "FAIL"}\n` +
    `    spine intact        : ${p.includes("THE SHAPE OF AN ENQUIRY CALL") ? "ok" : "FAIL"}`
);
