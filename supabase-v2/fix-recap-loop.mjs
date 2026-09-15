/**
 * Stops the agents restarting a recap they have already given.
 *
 *   node supabase-v2/fix-recap-loop.mjs
 *   node supabase-v2/fix-recap-loop.mjs --revert
 *
 * ---------------------------------------------------------------------------
 * CALL 21458
 *
 * Every time an answer came back unintelligible, she began the whole summary
 * again from the top -- route, weight, dimensions, ready date, rate -- and was
 * cut off part-way each time. The caller heard the same sentence over and over
 * and learned nothing new from any of it.
 *
 * This is the .com loop in another costume. That one was fixed only for email
 * addresses, and the rule that fixed it ("never restart a read-back") was
 * dropped when that section was rewritten, so nothing generalised it to
 * recaps. The behaviour is the same: an unclear reply is treated as "they did
 * not hear me", and the response is to say everything again rather than to ask
 * about the one thing that was not understood.
 *
 * Applied to all four agents, because all four recap and none of them has a
 * rule against repeating one.
 *
 * As with the email fix, this block quotes no sentence the agent could reuse.
 * Naming the phrase you want suppressed hands the model a template -- that is
 * exactly how the earlier attempt made the loop worse.
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
  [758, "Arun"],
  [1071, "Vaishnavi"],
  [1072, "Pranay"],
];

const HEADING = "NEVER GIVE THE SAME RECAP TWICE:";

const BLOCK = `${HEADING}
Once you have said a set of details back and noted them, they are settled. Saying them again does not confirm anything -- it tells the caller you have lost your place, and it costs them the part of the call where they could have been telling you something new.
- When a reply comes back unclear, ask about that ONE thing. Do not read everything you hold back to them in order to work out where you are.
- If you are interrupted part-way through a sentence, do not begin that sentence again from the start. Stop, and ask whether they caught it.
- Never repeat a list of details you have already given on this call. If they ask you to repeat something, repeat only the part they asked about.
- A summary belongs at the end, once, just before you name a price -- not after every answer.
- Silence, a noise, or something that is not language is not a request to repeat yourself. Ask a short question and wait.
On one real call the same summary was begun four times in a row, each time cut off part-way. Nothing in the conversation moved forward for a minute and a half.`;

const revert = process.argv.includes("--revert");

for (const [id, name] of AGENTS) {
  const backupPath = join(root, "server-v2", `.agent-${id}-recap-backup.json`);
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
      `rule ${after.includes(HEADING) ? "present" : "MISSING"}`
  );
}
