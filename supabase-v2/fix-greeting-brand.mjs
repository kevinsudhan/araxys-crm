/**
 * Puts the customer-facing name right.
 *
 *   node supabase-v2/fix-greeting-brand.mjs
 *   node supabase-v2/fix-greeting-brand.mjs --revert
 *
 * Araxys is the software. The freight forwarder is Aashish Logistics Global,
 * and that is who the caller has rung -- so it is the only name that should
 * reach them. It appears in three places a customer can hear:
 *   - Vaishnavi's greeting ("the Araxys forwarder desk")
 *   - Pranay's greeting ("the Araxys documentation desk")
 *   - Pranay's prompt, where he is told to say documents are generated "under
 *     Araxys Logistics" -- which would put the wrong company on the paperwork
 *     in the customer's mind.
 *
 * NOT changed: the "Araxys ... customer records" knowledge source and the line
 * in Vaishnavi's prompt that names it. That is an internal document title used
 * to find the source, never spoken to a caller, and renaming it risks the
 * lookup for no customer-visible gain.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { apiKey } = JSON.parse(readFileSync(join(root, "server-v2/.snapserve.json"), "utf-8"));

const BASE = "https://app.snapserve.ai/api";
const H = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

const COMPANY = "Aashish Logistics Global";

const CHANGES = {
  1071: {
    name: "Vaishnavi",
    greeting: `Hi, this is Vaishnavi from the forwarder desk at ${COMPANY}. How can I help you today?`,
    prompt: [],
  },
  1072: {
    name: "Pranay",
    greeting:
      `Hi, this is Pranay from the documentation desk at ${COMPANY}. Vaishnavi's passed me ` +
      `your shipment -- I just need a few more details to get your documents generated.`,
    prompt: [
      ["from the documentation desk at Araxys Logistics", `from the documentation desk at ${COMPANY}`],
      ["will now be generated under Araxys Logistics", `will now be generated under ${COMPANY}`],
    ],
  },
};

const revert = process.argv.includes("--revert");

for (const [id, change] of Object.entries(CHANGES)) {
  const backupPath = join(root, "server-v2", `.agent-${id}-brand-backup.json`);
  const live = await fetch(`${BASE}/agents/${id}`, { headers: H }).then((r) => r.json());
  const currentPrompt = (live.systemPrompt ?? "").replace(/\r/g, "");
  const currentGreeting = live.greetingMessage ?? "";

  let body;
  if (revert) {
    if (!existsSync(backupPath)) {
      console.log(`  ${change.name}: no backup, skipped`);
      continue;
    }
    body = JSON.parse(readFileSync(backupPath, "utf-8"));
  } else {
    writeFileSync(
      backupPath,
      JSON.stringify({ greetingMessage: currentGreeting, systemPrompt: currentPrompt }, null, 2)
    );

    let prompt = currentPrompt;
    for (const [from, to] of change.prompt) {
      if (prompt.includes(from)) prompt = prompt.split(from).join(to);
      else console.log(`  ${change.name}: WARNING -- not found: "${from.slice(0, 40)}…"`);
    }
    body = { greetingMessage: change.greeting, systemPrompt: prompt };
  }

  const r = await fetch(`${BASE}/agents/${id}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify(body),
  });
  const after = await fetch(`${BASE}/agents/${id}`, { headers: H }).then((x) => x.json());
  const spoken = /Araxys/.test(after.greetingMessage ?? "") || /Araxys Logistics/.test(after.systemPrompt ?? "");

  console.log(`  ${change.name.padEnd(10)} ${r.status}  spoken-brand: ${spoken ? "STILL WRONG" : "clean"}`);
  console.log(`    greeting: ${after.greetingMessage}`);
}
