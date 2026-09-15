/**
 * Makes the caller choose the language, and stops the agent mixing on her own.
 *
 *   node supabase-v2/fix-language-choice.mjs
 *   node supabase-v2/fix-language-choice.mjs --revert
 *
 * ---------------------------------------------------------------------------
 * WHERE THE UNASKED-FOR TAMIL COMES FROM
 *
 * Not from the language section. From this line, in the turn-taking rules:
 *
 *   "acknowledge it briefly and naturally before moving on. Vary how you do it
 *    -- a short 'right', 'okay', 'perfect, noted', 'sari' ..."
 *
 * "sari" sits in a list of ordinary English acknowledgements, so it gets used
 * in calls that are entirely in English. On one such call it appeared three
 * times -- "Sari, and what are the goods", "Ready now, sari", "Sari, I'm
 * connecting you to Arun" -- to a caller who had spoken nothing but English.
 *
 * The language section makes it worse in the other direction: it says a caller
 * who mixes is a Tamil caller, which is true of callers and was never meant to
 * license the agent mixing first.
 *
 * So: the caller is asked once, straight after the greeting, and the answer
 * holds. The agent's own speech stops being a place where languages meet.
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
Straight after your greeting, before anything about the shipment, ask which language they would like to use. One short question, offering the two: English or Tamil.
- Their answer decides the call. Your VERY NEXT sentence is in that language, not the one after it.
- Then stay there. Every sentence you say for the rest of the call is in that one language.
- DO NOT PUT WORDS FROM THE OTHER LANGUAGE INTO YOUR OWN SENTENCES. If the call is in English, every word you say is English -- no Tamil acknowledgements, no Tamil filler, nothing dropped in for warmth. If the call is in Tamil, speak Tamil, keeping only the trade words that are English at every freight desk anyway.
- The caller may mix as much as they like. That is how people speak and it is not a problem. Their mixing is not permission for you to mix -- you answer in the language they chose.
- If they answer your question in a third language, or plainly switch later, follow them without commenting on it.
- Ask this once. Never raise the subject of language again.
- If the injected CRM block already names the language this caller uses with us, do not ask at all. Open in that language and carry on.
A caller who is answered in a language they did not choose has to work out whether you understood them, on top of everything else they rang about.`;

/** The acknowledgement list that leaks Tamil into English calls. */
const OLD_ACK =
  '- When they answer, acknowledge it briefly and naturally before moving on. Vary how you do it -- a short "right", "okay", "perfect, noted", "sari", repeating the number back once -- and keep it to a few words. Never use the same acknowledgement every turn; that is what makes an agent sound like a form.';
const NEW_ACK =
  '- When they answer, acknowledge it briefly and naturally before moving on. Vary how you do it -- a short "right", "okay", "got it", "noted", repeating the number back once -- and keep it to a few words. Never use the same acknowledgement every turn; that is what makes an agent sound like a form.\n' +
  "- Acknowledge in the language of the call. On an English call the acknowledgement is an English word; on a Tamil call it is a Tamil one. Never reach across for a word that sounds friendlier -- to the caller it just sounds like you have switched language mid-sentence.";

const revert = process.argv.includes("--revert");
const backupPath = join(root, "server-v2", ".agent-717-language-backup.json");

const live = await fetch(`${BASE}/agents/${PRIYA}`, { headers: H }).then((r) => r.json());
const current = (live.systemPrompt ?? "").replace(/\r/g, "");

let next;
if (revert) {
  if (!existsSync(backupPath)) {
    console.error("no backup to revert to");
    process.exit(1);
  }
  next = JSON.parse(readFileSync(backupPath, "utf-8")).systemPrompt;
} else {
  writeFileSync(backupPath, JSON.stringify({ systemPrompt: current }, null, 2));
  next = current;

  if (next.includes(OLD_ACK)) next = next.replace(OLD_ACK, NEW_ACK);
  else console.log("  note: acknowledgement line not found, left as it was");

  // Immediately before the ordered spine, because it happens before step 1.
  const spine = "THE SHAPE OF AN ENQUIRY CALL -- WORK THROUGH THIS IN ORDER:";
  if (!next.includes(HEADING)) {
    if (next.includes(spine)) next = next.replace(spine, `${BLOCK}\n\n${spine}`);
    else next = `${next.trimEnd()}\n\n${BLOCK}`;
  }
}

const r = await fetch(`${BASE}/agents/${PRIYA}`, {
  method: "PATCH",
  headers: H,
  body: JSON.stringify({ systemPrompt: next }),
});
const p = (await fetch(`${BASE}/agents/${PRIYA}`, { headers: H }).then((x) => x.json())).systemPrompt;

const sariInAck = /"perfect, noted", "sari"/.test(p);
console.log(
  `  Priya ${r.status}  ${current.length} -> ${p.length} chars\n` +
    `    asks the language  : ${p.includes(HEADING) ? `yes, at char ${p.indexOf(HEADING)}` : "MISSING"}\n` +
    `    sari out of ack    : ${sariInAck ? "STILL THERE" : "ok"}\n` +
    `    ack in call's lang : ${p.includes("Acknowledge in the language of the call") ? "ok" : "FAIL"}\n` +
    `    no self-mixing     : ${p.includes("DO NOT PUT WORDS FROM THE OTHER LANGUAGE") ? "ok" : "FAIL"}\n` +
    `    spine still first  : ${p.indexOf(HEADING) < p.indexOf("THE SHAPE OF AN ENQUIRY CALL") ? "ok" : "CHECK"}`
);
