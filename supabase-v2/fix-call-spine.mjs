/**
 * Gives Priya an ordered spine at the TOP of her prompt, and fixes the Tamil.
 *
 *   node supabase-v2/fix-call-spine.mjs
 *   node supabase-v2/fix-call-spine.mjs --revert
 *
 * ---------------------------------------------------------------------------
 * WHY POSITION, NOT MORE RULES
 *
 * Her prompt is past 43,000 characters, and almost every rule it needs is
 * already in there somewhere. On call 21526 she skipped the name, skipped the
 * company, never mentioned a sailing, never handed to Arun, and quoted below
 * the route minimum -- all of which are covered by sections she has had for
 * days. Appending a fourteenth block would compete with the thirteen already
 * being missed.
 *
 * So this goes in near the TOP, immediately after her identity, as a short
 * ordered list of what a call consists of. Everything below it stays as the
 * detail; this is the spine that says which step comes next and what may not be
 * skipped.
 *
 * WHAT 21526 GOT WRONG
 *
 *   - No name asked, no company asked.
 *   - Three values invented from replies that were not language: "one piece"
 *     from "Obrigado, viu?", "10 kg" from a Hindi fragment, and "ready" from
 *     the caller saying something else entirely.
 *   - Quoted Rs 966 for 0.23 CBM. The Singapore lane has a Rs 34,000 minimum.
 *   - No sailing date offered at any point.
 *   - No handoff. She closed the call herself.
 *   - Said the literary Tamil word for email rather than the word people
 *     actually use at a freight desk.
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

const MARKER = "THE SHAPE OF AN ENQUIRY CALL -- WORK THROUGH THIS IN ORDER:";

const SPINE = `${MARKER}
One thing at a time, in this order. Everything further down this prompt is detail about how to do each step well; this is the list of what a call actually consists of. Do not merge two steps into one sentence, and do not skip a step because the caller seems in a hurry.

1. What are they shipping, and where to. Route first.
2. Their name. "Can I take your name for the documentation?" Ask it early, once you know why they rang.
3. Their company, lightly. If they would rather not say, accept it and move on.
4. What the cargo actually is.
5. The size of ONE piece.
6. How many pieces.
7. The weight of one piece.
8. When the cargo is ready.
9. The rate: per CBM, their volume, the total, and the surcharges named. Never below the minimum for that route -- if their volume is under it, they are charged the minimum and you say so.
10. THE SAILING DATE. Find their destination in the space document and tell them the actual date and the booking cut-off. A quote without a sailing is half an answer.
11. Their answer on the rate.
12. Their email address, for the quotation.
13. Hand over to Arun at the documentation desk.

TWO THINGS THAT END THE STEP YOU ARE ON:
- If you did not HEAR an answer, you do not have one. A reply that is not language, or is a word in some other language, is not a number, not a name and not a yes. Say the line broke up and ask that one thing again. Never write down a value you did not hear -- not a piece count, not a weight, not a ready date. One is a number like any other and must be heard.
- If they answer something you did not ask, take it, say so briefly, and carry on from where you were rather than starting again.

YOU DO NOT END THE CALL YOURSELF:
When the rate is settled and you have their email, the call goes to Arun. Say plainly that you are passing them to the documentation desk for the remaining details, and transfer. Do not thank them and close instead -- the shipment cannot proceed without what Arun collects, and a caller who is wished a good day at that point has to ring back.
The only calls you close yourself are the ones that never became an enquiry: a wrong number, a question you answered in a sentence, or somebody who decided against it.

`;

/** The one line that governs which words get spoken in Tamil. */
const OLD_VOCAB =
  "- Do not translate trade vocabulary into formal Tamil nobody uses at a freight desk. Container, booking, invoice, BL, CBM, reefer, customs, demurrage, cut-off: say those in English inside the Tamil sentence, exactly as the customer does.";
const NEW_VOCAB =
  "- Do not translate trade vocabulary into formal Tamil nobody uses at a freight desk. Container, booking, invoice, BL, CBM, reefer, customs, demurrage, cut-off, email, mail, quotation, rate, shipment, pickup, sailing: say every one of those in English inside the Tamil sentence, exactly as the customer does.\n" +
  "- This matters most for the everyday ones. Nobody at this desk says the literary Tamil word for email, or for quotation, or for rate -- they say email, quotation, rate. Using the formal word makes you sound like a government form being read aloud, and callers often cannot tell what you mean.\n" +
  "- The test is simple: if a colleague at the next desk would say the English word, you say the English word.";

const revert = process.argv.includes("--revert");
const backupPath = join(root, "server-v2", ".agent-717-spine-backup.json");

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

  if (next.includes(OLD_VOCAB)) next = next.replace(OLD_VOCAB, NEW_VOCAB);
  else console.log("  note: vocabulary line not found, left as it was");

  if (!next.includes(MARKER)) {
    // After the identity paragraph, so the first thing she reads about the work
    // is the order of it.
    const lines = next.split("\n");
    const at = lines.findIndex((l, i) => i > 0 && l.trim() === "");
    lines.splice(at + 1, 0, SPINE);
    next = lines.join("\n");
  }
}

const r = await fetch(`${BASE}/agents/${PRIYA}`, {
  method: "PATCH",
  headers: H,
  body: JSON.stringify({ systemPrompt: next }),
});
const p = (await fetch(`${BASE}/agents/${PRIYA}`, { headers: H }).then((x) => x.json())).systemPrompt;

const pos = p.indexOf(MARKER);
console.log(
  `  Priya ${r.status}  ${current.length} -> ${p.length} chars\n` +
    `    spine present     : ${pos >= 0 ? `yes, at char ${pos}` : "MISSING"}\n` +
    `    name + company    : ${p.includes("Can I take your name for the documentation?") ? "ok" : "FAIL"}\n` +
    `    sailing date step : ${p.includes("THE SAILING DATE") ? "ok" : "FAIL"}\n` +
    `    route minimum     : ${p.includes("they are charged the minimum") ? "ok" : "FAIL"}\n` +
    `    handoff required  : ${p.includes("YOU DO NOT END THE CALL YOURSELF") ? "ok" : "FAIL"}\n` +
    `    english for email : ${p.includes("email, mail, quotation, rate, shipment, pickup, sailing") ? "ok" : "FAIL"}`
);
