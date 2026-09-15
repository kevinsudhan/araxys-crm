/**
 * Ports the documentation-desk hardening onto Arun.
 *
 *   node supabase-v2/port-fixes-to-arun.mjs
 *   node supabase-v2/port-fixes-to-arun.mjs --revert
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MATTERS MORE FOR ARUN THAN FOR PRIYA
 *
 * What the desk gets wrong reaches a customer. What the documentation desk gets
 * wrong reaches a commercial invoice and a customs declaration with the
 * company's name on it.
 *
 * These four blocks exist because of call 19094, where the documentation agent:
 *   - read a mangled tax number back as ABCDE1234F, the specimen GSTIN off a
 *     form, as though it had been dictated
 *   - gave the consignee his own name, and supplied a locality the caller
 *     never said
 *   - took "about 20,000" and then "30,000" as the invoice value without once
 *     asking which
 *   - accepted India as the consignee country on an export leaving India
 *
 * Arun has been running the prompt that predates all of it. Nothing about his
 * tone, his language handling or his turn-taking is touched.
 * ---------------------------------------------------------------------------
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { apiKey } = JSON.parse(readFileSync(join(root, "server-v2/.snapserve.json"), "utf-8"));

const BASE = "https://app.snapserve.ai/api";
const H = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
const ARUN = 758;
const SOURCE = 1072; // Pranay, who carries the fixes

const PORT = [
  "AN EMAIL ADDRESS, IF THE DESK DID NOT GET ONE:",
  "NEVER INVENT A VALUE -- READ BACK ONLY WHAT YOU ACTUALLY HEARD:",
  "WHEN A NUMBER CHANGES, ASK WHICH ONE IS RIGHT:",
  "THE CONSIGNEE IS AT THE OTHER END, NOT IN INDIA:",
];

/**
 * The one rule neither documentation agent has, from call 21411 on the desk
 * side: a reply that is not language must not advance the call. It matters more
 * here, because these answers become declared values.
 */
const UNCLEAR_HEADING = "IF YOU DID NOT UNDERSTAND, SAY SO -- DO NOT CARRY ON:";

const UNCLEAR_BLOCK = `${UNCLEAR_HEADING}
Lines drop, the recogniser mangles things, and what reaches you is sometimes not language at all. Every answer you take here becomes a declared value on a document, so an answer you did not understand is worth nothing and must not be recorded.
- If a reply does not make sense as an answer to your question, do not treat it as a name, a number, an address or a yes. Say the line broke up and ask that ONE thing again.
- Never fill the gap yourself while waiting for a better answer. An unclear reply leaves the field empty, not guessed.
- Two attempts at the same field and no more. Then say plainly that you will confirm that one separately, note it as outstanding, and carry on with the rest.
- If most of the call is coming through badly, say so kindly and offer to call back on a better line. Half a set of shipping details is more useful than a full set that is partly invented.`;

const revert = process.argv.includes("--revert");
const backupPath = join(root, "server-v2", ".agent-758-portedfixes-backup.json");

const [arun, source] = await Promise.all([
  fetch(`${BASE}/agents/${ARUN}`, { headers: H }).then((r) => r.json()),
  fetch(`${BASE}/agents/${SOURCE}`, { headers: H }).then((r) => r.json()),
]);
const current = (arun.systemPrompt ?? "").replace(/\r/g, "");
const donor = (source.systemPrompt ?? "").replace(/\r/g, "");

const isHeading = (l) => /^[A-Z][A-Z0-9 ,'\-()\/&"]{8,}:?\s*$/.test(l.trim());

function block(prompt, heading) {
  const lines = prompt.split("\n");
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isHeading(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trimEnd();
}

let next;
if (revert) {
  if (!existsSync(backupPath)) {
    console.error("no backup to revert to");
    process.exit(1);
  }
  next = JSON.parse(readFileSync(backupPath, "utf-8")).systemPrompt;
} else {
  writeFileSync(backupPath, JSON.stringify({ systemPrompt: current }, null, 2));
  next = current;

  for (const heading of PORT) {
    if (next.includes(heading)) {
      console.log(`  already present: ${heading.slice(0, 46)}…`);
      continue;
    }
    const b = block(donor, heading);
    if (!b) {
      console.log(`  NOT FOUND in donor: ${heading.slice(0, 46)}…`);
      continue;
    }
    next = `${next.trimEnd()}\n\n${b}`;
    console.log(`  ported (${b.length} chars): ${heading.slice(0, 46)}…`);
  }

  if (!next.includes(UNCLEAR_HEADING)) {
    next = `${next.trimEnd()}\n\n${UNCLEAR_BLOCK}`;
    console.log("  added: did-not-understand");
  }
}

const r = await fetch(`${BASE}/agents/${ARUN}`, {
  method: "PATCH",
  headers: H,
  body: JSON.stringify({ systemPrompt: next }),
});
const p = (await fetch(`${BASE}/agents/${ARUN}`, { headers: H }).then((x) => x.json())).systemPrompt;

const has = (s) => (p.includes(s) ? "ok" : "FAIL");
console.log(
  `\n  Arun ${r.status}  ${current.length} -> ${p.length} chars\n` +
    `    never invent a value : ${has("NEVER INVENT A VALUE")}\n` +
    `    no specimen GSTIN    : ${has("ABCDE1234F")}\n` +
    `    changed number       : ${has("WHEN A NUMBER CHANGES")}\n` +
    `    consignee is abroad  : ${has("THE CONSIGNEE IS AT THE OTHER END")}\n` +
    `    email if desk missed : ${has("AN EMAIL ADDRESS, IF THE DESK DID NOT GET ONE")}\n` +
    `    say when unclear     : ${has(UNCLEAR_HEADING)}\n` +
    `    his voice kept       : ${has("ONE QUESTION AT A TIME")}\n` +
    `    no stray names       : ${/vaishnavi|pranay/i.test(p) ? "CHECK" : "ok"}`
);
