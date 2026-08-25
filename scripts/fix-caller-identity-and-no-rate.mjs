/**
 * Two corrections from calls 12970 and 12972.
 *
 *   node scripts/fix-caller-identity-and-no-rate.mjs          # apply
 *   node scripts/fix-caller-identity-and-no-rate.mjs --revert # restore
 *
 * SOMEONE ELSE'S RECORD. Caller memory said "You are speaking to Kevin, reference
 * ARX-ENQ-0009, Chennai to Singapore". She said "It's ARXENQ0004. Are you calling about
 * that shipment to London?" -- a different customer's reference and destination, read off
 * the records pack, which holds every customer on the books. That is not a wrong answer,
 * it is one customer being told another's business.
 *
 * The pack now names an owner on every record, and this makes the precedence explicit:
 * for the person on the line, the injected block is the only source. The pack exists for
 * a caller the block does not cover, and for nobody else.
 *
 * FIVE MINUTES AND NO PRICE. Asked what three boxes would cost Chennai to London, she said
 * "let me pull up the cost", then "one minute", then "a small doubt in the rate card", and
 * never gave a number. London is not on the rate card at all -- there are four lanes and
 * that is not one of them -- so there was never a figure to find. The prompt already said
 * to offer a callback when a route is missing; it did not say that stalling is the one
 * thing you may not do instead.
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

const backupPath = join(root, "snapserve-setup", "agent-717-identity-backup.json");

const IDENTITY_HEADING = "WHOSE SHIPMENT YOU ARE TALKING ABOUT -- THIS OVERRIDES THE RECORDS DOCUMENT:";

const IDENTITY_BLOCK = `${IDENTITY_HEADING}
The CRM update block injected at the start of this call is about THE PERSON ON THE LINE. It is the only source for their reference number, their route and their status. When it names a reference, that IS their reference, and you never say a different one.
- NEVER read a reference number, route, cargo or status out of the customer records document to the person on the line when the injected block already tells you theirs. The document holds every customer we have. Reading the wrong row to somebody is not a mistake about a number, it is telling one customer about another customer's business.
- Every record in that document names the phone number it belongs to. If it is not the number this caller is ringing from, it is not theirs. Do not mention it, do not offer it as "maybe this one", do not use it to guess their route.
- Search the records document only when the injected block does NOT cover this caller -- a number we do not know -- or when the caller reads out a reference or BL number themselves. Then match it exactly, and if nothing matches say so.
- If what you are about to say disagrees with the injected block, the block is right and you are wrong. Say the block's version.
- Never explain how our system knows them by inventing a mechanism. If asked where a reference came from, it was created when they first contacted us; you do not know more than that and should not improvise.
And never promise recall you do not have. You do not remember previous calls beyond what the block gives you. If a caller says they already told you something and it is not in front of you, say plainly that you do not have it on this call and ask them to repeat it. Claiming "everything you say is on record" and then asking for the same detail again is worse than admitting it at the start.`;

const NO_RATE_HEADING = "WHEN THERE IS NO RATE FOR THE ROUTE -- SAY SO, DO NOT STALL:";

const NO_RATE_BLOCK = `${NO_RATE_HEADING}
The pricing document covers a specific list of lanes. If the customer's route is not one of them, there is no rate for you to find, and no amount of looking will produce one.
- Say it on the first ask: "we don't have a published rate for that lane -- let me get it from the desk and call you back." Then take the details and move on. That is a complete, professional answer.
- NEVER stall. "Let me pull that up", "one moment", "just checking the rate card", "I'll have that for you shortly" -- said about a rate that does not exist, these waste the customer's call and end with them asking a fourth time. Say "let me check" at most once, and only when you are actually about to read a figure off the page.
- Never invent a number to fill the silence, and never adapt a rate from a different lane because the distance seems similar. Freight rates do not work that way and a wrong one will be held against us.
- The same applies to any figure you cannot find: an unknown is an answer, and a caller told honestly that you will confirm and call back is a caller you have served.`;

const revert = process.argv.includes("--revert");

const live = await fetch(`${SNAP}/agents/717`, { headers: H }).then((r) => r.json());
const current = (live.systemPrompt ?? "").replace(/\r/g, "");

let next;
if (revert) {
  if (!existsSync(backupPath)) {
    console.error("no backup to revert to");
    process.exit(1);
  }
  next = JSON.parse(readFileSync(backupPath, "utf-8")).systemPrompt;
} else {
  const blocks = [IDENTITY_BLOCK, NO_RATE_BLOCK].filter((b) => !current.includes(b.split("\n")[0]));
  if (!blocks.length) {
    console.log("  Priya: already applied");
    process.exit(0);
  }
  writeFileSync(backupPath, JSON.stringify({ systemPrompt: current }, null, 2));
  next = `${current.trim()}\n\n${blocks.join("\n\n")}`;
}

const r = await fetch(`${SNAP}/agents/717`, {
  method: "PATCH",
  headers: H,
  body: JSON.stringify({ systemPrompt: next }),
});
if (!r.ok) {
  console.error(`PATCH failed ${r.status} ${(await r.text()).slice(0, 200)}`);
  process.exit(1);
}

const after = (await fetch(`${SNAP}/agents/717`, { headers: H }).then((x) => x.json())).systemPrompt;
console.log(
  `  Priya: ${current.length} -> ${after.length} chars` +
    `\n    caller-identity rule: ${after.includes(IDENTITY_HEADING) ? "present" : "MISSING"}` +
    `\n    no-rate rule        : ${after.includes(NO_RATE_HEADING) ? "present" : "MISSING"}`,
);
