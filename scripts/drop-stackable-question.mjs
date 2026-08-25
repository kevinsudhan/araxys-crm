/**
 * Stops Priya asking whether cargo can be stacked.
 *
 *   node scripts/drop-stackable-question.mjs          # apply
 *   node scripts/drop-stackable-question.mjs --revert # restore
 *
 * It is one more question on a call that already has plenty, and most callers do not have
 * a considered answer to it -- they say yes because it sounds agreeable, which is worse
 * than not asking.
 *
 * The field is not removed from the extractor. If a customer volunteers it ("these can't
 * be stacked", "it's fragile"), that still gets captured and still reaches the fit engine.
 * Only the question goes.
 *
 * WHAT THIS COSTS, measured on the live board: twelve pieces of 120x100x110 load as 2
 * across by 2 high taking 3.6m of floor when stacking is allowed, and 2 across by 1 high
 * taking 6.0m when it is not. Unstated stackability is treated as not stackable -- that
 * default is deliberate, since planning a container around a stack that cannot legally
 * exist is the failure that strands cargo at a port -- so allocations will now reserve
 * roughly two thirds more floor than they did. Quotes stay the same; it is the space
 * booked against the sailing that grows.
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

const backupPath = join(root, "snapserve-setup", "agent-717-stackable-backup.json");

const OLD = "- whether the pieces can be stacked on top of each other, and whether the cargo has to stay upright";

const NEW =
  "(Do NOT ask whether the cargo can be stacked or has to stay upright. It is one more question on a call that has enough of them, and most callers agree to stacking without having thought about it, which is worse than not asking. If they raise it themselves -- \"these can't go on top of each other\", \"it's fragile\", \"this way up\" -- note it and use it. Otherwise leave it and the desk plans without stacking.)";

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
  if (current.includes("Do NOT ask whether the cargo can be stacked")) {
    console.log("  Priya: already applied");
    process.exit(0);
  }
  if (!current.includes(OLD)) {
    console.error("  the line being replaced is not in the live prompt — stopping rather than guessing");
    process.exit(1);
  }
  writeFileSync(backupPath, JSON.stringify({ systemPrompt: current }, null, 2));
  next = current.replace(OLD, NEW);
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
    `\n    old "can they be stacked" line: ${after.includes(OLD) ? "STILL THERE" : "gone"}` +
    `\n    do-not-ask instruction        : ${after.includes("Do NOT ask whether the cargo can be stacked") ? "present" : "MISSING"}`,
);
