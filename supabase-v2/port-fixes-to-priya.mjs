/**
 * Ports every hardening rule onto Priya, and adds the two call 21411 demands.
 *
 *   node supabase-v2/port-fixes-to-priya.mjs
 *   node supabase-v2/port-fixes-to-priya.mjs --revert
 *
 * ---------------------------------------------------------------------------
 * WHY PRIYA IS BEHIND
 *
 * Every fix from this session went into Vaishnavi. When the desk switched to
 * Priya, the fixes did not come with her -- she is still running the prompt
 * that predates all of them, plus the three intake questions added separately.
 *
 * Call 21411 is what that costs. Chennai to Singapore was quoted as a
 * 10 September sailing with an 8 September cut-off. Those are the Jeddah row's
 * numbers exactly; she read the wrong line of the space document. The rate she
 * gave, 1,550 per CBM, is on no row at all -- the four lanes are 4200, 4800,
 * 3400 and 6100, and Singapore is 4200. She then said "booked" twice, having
 * pushed the whole call through answers the recogniser rendered as Portuguese.
 *
 * WHAT IS COPIED VERBATIM FROM VAISHNAVI
 *
 *   THE ORDER OF A RATE CALL      quote before any transfer
 *   NEVER TURN NOISE INTO A NUMBER  incl. restating a figure as a different one
 *   AFTER THEY SAY YES...           incl. "I'll book it" being the same promise
 *   WHEN SOMEBODY CORRECTS YOU      the correction is the value
 *   HAVE THEY ALREADY WRITTEN TO US joins a call to the mail already on file
 *
 * Her own email block is left alone -- it is the newer wording and already
 * says what Vaishnavi's says.
 *
 * WHAT IS NEW HERE
 *
 * Two rules neither agent had, both straight out of 21411: read the row for the
 * caller's own lane, and say so when you did not understand rather than
 * advancing the call on an answer you could not parse.
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
const SOURCE = 1071; // Vaishnavi, who carries the fixes

/** Blocks to lift across, in the order they should read. */
const PORT = [
  "HAVE THEY ALREADY WRITTEN TO US -- ASK BEFORE ANYTHING ELSE:",
  "WHEN SOMEBODY CORRECTS YOU, THE CORRECTION WINS:",
  "THE ORDER OF A RATE CALL -- YOU MAY NOT TRANSFER BEFORE YOU HAVE QUOTED:",
  "NEVER TURN NOISE INTO A NUMBER:",
  "AFTER THEY SAY YES, DO NOT SAY YOU HAVE BOOKED IT:",
];

const LANE_HEADING = "THE SAILING AND THE RATE COME FROM THE CALLER'S OWN LANE:";

const LANE_BLOCK = `${LANE_HEADING}
The space document and the pricing document both list several routes. Every figure you say out loud must come from the row whose route matches where THIS caller is shipping from and to. Getting the right number off the wrong line is the easiest mistake on this desk and the hardest for a customer to catch.
- Find the route first. Read the origin and destination on the row before you read anything else on it. If the row does not say the caller's route, it is not their row, however close the ports are.
- The sailing date, the booking cut-off, the transit time and the rate all come from the SAME row. Never take a date from one lane and a price from another, and never carry a date across because it happens to be sooner.
- Say the route back with the date, so a wrong row is audible: name the destination when you name the sailing rather than saying only a date.
- If the caller's lane has no sailing in the window they want, say exactly that and offer the dates their lane does have. A date that is not on their route is worse than no date -- they plan a lorry and a buyer around it.
- If their route is not in the document at all, say we do not have a published sailing or rate for that lane and the desk will confirm and call back.
On one real call a Singapore shipment was given a 10 September sailing with an 8 September cut-off. Both figures belonged to the Jeddah row. The customer was told a date their cargo could never have sailed on.

IF YOU DID NOT UNDERSTAND, SAY SO -- DO NOT CARRY ON:
Lines drop, the recogniser mangles things, and what reaches you is sometimes not language at all. When that happens the call cannot advance, and pretending otherwise is how a booking gets made out of noise.
- If an answer does not make sense as a reply to your question, do not treat it as agreement, a number, or a name. Say the line broke up and ask that ONE thing again.
- Never take an unintelligible reply as a yes. A price, a sailing and a booking each need an answer you actually understood.
- If two attempts at the same question both come back unusable, stop asking it. Take what you do have, tell them plainly you will confirm the rest another way, and note what is outstanding.
- If most of the call is coming through badly, say so kindly and offer to call them back on a better line. That is a complete and professional answer.
On one real call the answers arriving were fragments of other languages entirely, and the conversation still ran all the way to a quoted rate and the word "booked". Nothing in that exchange had been established.`;

