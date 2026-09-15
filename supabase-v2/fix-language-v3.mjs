/**
 * The language question: always asked, never able to stall the call.
 *
 *   node supabase-v2/fix-language-v3.mjs
 *   node supabase-v2/fix-language-v3.mjs --revert
 *
 * ---------------------------------------------------------------------------
 * TWO FAILED VERSIONS, AND WHY
 *
 * v1 (blocking). "Ask which language, their answer decides the call." It never
 * said what to do when no answer arrives, so she waited for one. Call 21567:
 * asked, got "Hello. Hello.", asked again, and the call ended at 49 seconds
 * with nothing else said.
 *
 * v2 (non-blocking). Added "if they just start telling you about their
 * shipment, that IS your answer, and never raise it." Callers always open by
 * stating their need, so that clause fired on every call and she stopped asking
 * altogether. Call 21580: no language question at all; the caller had to demand
 * Tamil himself.
 *
 * Each version fixed the other's failure by causing it in reverse. The fault in
 * both is the same: the answer was allowed to decide whether the QUESTION
 * happens, when it should only ever decide what happens AFTER it.
 *
 * v3 separates the two. The question is unconditional -- it is asked on every
 * call, once, as its own turn, no matter what the caller has already said. What
 * comes back only chooses between "use what they said" and "use the default".
 * Neither branch waits, and neither branch skips.
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

const BLOCK = `${HEADING}
ASK THIS ON EVERY CALL, and ask it before anything about the shipment. One short question offering the two: English or Tamil. It is its own turn -- never bolted onto your greeting, never bolted onto "how can I help you".
Ask it even if they have already started explaining what they want. Their opening sentence tells you what they need; it does not tell you what they would rather be spoken to in, and plenty of people open in English and would far rather carry on in Tamil.

WHAT THEY SAY BACK ONLY DECIDES WHAT YOU SPEAK. IT NEVER DECIDES WHETHER THE CALL CONTINUES.
- A clear answer: use that language from your VERY NEXT sentence.
- Anything else -- a greeting, a noise, a single word you cannot place, silence, a fragment of some third language: DO NOT ASK AGAIN AND DO NOT WAIT. Take the language of their first words, or English if you have nothing to go on, say your next sentence in it, and move straight to the shipment.
- A single unrecognised word is not a language choice. Choosing a language from noise is worse than defaulting quietly, because they then have to fight you back out of it.
- You ask about language ONCE in a call, at most, whatever happens. Guessing wrong costs one sentence: they correct you and you switch. Asking twice leaves a caller listening to a question they have nothing to say to, and that is how a call dies before it has started.
- If the injected CRM block already names the language this caller uses with us, do not ask at all. Open in that language and carry on.

ONCE THE LANGUAGE IS SETTLED, STAY IN IT:
- Every sentence you say for the rest of the call is in that one language.
- DO NOT PUT WORDS FROM THE OTHER LANGUAGE INTO YOUR OWN SENTENCES. On an English call every word you say is English -- no Tamil acknowledgements, no Tamil filler, nothing dropped in for warmth. On a Tamil call speak Tamil, keeping only the trade words that are English at every freight desk anyway.
- The caller may mix as much as they like; that is how people speak here. Their mixing is not permission for you to mix -- you answer in the language they settled on.
- If they plainly switch later, follow them without commenting on it.
A caller answered in a language they did not choose has to work out whether you understood them, on top of everything else they rang about.`;

const revert = process.argv.includes("--revert");
const backupPath = join(root, "server-v2", ".agent-717-langv3-backup.json");

const live = await fetch(`${BASE}/agents/${PRIYA}`, { headers: H }).then((r) => r.json());
const current = (live.systemPrompt ?? "").replace(/\r/g, "");

/** Swap the block out: from its heading to the next top-level heading. */
function swap(prompt, heading, replacement) {
  const lines = prompt.split("\n");
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return null;
  const isTopHeading = (l) =>
    /^[A-Z][A-Z0-9 ,'\-()\/&"]{8,}:?\s*$/.test(l.trim()) &&
    !l.startsWith("WHAT THEY SAY BACK") &&
    !l.startsWith("ONCE THE LANGUAGE");
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isTopHeading(lines[i])) {
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
  next = swap(current, HEADING, BLOCK);
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

// Read back and confirm from the live prompt, not from what was sent.
const p = (await fetch(`${BASE}/agents/${PRIYA}`, { headers: H }).then((x) => x.json())).systemPrompt.replace(/\r/g, "");
const blocks = (p.match(/STEP ZERO -- ASK WHICH LANGUAGE/g) ?? []).length;

console.log(
  `  Priya ${r.status}  ${current.length} -> ${p.length} chars  (sent ${next.length})\n` +
    `    persisted correctly : ${p === next.replace(/\r/g, "") ? "ok" : "MISMATCH — read back differs from what was sent"}\n` +
    `    exactly one block   : ${blocks === 1 ? "ok" : `CHECK (${blocks})`}\n` +
    `    asked on every call : ${p.includes("ASK THIS ON EVERY CALL") ? "ok" : "FAIL"}\n` +
    `    asked even if talking: ${p.includes("Ask it even if they have already started explaining") ? "ok" : "FAIL"}\n` +
    `    never waits         : ${p.includes("DO NOT ASK AGAIN AND DO NOT WAIT") ? "ok" : "FAIL"}\n` +
    `    noise is not a vote : ${p.includes("A single unrecognised word is not a language choice") ? "ok" : "FAIL"}\n` +
    `    once per call       : ${p.includes("ONCE in a call, at most") ? "ok" : "FAIL"}\n` +
    `    no self-mixing      : ${p.includes("DO NOT PUT WORDS FROM THE OTHER LANGUAGE") ? "ok" : "FAIL"}\n` +
    `    spine intact        : ${p.includes("THE SHAPE OF AN ENQUIRY CALL") ? "ok" : "FAIL"}\n` +
    `    other blocks intact : ${
      ["YOU MAY NOT TRANSFER BEFORE YOU HAVE QUOTED", "NEVER TURN NOISE INTO A NUMBER",
       "FINDING THE RIGHT SAILING", "NEVER GIVE THE SAME RECAP TWICE",
       "YOU INTRODUCE YOURSELF ONCE", "DO NOT SAY YOU HAVE BOOKED IT"].every((s) => p.includes(s))
        ? "ok"
        : "FAIL"
    }`
);
