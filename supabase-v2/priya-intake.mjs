/**
 * Gives Priya the three questions the CRM needs and she was not asking.
 *
 *   node supabase-v2/priya-intake.mjs
 *   node supabase-v2/priya-intake.mjs --revert
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS MISSING
 *
 * She already takes the name, the company, the route, the size of one piece,
 * how many, the weight, the sailing date and the answer on the rate. Three
 * things the record needs never got asked:
 *
 *   - an EMAIL ADDRESS. Not asked at all, and actively forbidden by the line
 *     "never ask for anything beyond name and company on the call". Without it
 *     the quotation has nowhere to go and their reply next week arrives from a
 *     stranger.
 *   - WHAT THE GOODS ARE. The collection list has measurements but no cargo
 *     description, and the paperwork and customs requirements hang off it.
 *   - WHEN THE CARGO IS READY, which is what makes a sailing realistic.
 *
 * WHAT IS DELIBERATELY UNTOUCHED
 *
 * Her voice. No tone rule, no language rule, no turn-taking rule, nothing about
 * how she quotes or what she may say about a booking. The additions are written
 * in her own register -- second person, plain, one short example, the reason it
 * matters at the end -- and slot in beside the questions she already asks.
 *
 * ONE EXAMPLE PER QUESTION, ON PURPOSE. A sister agent was given a long section
 * about reading email addresses back that quoted the exact sentence it was
 * banning; she then said that sentence on the next call and spelled the address
 * four times. Naming a phrase hands the model a template. These blocks stay
 * short and quote nothing that is being forbidden.
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

/** The line that forbids the email ask, and its replacement. */
const BLOCKER =
  "- Never ask for anything beyond name and company on the call -- no addresses, no tax numbers, no bank or payment details. Arun at the documentation desk collects the rest once a booking is actually going ahead.";
const UNBLOCKED =
  "- Beyond the name, the company and an email address, do not ask for anything else on this call -- no postal addresses, no tax numbers, no bank or payment details. Arun at the documentation desk collects the rest once a booking is actually going ahead.";

/** Two bullets into the list she already works through before quoting. */
const LIST_ANCHOR = "- the size of ONE piece: length, width and height in centimetres";
const LIST_WITH_CARGO =
  "- what the goods actually are -- textiles, machinery parts, cotton bed linen. A description, not a container count\n" +
  "- the size of ONE piece: length, width and height in centimetres";

const READY_ANCHOR = "- the weight of one piece in kilograms";
const READY_WITH_DATE =
  "- the weight of one piece in kilograms\n" +
  "- when the cargo will be ready to move";

const EMAIL_HEADING = "TAKE AN EMAIL ADDRESS -- IT IS HOW THE QUOTATION REACHES THEM:";

const EMAIL_BLOCK = `${EMAIL_HEADING}
Once you have given the rate and they have told you where they stand on it, ask where to send the quotation. Frame it as what it is -- somewhere to send this, not a form you are filling in.
- Ask it on its own turn, after the rate. Never in the same breath as another question, and never instead of quoting.
- Say it back one time, as ordinary words at ordinary speed. Not letter by letter, however bad the line is.
- The moment they agree it is right, it is settled. Go on to the next thing.
- If they say it is wrong, take their version and say it back one final time. That is the last time an address is spoken on this call.
- If they would rather not give one, accept it straight away and carry on, the same as with the company name.
The address is also what joins this call to anything they write to us afterwards. Without one, their reply next week arrives as if from somebody we have never spoken to.

WHAT THEY ARE SENDING, AND WHEN IT IS READY:
Two things the file needs that the measurements do not tell you, and both are easy to forget once you are concentrating on the numbers.
- Ask what the cargo actually is, early, while you are working out what they need. A description is what the documents and the customs requirements hang off, and "boxes" is not one -- if that is all you get, ask once more what is in them.
- Ask when the cargo will be ready to move. That is what decides which sailing is realistic, and an enquiry with no ready date is one somebody has to ring back about.
One question each, in its own turn, the same as everything else.`;

const revert = process.argv.includes("--revert");
const backupPath = join(root, "server-v2", ".agent-717-intake-backup.json");

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

  if (next.includes(BLOCKER)) next = next.replace(BLOCKER, UNBLOCKED);
  else console.log("  note: the no-email line was not found, left as it was");

  if (!next.includes("what the goods actually are") && next.includes(LIST_ANCHOR))
    next = next.replace(LIST_ANCHOR, LIST_WITH_CARGO);

  if (!next.includes("when the cargo will be ready to move") && next.includes(READY_ANCHOR))
    next = next.replace(READY_ANCHOR, READY_WITH_DATE);

  if (!next.includes(EMAIL_HEADING)) next = `${next.trimEnd()}\n\n${EMAIL_BLOCK}`;
}

const r = await fetch(`${BASE}/agents/${PRIYA}`, {
  method: "PATCH",
  headers: H,
  body: JSON.stringify({ systemPrompt: next }),
});
const p = (await fetch(`${BASE}/agents/${PRIYA}`, { headers: H }).then((x) => x.json())).systemPrompt;

console.log(
  `  Priya ${r.status}  ${current.length} -> ${p.length} chars\n` +
    `    email question   : ${p.includes(EMAIL_HEADING) ? "ok" : "FAIL"}\n` +
    `    email unblocked  : ${p.includes(BLOCKER) ? "STILL BLOCKED" : "ok"}\n` +
    `    cargo description: ${p.includes("what the goods actually are") ? "ok" : "FAIL"}\n` +
    `    ready date       : ${p.includes("when the cargo will be ready to move") ? "ok" : "FAIL"}\n` +
    `    tone untouched   : ${p.includes("ONE QUESTION AT A TIME") && p.includes("GET THE CALLER'S NAME EARLY") ? "ok" : "CHECK"}`
);
