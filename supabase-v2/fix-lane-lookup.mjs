/**
 * Makes finding the caller's route a mechanical step, not an instruction.
 *
 *   node supabase-v2/fix-lane-lookup.mjs
 *   node supabase-v2/fix-lane-lookup.mjs --revert
 *
 * ---------------------------------------------------------------------------
 * CALL 21481
 *
 * A Chennai to Singapore shipment was given: "the next sailing is September
 * 5th, that one is full; the one after is September 12th, cut-off September
 * 10th."
 *
 * The space document says:
 *   Chennai to Colombo   -> 2026-09-05 (cut-off 09-03), 2026-09-12 (cut-off 09-10)
 *   Chennai to Singapore -> 2026-09-08 (cut-off 09-06), 2026-09-15 (cut-off 09-13)
 *
 * Both dates and the cut-off are Colombo's, exactly. Colombo is the FIRST route
 * section in the document. She did not search for Singapore -- she read the top
 * of the file.
 *
 * The lane rule added earlier says "find the route first", which is a principle,
 * and principles lose to whatever is nearest to hand. This replaces it with a
 * procedure tied to the document's actual shape: the headings are "## Chennai
 * to <destination>", and there is a named heading to locate before any figure
 * is read. A step you can carry out is worth more than a rule you can agree
 * with.
 *
 * Also tightened: on the same call a piece count of one was taken from a reply
 * that was not language. The no-invent rule covered numbers heard wrongly; it
 * did not say that a missing answer defaults to nothing rather than to one.
 * ---------------------------------------------------------------------------
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { apiKey } = JSON.parse(readFileSync(join(root, "server-v2/.snapserve.json"), "utf-8"));

const BASE = "https://app.snapserve.ai/api";
const H = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

const AGENTS = [
  [717, "Priya"],
  [1071, "Vaishnavi"],
];

const HEADING = "FINDING THE RIGHT SAILING -- DO THIS BEFORE YOU SAY ANY DATE:";

const BLOCK = `${HEADING}
The space document is grouped by route. Each group starts with a heading naming the two ports, and every sailing under it says which route it serves. Sailings for different destinations sit one after another in the same document, and the first group in the file is NOT the caller's group unless their destination happens to be named on it.
Before you say a sailing date, a cut-off, or whether space is left, carry out these three steps:
1. Say the caller's destination to yourself. Not the origin -- everything leaves Chennai, so the destination is what tells the groups apart.
2. Find the heading that names THAT destination. If you cannot find one, this route has no sailings in the document and you say so.
3. Read the dates only from under that heading. If the block you are reading does not name their destination, you are in the wrong group and everything in it is somebody else's shipment.
Then say the destination out loud with the date, every time: name the port when you name the sailing. It costs two words and it is the only way a caller can catch you reading the wrong group.
- Never take a date because it is sooner, or because it is the first one you came to.
- The cut-off belongs to the same sailing as the date. Never pair a date from one line with a cut-off from another.
- If their destination has no sailing in the window they want, say exactly that and offer the dates their own route does have.
On one real call a Singapore shipment was offered a 5 September sailing and a 12 September sailing with a 10 September cut-off. All three figures belonged to the Colombo group, which sits at the top of the document. Singapore's own sailings were further down and were never read.

A COUNT YOU DID NOT HEAR IS NOT ONE:
When you ask how many pieces and the reply is not a number you actually heard, you do not have a count. You especially do not have one.
- One is a number like any other. It is not the safe answer, it is not the obvious answer, and it must be heard before it is written down. A single fridge and four fridges differ by three, and by four times the freight.
- If the reply was not language, or was language you could not parse, say the line broke up and ask again in plain words.
- Two attempts, then move on with the count outstanding and say you will confirm it. Never quote a total off a count you did not hear.`;

const revert = process.argv.includes("--revert");

for (const [id, name] of AGENTS) {
  const backupPath = join(root, "server-v2", `.agent-${id}-lanelookup-backup.json`);
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
    if (current.includes(HEADING)) {
      console.log(`  ${name}: already applied`);
      continue;
    }
    writeFileSync(backupPath, JSON.stringify({ systemPrompt: current }, null, 2));
    next = `${current.trimEnd()}\n\n${BLOCK}`;
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
      `lane-lookup ${after.includes(HEADING) ? "ok" : "MISSING"}  ` +
      `count-not-one ${after.includes("A COUNT YOU DID NOT HEAR IS NOT ONE") ? "ok" : "MISSING"}`
  );
}