const revert = process.argv.includes("--revert");
const backupPath = join(root, "server-v2", ".agent-717-portedfixes-backup.json");

const [priya, source] = await Promise.all([
  fetch(`${BASE}/agents/${PRIYA}`, { headers: H }).then((r) => r.json()),
  fetch(`${BASE}/agents/${SOURCE}`, { headers: H }).then((r) => r.json()),
]);
const current = (priya.systemPrompt ?? "").replace(/\r/g, "");
const donor = (source.systemPrompt ?? "").replace(/\r/g, "");

/** Every ALL-CAPS heading in the donor, so a block can be sliced to the next one. */
const isHeading = (l) => /^[A-Z][A-Z0-9 ,'\-()\/&"]{8,}:?\s*$/.test(l.trim());

function block(prompt, heading) {
  const lines = prompt.split("\n");
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isHeading(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trimEnd();
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
  next = current;

  for (const heading of PORT) {
    if (next.includes(heading)) {
      console.log(`  already present: ${heading.slice(0, 46)}…`);
      continue;
    }
    const b = block(donor, heading);
    if (!b) {
      console.log(`  NOT FOUND in donor: ${heading.slice(0, 46)}…`);
      continue;
    }
    next = `${next.trimEnd()}\n\n${b}`;
    console.log(`  ported (${b.length} chars): ${heading.slice(0, 46)}…`);
  }

  if (!next.includes(LANE_HEADING)) {
    next = `${next.trimEnd()}\n\n${LANE_BLOCK}`;
    console.log("  added: lane discipline + did-not-understand");
  }
}

const r = await fetch(`${BASE}/agents/${PRIYA}`, {
  method: "PATCH",
  headers: H,
  body: JSON.stringify({ systemPrompt: next }),
});
const p = (await fetch(`${BASE}/agents/${PRIYA}`, { headers: H }).then((x) => x.json())).systemPrompt;

const has = (s) => (p.includes(s) ? "ok" : "FAIL");
console.log(
  `\n  Priya ${r.status}  ${current.length} -> ${p.length} chars\n` +
    `    quote before transfer : ${has("YOU MAY NOT TRANSFER BEFORE YOU HAVE QUOTED")}\n` +
    `    no invented numbers   : ${has("NEVER TURN NOISE INTO A NUMBER")}\n` +
    `    number read-back      : ${has("IT MUST BE THE NUMBER YOU HEARD")}\n` +
    `    never say booked      : ${has("DO NOT SAY YOU HAVE BOOKED IT")}\n` +
    `    "I'll book it" too    : ${has("is the same promise to a customer")}\n` +
    `    correction wins       : ${has("THE CORRECTION WINS")}\n` +
    `    already emailed us    : ${has("HAVE THEY ALREADY WRITTEN TO US")}\n` +
    `    right lane's row      : ${has(LANE_HEADING)}\n` +
    `    say when unclear      : ${has("IF YOU DID NOT UNDERSTAND, SAY SO")}\n` +
    `    her intake kept       : ${has("IT IS HOW THE QUOTATION REACHES THEM")}\n` +
    `    her voice kept        : ${has("GET THE CALLER'S NAME EARLY")}`
);
