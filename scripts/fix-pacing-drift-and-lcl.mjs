/**
 * Two corrections from call 12945.
 *
 *   node scripts/fix-pacing-drift-and-lcl.mjs          # apply
 *   node scripts/fix-pacing-drift-and-lcl.mjs --revert # restore both agents
 *
 * PACING DRIFT. The one-question-at-a-time rule was already in the prompt and she kept it
 * for the first few turns, then asked "could you tell me the dimensions of one piece, and
 * how many pieces you have? Also, what's the weight of one piece? And can they be
 * stacked?" -- four questions in one breath, once she was mid-flow and had a checklist in
 * view. Restating the rule more firmly would not fix that; a rule you have to remember to
 * apply is the one you drop when you are concentrating on something else. So this adds a
 * mechanical check she can run on the sentence itself before saying it.
 *
 * QUOTING THE WRONG BASIS. She quoted 37,200 rupees per container for twelve pieces
 * totalling about 15.8 CBM -- half a 20GP. The rate card has LCL at 1,050 per CBM for that
 * lane, which is roughly 16,600, and LCL groupage is what the desk actually booked her
 * into: 3.6m of a shared 40GP. So the customer was quoted for a whole container we were
 * never going to give them. The number was also 200 rupees off the card's own arithmetic.
 *
 * A quote that does not match what gets booked is worse than a high quote. It is the
 * number the customer repeats to their buyer, and the one they argue about when the
 * invoice arrives for something else.
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

const backupPath = (id) => join(root, "snapserve-setup", `agent-${id}-pacing2-backup.json`);

const CHECK_HEADING = "BEFORE YOU SPEAK -- THE ONE-QUESTION CHECK:";

const CHECK_BLOCK = `${CHECK_HEADING}
You already have the rule that you ask for one thing at a time. You keep it at the start of a call and then lose it once you are concentrating on the details, so run this check on the sentence itself, every turn, for the whole call:
COUNT THE QUESTIONS IN WHAT YOU ARE ABOUT TO SAY. IF THERE IS MORE THAN ONE, DELETE EVERYTHING AFTER THE FIRST AND SAY ONLY THAT.
- "What size is one piece, and how many do you have?" is two. Say only "what size is one piece?"
- "And the weight? Also, can I take your name?" is two. Say only "and what does one piece weigh?"
- The words that give it away are "and", "also", "as well" and "one more thing" sitting between two things you want to know. If you are about to say one of those in a question, stop at it.
The questions you deleted are not lost. They are the next three turns, and you will get better answers to them because the customer is only holding one thing in their head at a time.
This applies just as hard when you are working through a checklist and can see everything you still need. Especially then -- that is the moment it happens.`;

const LCL_HEADING = "WHICH RATE TO QUOTE -- LCL OR A WHOLE CONTAINER:";

const LCL_BLOCK = `${LCL_HEADING}
Quote the basis we will actually book them on. A customer sending fifteen cubic metres is going into groupage with other people's cargo, not into their own container, and quoting them a container price for it is quoting for something they will never receive.
- WORK OUT THE VOLUME FIRST. One piece length x width x height, in metres, multiplied by the number of pieces. 120 x 100 x 110cm is 1.32 CBM, so twelve of them is about 15.8 CBM.
- A 20GP holds roughly 33 CBM, a 40GP about 67, a 40HC about 76. If their volume is comfortably under a container -- say under about two thirds of one -- quote the LCL rate per CBM and multiply by their volume. Say it as both: "1,050 rupees per CBM, so about 16,600 for your 15.8 cubic metres."
- Quote a container rate only when they are taking a whole container: they ask for one, they have said FCL, or the volume genuinely fills one.
- Respect the minimum. If the LCL line says a minimum number of CBM, a smaller consignment is charged at that minimum, and you say so rather than quoting below it.
- Add the surcharges from the rate card and say what they are -- THC at both ends and the documentation fee. Give the total and how you reached it, then stop; do not round it to something tidier than the card.
- If you are unsure whether it is LCL or FCL, ask them -- one question, on its own.
Every figure comes from the pricing document. Do the arithmetic on the page, not from memory, and never adjust a total to make it look neater.`;

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
      console.log(`  ${name}: already applied`);
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
    console.error(`  ${name}: PATCH failed ${r.status}`);
    return;
  }
  const after = (await fetch(`${SNAP}/agents/${id}`, { headers: H }).then((x) => x.json())).systemPrompt;
  console.log(
    `  ${name}: ${current.length} -> ${after.length} chars` +
      blocks.map((b) => `\n    ${b.split("\n")[0].slice(0, 42)} ${after.includes(b.split("\n")[0]) ? "yes" : "NO"}`).join(""),
  );
}

// Arun collects paperwork and never quotes, so he gets the question check only.
await patch(717, "Priya", [CHECK_BLOCK, LCL_BLOCK]);
await patch(758, "Arun", [CHECK_BLOCK]);
