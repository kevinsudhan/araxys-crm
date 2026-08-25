/**
 * Stops Priya opening a call by asking an unknown caller for a BL number.
 *
 *   node scripts/fix-bl-question.mjs          # apply
 *   node scripts/fix-bl-question.mjs --revert # restore from the backup it writes
 *
 * The recognition section was written for returning customers and gets that right: greet
 * them by name, never make them read out a number we already hold. But its last clause
 * said to ask for a BL number "if the block says known_customer is absent" — which is
 * exactly the case for somebody who has never rung before.
 *
 * So the first thing a new customer heard was a request for a bill of lading they cannot
 * possibly have. A BL number is issued when a booking is confirmed; a new enquiry has no
 * booking, and a caller asking for a rate has nothing to read out. It made the desk sound
 * unable to help anyone it had not met.
 *
 * This replaces that one bullet. Everything else in the section, and everything else in
 * the prompt, is left exactly as it was — verified by diffing the result.
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
const backupPath = join(root, "snapserve-setup", "agent-717-bl-backup.json");

const OLD =
  "- Only ask for a BL number if they raise a shipment that is clearly none of the ones you were given, or if the block says known_customer is absent.";

const NEW = `- NEVER open a call by asking for a BL number. A new enquiry does not have one -- a BL number is issued when a booking is confirmed, so a caller ringing for a rate has nothing to read out, and asking makes us sound unable to help anyone we have not met before.
- If there is no CRM block, or it says known_customer is absent, this is somebody new or somebody we do not recognise. Find out what they are calling about first. If it is a new shipment, no BL number exists and none is needed -- take their name for the file, and get on with helping them.
- Ask for a BL or reference number only once you know they are asking about an EXISTING shipment and you cannot work out which one it is. Even then, a company name or "the Colombo one" is usually enough.`;

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
  if (current.includes("NEVER open a call by asking for a BL number")) {
    console.log(`  ${AGENT.name}: already fixed, nothing to do`);
    process.exit(0);
  }
  if (!current.includes(OLD)) {
    console.error("  the clause being replaced is not in the live prompt — stopping rather than guessing");
    process.exit(1);
  }
  writeFileSync(backupPath, JSON.stringify({ systemPrompt: current }, null, 2));
  next = current.replace(OLD, NEW);
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

const after = (await fetch(`${SNAP}/agents/${AGENT.id}`, { headers: H }).then((x) => x.json())).systemPrompt;
console.log(
  `  ${AGENT.name}: ${current.length} -> ${after.length} chars` +
    `\n    old clause present : ${after.includes(OLD)}` +
    `\n    new guidance present: ${after.includes("NEVER open a call by asking for a BL number")}`
);
