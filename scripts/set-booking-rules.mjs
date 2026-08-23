/**
 * Makes Priya close the two things that turn an enquiry into a booking.
 *
 *   node scripts/set-booking-rules.mjs          # apply
 *   node scripts/set-booking-rules.mjs --revert # restore from the backup it writes
 *
 * The CRM now promotes an enquiry to an in-process shipment on its own, the moment one
 * record carries both a named sailing date and an accepted rate. That rule is only as
 * good as the call: if nobody ever asks which sailing the customer wants, every enquiry
 * sits in inbound forever, and the automation looks broken when it is simply starved.
 *
 * So the prompt now requires the date to be asked for on every rate conversation, and
 * requires the agent to close the loop on the rate rather than leaving "let me think"
 * ambiguous. The extractor's `quote_accepted` field is deliberately strict about what
 * counts as a yes -- a wrong true starts paperwork nobody agreed to -- so the prompt has
 * to produce an unambiguous yes or no for it to read.
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
const backupPath = join(root, "snapserve-setup", "agent-717-booking-backup.json");

const HEADING = "CLOSING A RATE CONVERSATION -- THE SAILING DATE AND THE ANSWER:";

const BLOCK = `${HEADING}
Two things decide whether this stays an enquiry or becomes a booking, and both are yours to get.
1. THE SAILING DATE. On any call where you discuss a rate or space, ask which sailing they want before the call ends: "which sailing date are you looking at?" If they are not fixed, offer the actual dates you have on that route and ask them to pick one. A shipment with no date cannot be booked, and an enquiry that never got a date is one somebody has to ring back about.
   - Accept a rough window if that is genuinely all they have ("first week of September") and say you will hold the nearest sailing, but always try for a specific date first.
   - Repeat the date back once so it is unambiguous on the recording.
2. THE ANSWER ON THE RATE. Do not let a quote trail off. Once you have given a rate, ask plainly whether they want to go ahead at that rate: "shall I book it at that?" Then take the answer at face value and do not soften it.
   - If they say yes, confirm it in one clear sentence: "right, booked at [rate] on the [date] sailing."
   - If they want to think about it or need to check with someone, say that is fine and that you will note it as not confirmed. Do not record a maybe as a yes, and do not press.
   - If they are still negotiating, it is not a yes. Keep negotiating within your band or take it to the desk.
Only a real yes counts. Someone saying "okay" while you are still describing the rate is acknowledgement, not agreement -- ask again directly before treating it as confirmed. A booking started on a misheard yes means paperwork, space and a container committed for a customer who never agreed to any of it.`;

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
    console.log(`  ${AGENT.name}: booking rules already present, nothing to do`);
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
console.log(
  `  ${AGENT.name}: ${current.length} -> ${after.systemPrompt.length} chars, booking rules ${
    revert ? (present ? "STILL PRESENT" : "removed") : present ? "present" : "NOT APPLIED"
  }`
);
