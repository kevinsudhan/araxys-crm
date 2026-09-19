/**
 * Three defects found by auditing the live agent config on 18 Sep 2026.
 *
 *   node scripts/fix-agent-config-drift.mjs          # apply
 *   node scripts/fix-agent-config-drift.mjs --revert # restore both agents
 *
 * 1. CROP INSURANCE ON A FREIGHT AGENT. Eleven of the twenty-five knowledge sources
 *    attached to Priya and Arun are the PMFBY crop-insurance knowledge base — scheme
 *    facts, evidence checklists, weather records, sum-insured tables, and "Farmer
 *    vocabulary, local units and crop names". Both agents carry all eleven.
 *
 *    A freight agent that can retrieve crop-insurance scheme facts will eventually
 *    retrieve them, and the caller hears it. Nothing in either prompt prevents it,
 *    because a prompt does not control what retrieval returns. Detaching is the fix;
 *    telling the agent not to look is not.
 *
 * 2. THE COMPANY HAS TWO NAMES — moved out to scripts/set-agent-brand.mjs, which sets
 *    the name in the prompt and the greeting together so they cannot drift apart. It
 *    lives in its own script because the answer has already changed once and will change
 *    again; this script is for faults with one correct fix, not for a decision.
 *
 * 3. SAILING DATES BAKED INTO THE PROMPT. Priya's unlisted-destination fallback names
 *    "12 September and 17 September" in the prompt text. Both are in the past as of
 *    today, so the fallback offers sailings that have already gone. The live board has
 *    current sailings (21 Sep onward, checked against /space/slots), so the dates were
 *    only ever wrong in the prompt.
 *
 *    Replacing them with newer dates would just restart the clock. The fix is to stop
 *    putting dates in the prompt at all and make her read them from the space knowledge,
 *    which is the one copy that gets updated. It also drops her under 6,000 characters.
 *
 * DELIBERATELY NOT CHANGED — both were considered:
 *
 *   asrKeyterms is null on both agents. Sarvam supports keyterm biasing and freight
 *   vocabulary (GSTIN, IEC, CBM, LCL, Nhava Sheva) is exactly what it helps with —
 *   misheard numbers have caused real damage on this account before. But the field's
 *   accepted shape is not documented anywhere I can check, and guessing it wrong on a
 *   live agent degrades recognition instead of improving it. That needs one test call
 *   to confirm, not a blind write the day of a demo.
 *
 *   Arun's dispositionSchema is empty while Priya's has thirteen fields. That looks
 *   like a gap and is not one: nothing reads dispositionSchema. Extraction happens in
 *   SHIPMATE, with Claude over the finished transcript. Filling it in would be work
 *   that changes no output.
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
if (!SNAP || !process.env.SNAPSERVE_API_KEY) {
  console.error("SNAPSERVE_BASE_URL and SNAPSERVE_API_KEY must be in snapserve-setup/.env");
  process.exit(1);
}
const H = {
  Authorization: `Bearer ${process.env.SNAPSERVE_API_KEY}`,
  "Content-Type": "application/json",
};

const REVERT = process.argv.includes("--revert");
const backupPath = (id) => join(root, "snapserve-setup", `agent-${id}-configdrift-backup.json`);

// The company name is NOT set here any more. scripts/set-agent-brand.mjs owns it.
//
// This script used to rewrite "Araxys Logistics" to "Aashish Logistics Global", which
// was right when it was written and is now backwards. Two scripts that both rewrite the
// same field is how a rename gets quietly undone by whoever runs the other one next —
// so this one no longer touches it at all.

/** The dated sentence, and the one that reads the date from the knowledge instead. */
const DATED =
  'Use the "Destinations not listed above — provisional sailings" entry in your space knowledge, which gives provisional sailings on 12 September and 17 September.';
const UNDATED =
  "Use the provisional sailings in your space knowledge for unlisted destinations. Read those dates from the knowledge, never from memory.";

/**
 * The crop-insurance knowledge base. Listed by id AND by name so the script fails loudly
 * if an id has been reused for something else since the audit, rather than quietly
 * detaching a freight source that happens to share a number.
 */
