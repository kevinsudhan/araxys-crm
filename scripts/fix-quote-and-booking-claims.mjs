/**
 * Two corrections to Priya, from a real call, plus the pacing rules for Arun.
 *
 *   node scripts/fix-quote-and-booking-claims.mjs          # apply
 *   node scripts/fix-quote-and-booking-claims.mjs --revert # restore both agents
 *
 * On call 12934 she told a customer "booked at 1,200 dollars per CBM on the 28th August
 * sailing". Three things were wrong with that sentence and two of them are hers:
 *
 *   - Nothing was booked. She has no booking tool and never will -- allocation happens on
 *     our side after the call, and it can refuse. Here it would have: there is no
 *     Chennai to Singapore sailing on the 28th, so the customer was promised a confirmed
 *     booking the system was always going to decline.
 *   - 1,200 dollars per CBM is invented. The pricing document quotes Chennai to Singapore
 *     at Rs 1,050 per CBM and contains no dollar figure anywhere. A wrong rate spoken with
 *     confidence is the most expensive thing a freight desk can say.
 *
 * The third was the availability document letting her read across a route boundary, fixed
 * separately in spaceKb.ts.
 *
 * Arun gets the one-question-at-a-time rules that Priya already had. His first turn after
 * a handoff asked for twelve fields in a single breath -- the same failure, on the other
 * desk, because the pacing fix was only ever applied to agent 717.
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

const backupPath = (id) => join(root, "snapserve-setup", `agent-${id}-claims-backup.json`);

const QUOTE_HEADING = "QUOTING A RATE, AND WHAT YOU MAY SAY ABOUT A BOOKING:";

const QUOTE_BLOCK = `${QUOTE_HEADING}
EVERY RATE YOU SAY OUT LOUD COMES FROM THE PRICING DOCUMENT IN YOUR KNOWLEDGE, IN RUPEES.
- Quote in Indian rupees. The rate card is in rupees and only in rupees. Never quote dollars, never convert, and never invent a figure because one is needed to move the conversation on. A wrong rate said confidently is the most expensive sentence on this desk.
- Read the rate for the customer's actual route and container type. If the route is not in the pricing document, say we will confirm the rate with the desk and call back -- do not estimate from a similar route.
- Discount only within the negotiation band given for that route. Outside the band needs the desk, and you say so.
- Always say the unit: "per CBM", "per container". A number with no unit gets remembered as whichever one is worse for us.

YOU CANNOT BOOK ANYTHING, AND YOU MUST NOT SAY THAT YOU HAVE.
The booking is placed by the desk after this call, against live container space, and it can be refused -- the sailing may have filled, or the cargo may not fit what is left.
- Never say "booked", "it's confirmed", "you're on that sailing" or anything a customer would reasonably repeat to their own buyer as a fact.
- Say what is actually true: that you are putting it through and it will be confirmed. "Right, I'll put that through for the 27th at that rate and we'll confirm it back to you" is honest and sounds no less capable.
- If they ask outright whether it is confirmed, tell them plainly that it goes to the desk and they get a confirmation -- do not soften that into a yes.
A customer who is told "booked" arranges a truck, a warehouse slot and a buyer's delivery date around it. If the booking is then refused, that is our word broken, not a small correction.`;

const PACING_HEADING = "ONE QUESTION AT A TIME -- HOW TO ASK FOR ANYTHING:";

const PACING_BLOCK = `${PACING_HEADING}
Ask for ONE piece of information, then stop talking and let them answer. This is the single most important thing about how you sound on a call.
- Never ask two questions in one turn, and never read a list aloud. The fields you need are a checklist for YOU to work through one item at a time, not a script to recite at the customer. A caller who hears twelve questions in one breath answers the last one and forgets the rest, and you end up asking everything again.
- When they answer, acknowledge it briefly and naturally before moving on. Vary how you do it -- a short "right", "okay", "perfect, noted", "sari", repeating the number back once -- and keep it to a few words. Never use the same acknowledgement every turn; that is what makes an agent sound like a form.
- Then ask the next thing. One question, wait, acknowledge, next. That rhythm is the whole job.
- If they volunteer several things at once, take all of it, say so briefly, and never ask again for something they already told you.
- Do not tell the customer how many details you need, and do not announce the process. Just start asking.
Silence after your question is the customer thinking, not a cue to fill it with the next question. Wait.`;

const revert = process.argv.includes("--revert");

async function patch(id, name, blocks) {
  const live = await fetch(`${SNAP}/agents/${id}`, { headers: H }).then((r) => r.json());
  const current = (live.systemPrompt ?? "").replace(/\r/g, "");

  let next;
  if (revert) {
    if (!existsSync(backupPath(id))) {
      console.log(`  ${name}: no backup, skipped`);
      return;
    }
    next = JSON.parse(readFileSync(backupPath(id), "utf-8")).systemPrompt;
  } else {
    const missing = blocks.filter((b) => !current.includes(b.split("\n")[0]));
    if (!missing.length) {
      console.log(`  ${name}: already applied, nothing to do`);
      return;
    }
    writeFileSync(backupPath(id), JSON.stringify({ systemPrompt: current }, null, 2));
    next = `${current.trim()}\n\n${missing.join("\n\n")}`;
  }

  const r = await fetch(`${SNAP}/agents/${id}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ systemPrompt: next }),
  });
  if (!r.ok) {
    console.error(`  ${name}: PATCH failed ${r.status} ${(await r.text()).slice(0, 160)}`);
    return;
  }

  const after = (await fetch(`${SNAP}/agents/${id}`, { headers: H }).then((x) => x.json())).systemPrompt;
  console.log(
    `  ${name}: ${current.length} -> ${after.length} chars` +
      blocks.map((b) => `\n    ${b.split("\n")[0].slice(0, 44)} ${after.includes(b.split("\n")[0]) ? "yes" : "NO"}`).join(""),
  );
}

// Priya quotes and is the one who takes the booking decision; Arun collects paperwork and
// never quotes, so he needs the pacing rules and nothing about rates.
await patch(717, "Priya", [QUOTE_BLOCK]);
await patch(758, "Arun", [PACING_BLOCK]);
