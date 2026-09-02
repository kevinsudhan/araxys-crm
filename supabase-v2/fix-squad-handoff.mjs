/**
 * Fixes the handoff that failed on call 18433.
 *
 *   node supabase-v2/fix-squad-handoff.mjs
 *
 * ---------------------------------------------------------------------------
 * WHAT HAPPENED
 *
 * Vaishnavi announced the transfer three times and nothing moved:
 *
 *   "naan documentation desk-ku transfer pandren, paperwork mudikka.
 *    Just on the line irunga."  x3
 *
 * The squad was wired correctly -- both members present, handoff enabled,
 * Vaishnavi as entry. The problem was at the other end: PRANAY WAS STILL A
 * DRAFT. A draft agent cannot take a call, so the transfer had nowhere to land.
 * She said her line, the handoff failed silently, and she tried again.
 *
 * agentType was also wrong. Priya and Arun are customer_support; the two v2
 * agents were created as general, which is not the type the squad tooling
 * expects.
 *
 * And the squad's handoffGreeting was mine to get wrong. It is what the
 * RECEIVING agent says on picking up -- I had put Vaishnavi's transfer line in
 * it, so Pranay would have greeted the caller with "passing you back to the
 * desk" at the moment he took over.
 * ---------------------------------------------------------------------------
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { apiKey } = JSON.parse(readFileSync(join(root, "server-v2/.snapserve.json"), "utf-8"));

const BASE = "https://app.snapserve.ai/api";
const H = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

const SQUAD = 45;
const AGENTS = [1071, 1072];

for (const id of AGENTS) {
  const r = await fetch(`${BASE}/agents/${id}`, {
    method: "PATCH",
    headers: H,
    // A draft agent cannot receive a transfer, and general is not the type the
    // squad tooling is built around.
    body: JSON.stringify({ agentType: "customer_support", status: "active" }),
  });
  const a = await fetch(`${BASE}/agents/${id}`, { headers: H }).then((x) => x.json());
  console.log(`  ${a.name.padEnd(11)} ${r.status}  type=${a.agentType} status=${a.status}`);
}

await fetch(`${BASE}/squads/${SQUAD}`, {
  method: "PATCH",
  headers: H,
  body: JSON.stringify({
    description:
      "Customer-facing forwarder desk (Vaishnavi) handing off to the documentation desk (Pranay) once route, space and rate are fixed.",
    // Said by the agent handing over.
    handoffMessage: "One moment — I'm connecting you to a teammate who can help with this.",
    // Said by the agent taking over. "I've been briefed" is the line that stops
    // the customer repeating everything they just said.
    handoffGreeting:
      "Hi — I've been briefed on your shipment so far. I just need a few more details to get your documents generated.",
  }),
});

const s = await fetch(`${BASE}/squads/${SQUAD}`, { headers: H }).then((r) => r.json());
console.log(`\n  squad ${s.id} "${s.name}" — entry member ${s.entryMemberId}`);
for (const m of s.members ?? []) {
  console.log(`    ${m.agentName.padEnd(11)} ${m.roleName.padEnd(20)} handoff=${m.handoffEnabled}`);
}
console.log(`  on transfer : ${s.handoffMessage}`);
console.log(`  on pickup   : ${s.handoffGreeting}`);
