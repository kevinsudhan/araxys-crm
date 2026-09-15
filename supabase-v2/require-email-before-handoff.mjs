/**
 * Makes the email address something the call cannot end without.
 *
 *   node supabase-v2/require-email-before-handoff.mjs
 *   node supabase-v2/require-email-before-handoff.mjs --revert
 *
 * ---------------------------------------------------------------------------
 * WHY THE EXISTING RULE DID NOT FIRE
 *
 * Vaishnavi already had "ask for their email address once you have the shipment
 * details". On call 18765 she got the details, quoted ₹14,868, asked to hand
 * over, and transferred -- never asking. The rule was true and never reached,
 * because nothing said WHEN, and the handoff came first.
 *
 * So it is now tied to a moment she cannot skip: before quoting, and before
 * handing over. A quotation has to be sent somewhere, which makes the address
 * part of quoting rather than an afterthought.
 *
 * Pranay gets it too. He collects the shipper and consignee details, so he is
 * the natural second chance -- and he had no rule at all, which is why the
 * address was lost even after a successful handoff.
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

const DESK_HEADING = "THE EMAIL ADDRESS IS NOT OPTIONAL -- GET IT BEFORE YOU QUOTE:";

const DESK_BLOCK = `${DESK_HEADING}
You cannot send a quotation to somebody whose address you do not have, so ask for it BEFORE you name a price, not after.
- The moment you have the cargo details and are about to quote, ask: "before I give you the rate — what's the best email to send the quotation to?"
- Read it back once as a normal word. Do not spell it out.
- If they will not give one, say plainly: "I'll need somewhere to send the quotation and the booking confirmation — is there an email I can use?" Ask once more, then let it go and note that they declined.
NEVER hand over to the documentation desk without having asked. If you are about to transfer and have no address, ask for it first — it takes ten seconds and without it we cannot send them anything at all.
An address is also how this call gets joined to any email they send us afterwards. Without one, their reply next week arrives as if from a stranger.`;

const DOCS_HEADING = "AN EMAIL ADDRESS, IF THE DESK DID NOT GET ONE:";

const DOCS_BLOCK = `${DOCS_HEADING}
You are sending documents to this customer, so you need somewhere to send them.
- Early on, ask: "what's the best email for the documents and the invoice?"
- If they say they have already given it, do not argue. Say "let me just confirm it" and read back what you have, or ask them to repeat it once.
- Read it back once as a normal word, never spelled out letter by letter.
- Two attempts at most. If it is still not right, take the rest of the details and say the desk will confirm the address separately.
Without an address the paperwork has nowhere to go, and their later emails cannot be matched to this shipment.`;

const revert = process.argv.includes("--revert");

for (const [id, name, heading, block] of [
  [DESK, "Vaishnavi", DESK_HEADING, DESK_BLOCK],
  [DOCS, "Pranay", DOCS_HEADING, DOCS_BLOCK],
]) {
  const backupPath = join(root, "server-v2", `.agent-${id}-email-backup.json`);
  const live = await fetch(`${BASE}/agents/${id}`, { headers: H }).then((r) => r.json());
  const current = (live.systemPrompt ?? "").replace(/\r/g, "");

  let next;
  if (revert) {
    if (!existsSync(backupPath)) {
      console.log(`  ${name}: no backup, skipped`);
      continue;
    }
    next = JSON.parse(readFileSync(backupPath, "utf-8")).systemPrompt;
  } else {
    if (current.includes(heading)) {
      console.log(`  ${name}: already applied`);
      continue;
    }
    writeFileSync(backupPath, JSON.stringify({ systemPrompt: current }, null, 2));
    next = `${current.trim()}\n\n${block}`;
  }

  const r = await fetch(`${BASE}/agents/${id}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ systemPrompt: next }),
  });
  const after = (await fetch(`${BASE}/agents/${id}`, { headers: H }).then((x) => x.json()))
    .systemPrompt;

  console.log(
    `  ${name.padEnd(10)} ${r.status}  ${current.length} -> ${after.length} chars  ` +
      `rule ${after.includes(heading) ? "present" : "MISSING"}`
  );
}
