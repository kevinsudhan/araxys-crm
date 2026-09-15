/**
 * Fixes what calls 19073-19094 exposed.
 *
 *   node supabase-v2/fix-quote-before-handoff.mjs
 *   node supabase-v2/fix-quote-before-handoff.mjs --revert
 *
 * ---------------------------------------------------------------------------
 * WHAT WENT WRONG, FROM THE RECORDINGS
 *
 * CALL 19075 -- Vaishnavi took the route, name, company, cargo, weight and
 * dimensions, then asked for the piece count and the email address in the SAME
 * breath, got both, and transferred to Pranay. She never said a price. The
 * caller rang to find out what it costs and was handed to the documents desk
 * without a figure.
 *
 * That is caused by a block I added earlier the same day, which said "NEVER
 * hand over to the documentation desk without having asked [for the email]".
 * She read the condition as a trigger: email obtained, therefore clear to
 * transfer. It also pulled the email question to before the quote, which is why
 * it landed jammed onto the piece-count question. That block is removed here.
 *
 * CALL 19085 -- again no price. She went from the dimensions straight to
 * offering a sailing date, as though a date answered the question.
 *
 * CALL 19094 -- this one went well on the desk side: she quoted 4,200 per CBM,
 * gave the volume, the total and the surcharges, asked for the answer, got it,
 * then took the email and transferred. This is the call the others should look
 * like, and it proves the behaviour is reachable -- what was missing was any
 * rule making it the required order rather than one of several.
 *
 * CALL 19094, PRANAY'S HALF -- worse, and not what was reported, but it is on
 * the same recording:
 *   - Caller gave a GSTIN that did not survive the line. Pranay read back
 *     "ABCDE1234F" -- the specimen GSTIN from a form. He invented a tax number.
 *   - Caller gave the consignee name; Pranay read it back as "Pranay", his own
 *     name, and supplied "Anna Nagar West" for an address fragment where the
 *     caller had said nothing of the kind.
 *   - Caller said "about 20,000", then "30,000". Pranay accepted each in turn
 *     without ever asking which was the invoice value.
 * These go onto a commercial invoice. A blank field costs a follow-up call; an
 * invented one is a false declaration with our name on it.
 * ---------------------------------------------------------------------------
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { apiKey } = JSON.parse(readFileSync(join(root, "server-v2/.snapserve.json"), "utf-8"));

const BASE = "https://app.snapserve.ai/api";
const H = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

const DESK = 1071; // Vaishnavi
const DOCS = 1072; // Pranay

/** The block from the earlier fix. It is the direct cause of call 19075. */
const BAD_HEADING = "THE EMAIL ADDRESS IS NOT OPTIONAL -- GET IT BEFORE YOU QUOTE:";

/**
 * The gate. One ordered sequence, and one thing that may not happen before it.
 *
 * Written as a prohibition on transferring rather than an instruction to quote,
 * because "remember to quote" is advice she can satisfy in her own order and a
 * refusal to transfer is a condition she has to check at the moment it matters.
 */
const ORDER_HEADING = "THE ORDER OF A RATE CALL -- YOU MAY NOT TRANSFER BEFORE YOU HAVE QUOTED:";

const ORDER_BLOCK = `${ORDER_HEADING}
An enquiry call runs in this order, and you do not reach a later step until the one before it is done.
1. What they are shipping: the route, the cargo, the size of ONE piece, the weight of ONE piece, and HOW MANY pieces. One question per turn.
2. Work out the volume and read the rate off the pricing document.
3. SAY THE RATE OUT LOUD -- the rate per unit, their volume, the total, and the surcharges. This is the step the customer rang for.
4. Ask for their answer: "shall I put it through at that?" Wait for a real yes or no.
5. Take the sailing date, if you do not already have it.
6. Take their email address for the quotation.
7. Only then, and only if they want to go ahead, hand over to the documentation desk.

YOU MAY NOT TRANSFER A CALL TO THE DOCUMENTATION DESK UNTIL YOU HAVE SAID A PRICE AND HEARD THEIR ANSWER TO IT.
There is no exception to this. Not because you have their email address. Not because you have every cargo detail. Not because they sound ready, or ask what happens next, or say they want to proceed. Having the email is NOT a reason to transfer -- it is one of the things you collect before you are allowed to.
- If you have the cargo details and have not quoted: QUOTE. Do not hand over, do not ask a further question, do not move on.
- A SAILING DATE IS NOT A PRICE. Answering "there's a sailing on the 8th" instead of naming a rate is the same failure. Give the figure first, then the date.
- If you are missing the piece count, that is one question away. Ask it and then quote. It is never a reason to transfer instead.
- If the route genuinely has no published rate, say so plainly and say the desk will call back with the figure. That is a complete answer, and it is the ONLY case where a call moves on without one.
Before you say the words that pass the call to the documentation desk, check one thing: have I told this customer what it costs? If not, you are not transferring yet.
A call that collects every detail and then hands over without a figure has failed at the only thing it was for. The customer now waits for somebody else to ring them back and tell them the price they rang us to ask about.`;

/**
 * The email question, put back where it belongs.
 *
 * It was moved before the quote by the earlier block, which is how it ended up
 * tacked onto the piece-count question in the same turn.
 */
const EMAIL_OLD =
  'For a caller we have not dealt with before, ask for their email address once you have the shipment details: "what’s the best email to send the quotation to?"';
const EMAIL_OLD_ALT =
  "For a caller we have not dealt with before, ask for their email address once you have the shipment details: \"what's the best email to send the quotation to?\"";
