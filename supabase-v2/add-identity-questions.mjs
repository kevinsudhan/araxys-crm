/**
 * Teaches Vaishnavi to tie a caller to the mail they already sent.
 *
 *   node supabase-v2/add-identity-questions.mjs
 *   node supabase-v2/add-identity-questions.mjs --revert
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS SOLVES
 *
 * A call and an email are two sightings of the same person under two different
 * identifiers -- a phone number and an email address. The customer record is
 * where they meet, but only if something puts both on the same row.
 *
 * Somebody who mailed first and then rings from a number nobody has seen is
 * invisible: the number appears in no customer's phones, and never will. Two
 * questions close it, and the caller supplies the answer to both.
 *
 * Asking whether they have emailed comes FIRST, because the reference is the
 * stronger link -- it names the exact shipment as well as the customer, where
 * an address only names the customer. And a caller who has already written in
 * finds it faintly insulting to be asked for details they have already sent.
 * ---------------------------------------------------------------------------
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { apiKey } = JSON.parse(readFileSync(join(root, "server-v2/.snapserve.json"), "utf-8"));

const BASE = "https://app.snapserve.ai/api";
const H = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

const AGENT = 1071; // Vaishnavi
const backupPath = join(root, "server-v2", ".vaishnavi-identity-backup.json");

const HEADING = "HAVE THEY ALREADY WRITTEN TO US -- ASK BEFORE ANYTHING ELSE:";

const BLOCK = `${HEADING}
Near the start of a call with somebody you cannot place, ask whether they have already emailed us about this shipment. Ask it plainly: "have you emailed us about this one already?"
- If they say yes, ask for the reference from our reply: "there'll be a reference in the subject, something like ARX-C-0042-E-01 -- can you read it out?" Then read it back to confirm you heard it correctly.
- That reference tells us exactly which shipment they mean and lets us join this call to the emails already on file. It saves them repeating everything they wrote, which is the point.
- If they cannot find it, do not labour it. Move on and take the details fresh; it is a convenience, not a gate.
- If they say no, carry on normally.
Never ask this of somebody the injected block already identifies. You already know who they are, and asking implies you do not.

TAKE AN EMAIL ADDRESS BEFORE THE CALL ENDS:
For a caller we have not dealt with before, ask for their email address once you have the shipment details: "what's the best email to send the quotation to?"
- Confirm it back letter by letter if it is at all unusual. A wrong address means the quote goes nowhere and nobody finds out for a day.
- It is how their emails and their calls end up on the same file, so it is worth the ten seconds even when they say they prefer the phone.
- Ask once. If they will not give it, take it gracefully and carry on -- you can send the quotation to whoever they nominate later.`;

const revert = process.argv.includes("--revert");

const live = await fetch(`${BASE}/agents/${AGENT}`, { headers: H }).then((r) => r.json());
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
    console.log("  Vaishnavi: already applied");
    process.exit(0);
  }
  writeFileSync(backupPath, JSON.stringify({ systemPrompt: current }, null, 2));
  next = `${current.trim()}\n\n${BLOCK}`;
}

const r = await fetch(`${BASE}/agents/${AGENT}`, {
  method: "PATCH",
  headers: H,
  body: JSON.stringify({ systemPrompt: next }),
});
if (!r.ok) {
  console.error(`PATCH failed ${r.status} ${(await r.text()).slice(0, 200)}`);
  process.exit(1);
}

const after = (await fetch(`${BASE}/agents/${AGENT}`, { headers: H }).then((x) => x.json()))
  .systemPrompt;

console.log(
  `  Vaishnavi: ${current.length} -> ${after.length} chars` +
    `\n    reference question: ${after.includes(HEADING) ? "present" : "MISSING"}` +
    `\n    email question    : ${after.includes("TAKE AN EMAIL ADDRESS") ? "present" : "MISSING"}`
);
