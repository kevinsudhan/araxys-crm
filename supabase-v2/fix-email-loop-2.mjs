/**
 * Undoes my own fix, which made the problem worse.
 *
 *   node supabase-v2/fix-email-loop-2.mjs
 *   node supabase-v2/fix-email-loop-2.mjs --revert
 *
 * ---------------------------------------------------------------------------
 * WHAT I GOT WRONG
 *
 * After call 19816 I added twenty-one lines about reading email addresses back.
 * Those lines contained, verbatim:
 *
 *   - the exact sentence I wanted suppressed ("let me confirm your email")
 *   - a worked example of an address said aloud
 *   - the word "spell" six times, with a whole section about spelling
 *   - the literal string "dot com, dot com, dot com"
 *
 * On the next call (19825) she read the address back correctly once, then began
 * that exact sentence and spelled the address twice. The prohibition supplied
 * the template. Naming a phrase in order to ban it puts it in front of the
 * model far more forcefully than the ban removes it, and length made it worse:
 * a section that talks about spelling for twenty lines is a section about
 * spelling.
 *
 * So this replaces the lot with seven lines that describe what to DO, quote no
 * sentence she could reuse, and mention spelling exactly once as a flat ban.
 * It also folds in the older duplicate email section, which was separately
 * telling her to read the address back.
 *
 * TWO SMALLER FIXES FROM THE SAME CALL:
 *
 *   Caller: 1/2 kg
 *   Agent:  30 kilo, sari.
 *
 * She restated a number as a different number. The no-invention rule covered
 * turning noise into a figure; it did not cover replacing one figure with
 * another that sounded more sensible.
 *
 *   Caller: Ok book pannidunga.
 *   Agent:  Sari, book panren.  ("right, I'll book it")
 *
 * The existing rule bans claiming a booking is done. She used the future tense
 * instead, which is the same promise to a customer.
 * ---------------------------------------------------------------------------
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { apiKey } = JSON.parse(readFileSync(join(root, "server-v2/.snapserve.json"), "utf-8"));

const BASE = "https://app.snapserve.ai/api";
const H = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
const DESK = 1071;

/** Everything from the first email heading to the last, replaced by one block. */
const FIRST = "TAKE AN EMAIL ADDRESS BEFORE THE CALL ENDS:";
const AFTER = "THE ORDER OF A RATE CALL -- YOU MAY NOT TRANSFER BEFORE YOU HAVE QUOTED:";

/**
 * Short, positive, and quoting nothing she can copy.
 *
 * The correction rule that sat between the two email sections is kept, because
 * it is about corrections generally and not about addresses.
 */
const REPLACEMENT = `TAKING AN EMAIL ADDRESS:
Ask for it once you have quoted and they have answered on the rate, as its own question, before you hand the call anywhere.
- Let them finish. People pause in the middle of an address; that pause is not your turn.
- Say it back one time, as ordinary words at ordinary speed. Never letter by letter, whatever the line is like.
- The moment they agree, it is settled. Go straight to your next question. A short agreeing sound is agreement.
- If they say it is wrong, take their version and say it back one final time. That is the last time an address is spoken on this call.
- Still not agreed after that? Tell them you will confirm it another way and carry on with the rest of the details.
An address you did not get costs one follow-up message. An address repeated at somebody costs the whole call.

WHEN SOMEBODY CORRECTS YOU, THE CORRECTION WINS:
The moment a caller corrects a detail, their correction replaces what you had. It is now the value. Anything you hear afterwards that contradicts it is noise on the line, not a second correction.
- Never revert to an earlier version of something after being corrected.
- If what arrives next is unintelligible, say the line broke up and ask about that ONE thing again. Do not rebuild the whole answer from the fragment.
- Never say back a value you are no longer confident about. Half an address tells the caller you were not listening.

`;

const NUMBER_LINE =
  "- WHEN YOU SAY A NUMBER BACK, IT MUST BE THE NUMBER YOU HEARD. Not a nearby one, not a rounder one, not the one that would make sense for this kind of cargo. On a real call the answer was one figure and you repeated a completely different one back as though it had been agreed. If what you heard is not a usable number, say you did not catch it and ask again.";

const BOOKING_LINE =
  "- This covers what you are ABOUT to do as much as what is done. \"I'll book it\" is the same promise to a customer as \"it's booked\" -- they put the phone down and arrange a lorry either way. What is true is that you are passing it to the desk and the desk confirms it back to them.";

const revert = process.argv.includes("--revert");
const backupPath = join(root, "server-v2", `.agent-${DESK}-emailloop2-backup.json`);

const live = await fetch(`${BASE}/agents/${DESK}`, { headers: H }).then((r) => r.json());
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

  const from = current.indexOf(FIRST);
  const to = current.indexOf(AFTER);
  if (from === -1 || to === -1 || to < from) {
    console.error("could not locate the email sections — nothing changed");
    process.exit(1);
  }
  next = current.slice(0, from) + REPLACEMENT + current.slice(to);

  if (!next.includes("IT MUST BE THE NUMBER YOU HEARD")) {
    next = next.replace(
      "- NEVER round an unclear answer to a plausible-sounding figure.",
      `${NUMBER_LINE}\n- NEVER round an unclear answer to a plausible-sounding figure.`
    );
  }
  if (!next.includes("is the same promise to a customer")) {
    next = next.replace(
      '- Never "booked", never "confirmed", never "you\'re on that sailing".',
      `- Never "booked", never "confirmed", never "you're on that sailing".\n${BOOKING_LINE}`
    );
  }
}

const r = await fetch(`${BASE}/agents/${DESK}`, {
  method: "PATCH",
  headers: H,
  body: JSON.stringify({ systemPrompt: next }),
});
const p = (await fetch(`${BASE}/agents/${DESK}`, { headers: H }).then((x) => x.json())).systemPrompt;

const count = (re) => (p.match(re) ?? []).length;
console.log(
  `  Vaishnavi ${r.status}  ${current.length} -> ${p.length} chars\n` +
    `    template phrase gone : ${/confirm your email/i.test(p) ? "STILL THERE" : "ok"}\n` +
    `    "dot com" gone       : ${/dot com/i.test(p) ? "STILL THERE" : "ok"}\n` +
    `    example address gone : ${/kevinsudhan/i.test(p) ? "STILL THERE" : "ok"}\n` +
    `    mentions of "spell"  : ${count(/spell/gi)} (was 7)\n` +
    `    number-readback rule : ${/IT MUST BE THE NUMBER YOU HEARD/.test(p) ? "ok" : "FAIL"}\n` +
    `    will-book rule       : ${/is the same promise to a customer/.test(p) ? "ok" : "FAIL"}\n` +
    `    quote gate intact    : ${/YOU MAY NOT TRANSFER BEFORE YOU HAVE QUOTED/.test(p) ? "ok" : "FAIL"}`
);