const PMFBY = {
  6808: "PMFBY 01 - What the scheme covers",
  6809: "PMFBY 02 - What the scheme does not cover",
  6810: "PMFBY 03 - Reporting a loss and the time limits",
  6811: "PMFBY 04 - Evidence the farmer should keep ready",
  6812: "PMFBY 05 - How to answer money, approval and timing questions",
  6813: "PMFBY 06 - Farmer vocabulary, local units and crop names",
  6821: "scheme_facts.txt",
  6822: "evidence_checklists.txt",
  6823: "safe_scripts.txt",
  6824: "weather_record.txt",
  6825: "sum_insured_simulated.txt",
};

const get = async (id) => {
  const r = await fetch(`${SNAP}/agents/${id}`, { headers: H });
  if (!r.ok) throw new Error(`GET agent ${id}: HTTP ${r.status}`);
  return r.json();
};

const patch = async (id, body) => {
  const r = await fetch(`${SNAP}/agents/${id}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PATCH agent ${id}: HTTP ${r.status} ${await r.text()}`);
  return r.json();
};

if (REVERT) {
  for (const id of [717, 758]) {
    const p = backupPath(id);
    if (!existsSync(p)) {
      console.log(`${id}: no backup at ${p} — nothing to revert`);
      continue;
    }
    const b = JSON.parse(readFileSync(p, "utf-8"));
    await patch(id, {
      systemPrompt: b.systemPrompt,
      greetingMessage: b.greetingMessage,
      knowledgeSourceIds: b.knowledgeSourceIds,
    });
    console.log(`${id} ${b.name}: restored (${b.systemPrompt.length} chars, ${b.knowledgeSourceIds.length} sources)`);
  }
  process.exit(0);
}

// Verify the crop-insurance ids still mean what they meant at audit time.
const srcRes = await fetch(`${SNAP}/knowledge-sources`, { headers: H });
if (!srcRes.ok) throw new Error(`GET knowledge-sources: HTTP ${srcRes.status}`);
const srcJson = await srcRes.json();
const sources = Array.isArray(srcJson) ? srcJson : srcJson.sources ?? srcJson.data ?? [];
const nameOf = Object.fromEntries(sources.map((s) => [Number(s.id), s.name ?? s.title ?? ""]));

for (const [id, expected] of Object.entries(PMFBY)) {
  const actual = nameOf[Number(id)];
  if (actual === undefined) continue; // already gone; detaching is still correct
  if (actual !== expected) {
    console.error(`REFUSING: source ${id} is now "${actual}", expected "${expected}".`);
    console.error("An id was reused. Re-audit before running this.");
    process.exit(1);
  }
}

for (const id of [717, 758]) {
  const live = await get(id);

  if (!existsSync(backupPath(id))) {
    writeFileSync(backupPath(id), JSON.stringify(live, null, 2), "utf-8");
    console.log(`${id}: backed up to ${backupPath(id)}`);
  }

  let prompt = live.systemPrompt ?? "";
  const before = prompt.length;

  // 3 — dated fallback, Priya only (Arun has no sailing text)
  if (prompt.includes(DATED)) prompt = prompt.replace(DATED, UNDATED);

  // 2 — one company name
  const greeting = live.greetingMessage ?? "";

  // 1 — drop the crop-insurance knowledge base
  const attached = (live.knowledgeSourceIds ?? []).map(Number);
  const kept = attached.filter((x) => !(x in PMFBY));
  const dropped = attached.filter((x) => x in PMFBY);

  await patch(id, {
    systemPrompt: prompt,
    greetingMessage: greeting,
    knowledgeSourceIds: kept,
  });

  const after = await get(id);
  const ok =
    after.systemPrompt === prompt &&
    after.greetingMessage === greeting &&
    (after.knowledgeSourceIds ?? []).length === kept.length;

  console.log(`\n${id} ${live.name}:`);
  console.log(`  prompt        ${before} -> ${after.systemPrompt.length} chars ${after.systemPrompt.length <= 6000 ? "(within 6000)" : "*** STILL OVER 6000 ***"}`);
  console.log(`  dated sailing ${after.systemPrompt.includes("12 September") ? "*** still dated ***" : "reads from knowledge"}`);
  console.log(`  sources       ${attached.length} -> ${(after.knowledgeSourceIds ?? []).length} (dropped ${dropped.length} crop-insurance)`);
  console.log(`  readback      ${ok ? "matches" : "*** MISMATCH — check the dashboard ***"}`);
  console.log(`  greeting      ${JSON.stringify(after.greetingMessage)}`);
}
