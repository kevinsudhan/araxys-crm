/**
 * The doc had drifted behind the live agent -- it was missing the anti-fabrication rule
 * and the whole space-availability section, and still described a tool that was deleted.
 * A prompt doc that disagrees with the agent is worse than no doc, so regenerate the
 * paste-able section verbatim from live and keep the team's annotations beside it.
 */
import { readFileSync, writeFileSync } from "node:fs";

for (const line of readFileSync("snapserve-setup/.env", "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const live = (await fetch(`${process.env.SNAPSERVE_BASE_URL}/agents/717`, {
  headers: { Authorization: `Bearer ${process.env.SNAPSERVE_API_KEY}` },
}).then((r) => r.json())).systemPrompt.replace(/\r/g, "").trim();

const doc = readFileSync("snapserve-setup/system-prompt-priya.md", "utf-8").replace(/\r/g, "");
const branchesAt = doc.indexOf("## Call branches");
if (branchesAt === -1) throw new Error("call branches section missing");
const branches = doc.slice(branchesAt);

const header = `# System prompt — Priya (forwarder-rep agent)

The "Persona & rules" section below is the live system prompt on agent 717, reproduced
verbatim — regenerate it with \`node scripts/sync-prompt-doc.mjs\` rather than editing it by
hand, so the doc can never quietly disagree with the agent. The notes after it explain the
parts of the behaviour that the prompt text alone does not control. "Call branches" at the
end is the team's rehearsal script.

---

## Persona & rules (live on agent 717 — do not edit here)

`;

const notes = `

---

## Notes — what the prompt text alone does not control

**Turn-taking is config, not prose.** \`silenceTimeoutSeconds: 45\`, \`asrEndpointingSilenceMs: 900\`,
\`wordsForInterruption: 6\`, \`bargeInEnergyThreshold: 1700\`,
\`startSpeakingPlan: {waitSeconds: 0.5, onPunctuationSeconds: 0.2, onNoPunctuationSeconds: 1.2, onNumberSeconds: 1.8}\`,
\`stopSpeakingPlan: {numWords: 6, voiceSeconds: 0.7, backOffSeconds: 1.5}\`. The prompt won't fix a
cutoff problem — the VAD/endpointing timing controls it; the prompt only governs how Priya
*recovers* when a cutoff still happens.

**Caller recognition is caller memory.** \`syncCallerMemory()\` writes each customer's own details
into SnapServe caller memory keyed by their phone number, and re-runs whenever a call updates a
record. SnapServe matches the calling number and injects it before the agent speaks. The knowledge
base is the separate, searchable copy of *every* customer; caller memory is only ever about the
person currently on the line.

**Why asking for a name matters downstream.** Customer records are built after the call by
extracting from the transcript, so a name that is never spoken can never be captured. Asking for it
is what turns "Unnamed caller" in the CRM into an actual contact.

**Space availability is retrieval, not a tool.** Webhook tool *results* were verified not to reach
the model on this Gemini Live stack — the agent would call the tool and then answer from
imagination. So \`buildSpaceKb()\` pre-computes what a text document cannot derive (the largest
single piece each sailing can still take, and how many of several common carton sizes fit, both
binary-searched against the real 3D \`checkFit\` engine) and \`syncSpaceKb()\` publishes it as a
knowledge source. It refreshes after every booking and on every ingest run. The agent has **no
webhook tools at all** — only \`end_call\`.

**Handoff to Arun needs one dashboard step.** Squad 15 ("Chennai desk squad") exists with Priya
(717) and Arun (758) as members, both \`handoffEnabled\`. But the inbound number is still bound
directly to agent 717, not to the squad — \`connections.phoneNumbers\` on the squad is empty — so
handoff cannot fire on a real call yet. Connecting the number to the squad in the dashboard is the
remaining step; Squads has no public API for it.

---

`;

writeFileSync("snapserve-setup/system-prompt-priya.md", header + live + notes + branches, "utf-8");
console.log("doc regenerated:", (header + live + notes + branches).length, "chars");
