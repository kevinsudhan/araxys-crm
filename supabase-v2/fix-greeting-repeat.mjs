/**
 * Stops the agents re-introducing themselves when spoken over.
 *
 *   node supabase-v2/fix-greeting-repeat.mjs
 *   node supabase-v2/fix-greeting-repeat.mjs --revert
 *
 * ---------------------------------------------------------------------------
 * CALL 21473
 *
 * The greeting was begun three times in the first ten seconds, restarting each
 * time the caller spoke over it. To the caller it is the same sentence again
 * and again before the conversation has started, which reads as a broken line.
 *
 * The recap rule added earlier does not reach this. A greeting is not "a list
 * of details you have already given", so nothing forbade repeating it.
 *
 * As with every one of these, the block quotes no sentence the agent could
 * copy -- naming the phrase you want suppressed is what made the email loop
 * worse rather than better.
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

const HEADING = "YOU INTRODUCE YOURSELF ONCE, AND ONLY ONCE:";

const BLOCK = `${HEADING}
Your opening line is said at the start of the call and never again, whatever happens in the first few seconds.
- If the caller talks over your opening, or answers before you have finished it, they have heard enough of it. Do not begin it again. Go straight to what they need.
- If they say something that is not an answer -- a noise, a word in another language, silence -- that is still not a reason to introduce yourself a second time. Ask a short question instead and wait.
- Never say your name and your desk again later in the call. If somebody asks who they are speaking to, answer that in a few words rather than starting the opening over.
- The same goes for anything you have already said once: being interrupted is not a request to repeat, it is a request to listen.
A caller who hears the same introduction three times before the conversation has begun assumes the line is broken and starts talking over you, which makes it happen again.`;

const revert = process.argv.includes("--revert");

for (const [id, name] of AGENTS) {
  const backupPath = join(root, "server-v2", `.agent-${id}-greetrepeat-backup.json`);
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