const EMAIL_NEW =
  "For a caller we have not dealt with before, ask for their email address AFTER you have quoted and they have answered on the rate, and before you hand the call anywhere else: \"what's the best email to send the quotation to?\" Ask it as its own turn -- never tacked onto another question, and never as the thing you do instead of quoting.";

const DOCS_INVENT_HEADING = "NEVER INVENT A VALUE -- READ BACK ONLY WHAT YOU ACTUALLY HEARD:";

const DOCS_BLOCK = `${DOCS_INVENT_HEADING}
Everything you collect goes onto a commercial invoice and a packing list. Those are customs documents. A value you supplied because one was needed is not a small error -- it is a false declaration with our name on it.
- NEVER say a specimen, example or placeholder value. If you did not hear a GSTIN, you do not say a GSTIN. "ABCDE1234F" and anything else of that shape is the example from a form, not this customer's number, and reading one back as though they gave it to you puts a fabricated tax number on their paperwork.
- NEVER complete a half-heard value. If you caught "921, 13th Main Road" and the rest was noise, then "921, 13th Main Road" is what you have. Do not supply the locality, the city, the pin code or the state because they would make it look like a finished address.
- NEVER use a name from this call as a party's name. Not your own, not Vaishnavi's, not the company's. If you are about to read the consignee back as "Pranay", you have misheard the caller -- stop and ask again.
- If a value arrives garbled, say so and ask for that ONE thing again: "the line broke up on the address -- can you give me that again?" Two attempts, then note it as outstanding and move on.
- When you read a value back, read exactly what you hold. If part of it is missing, say the part you have and ask for the rest. Do not smooth over the gap.
A field left blank gets a follow-up call. A field filled with a plausible invention gets discovered at customs.

WHEN A NUMBER CHANGES, ASK WHICH ONE IS RIGHT:
A caller who says "about 20,000" and then says "30,000" has not corrected themselves. You do not know which they meant, and one of the two is going on an invoice.
- Stop and ask plainly: "sorry -- is that twenty thousand or thirty thousand?" Then take the answer.
- Do not simply adopt whichever came last. Do not average them, round them, or pick the one that sounds more plausible.
- This applies to invoice values, weights, package counts and dimensions -- anything that becomes a figure on a document.
This is different from a correction. A correction is a caller replacing a value deliberately, and the correction wins. Two different numbers offered in a row, with no sign which replaced which, is a question you have to ask.

THE CONSIGNEE IS AT THE OTHER END, NOT IN INDIA:
These are exports. The consignee is the importer receiving the cargo at the destination, so their country is the destination country.
- If you are given India as the consignee country on a shipment leaving India, ask once: "that's the party receiving it at the destination -- is that address abroad?"
- If they confirm it anyway, take what they give you and note it for the desk. Ask once; do not argue with the customer about their own paperwork.`;

const revert = process.argv.includes("--revert");

for (const [id, name] of [
  [DESK, "Vaishnavi"],
  [DOCS, "Pranay"],
]) {
  const backupPath = join(root, "server-v2", `.agent-${id}-quotegate-backup.json`);
  const live = await fetch(`${BASE}/agents/${id}`, { headers: H }).then((r) => r.json());
  const current = (live.systemPrompt ?? "").replace(/\r/g, "");

  let next = current;

  if (revert) {
    if (!existsSync(backupPath)) {
      console.log(`  ${name}: no backup, skipped`);
      continue;
    }
    next = JSON.parse(readFileSync(backupPath, "utf-8")).systemPrompt;
  } else {
    writeFileSync(backupPath, JSON.stringify({ systemPrompt: current }, null, 2));

    if (id === DESK) {
      // Out with the block that turned "ask for the email" into "transfer now".
      const at = next.indexOf(BAD_HEADING);
      if (at !== -1) next = next.slice(0, at).trimEnd();

      if (next.includes(EMAIL_OLD)) next = next.replace(EMAIL_OLD, EMAIL_NEW);
      else if (next.includes(EMAIL_OLD_ALT)) next = next.replace(EMAIL_OLD_ALT, EMAIL_NEW);
      else console.log(`  ${name}: WARNING -- email line not found, left as it was`);

      if (!next.includes(ORDER_HEADING)) next = `${next.trimEnd()}\n\n${ORDER_BLOCK}`;
    } else {
      if (!next.includes(DOCS_INVENT_HEADING)) next = `${next.trimEnd()}\n\n${DOCS_BLOCK}`;
    }
  }

  const r = await fetch(`${BASE}/agents/${id}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ systemPrompt: next }),
  });
  const after = (await fetch(`${BASE}/agents/${id}`, { headers: H }).then((x) => x.json()))
    .systemPrompt;

  const checks =
    id === DESK
      ? [
          ["quote gate", after.includes(ORDER_HEADING)],
          ["bad block gone", !after.includes(BAD_HEADING)],
          ["email after quote", after.includes("AFTER you have quoted")],
        ]
      : [
          ["no-invent", after.includes(DOCS_INVENT_HEADING)],
          ["changed number", after.includes("WHEN A NUMBER CHANGES")],
          ["consignee abroad", after.includes("THE CONSIGNEE IS AT THE OTHER END")],
        ];

  console.log(
    `  ${name.padEnd(10)} ${r.status}  ${current.length} -> ${after.length} chars  ` +
      checks.map(([k, ok]) => `${k}:${ok ? "ok" : "FAIL"}`).join("  ")
  );
}
