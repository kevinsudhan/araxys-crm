/**
 * Two fixes from call 18367, where taking an email address collapsed.
 *
 *   node supabase-v2/fix-vaishnavi-glitches.mjs
 *   node supabase-v2/fix-vaishnavi-glitches.mjs --revert
 *
 * ---------------------------------------------------------------------------
 * WHAT WENT WRONG
 *
 * 1. THE TUNING. Vaishnavi was set far more aggressively than Priya, who has
 *    139 calls behind her settings. The decisive one is onNumberSeconds: Priya
 *    waits 1.8 seconds when a caller is reading out digits; Vaishnavi waited
 *    zero and spoke over them. Add a 250ms endpointing silence against Priya's
 *    500, a barge-in threshold of 1200 against 1700, and denoising switched
 *    off, and an address spelled over a phone line had no chance.
 *
 * 2. THE CORRECTION WAS NOT HELD. The caller said "no, it is Kevin Sudhan,
 *    s-u-d-h-a-n" and she repeated it back correctly -- then a garbled fragment
 *    arrived and she rebuilt the address from that, losing the name and reading
 *    back "31@gmail.com". She was reconstructing the value from the most recent
 *    audio rather than keeping the corrected one and treating later noise as
 *    noise.
 *
 * The prompt fix is not "try harder to hear". It is: hold what you were told,
 * stop spelling things back, and give up gracefully after two attempts instead
 * of looping until the caller hangs up.
 * ---------------------------------------------------------------------------
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { apiKey } = JSON.parse(readFileSync(join(root, "server-v2/.snapserve.json"), "utf-8"));

const BASE = "https://app.snapserve.ai/api";
const H = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

const VAISHNAVI = 1071;
const PRIYA = 717;
const backupPath = join(root, "server-v2", ".vaishnavi-glitch-backup.json");

const HEADING = "WHEN SOMEBODY CORRECTS YOU, THE CORRECTION WINS:";

const BLOCK = `${HEADING}
The moment a caller corrects a detail, their correction replaces what you had. It is now the value. Anything you hear afterwards that contradicts it is noise on the line, not a second correction.
- Never revert to an earlier version of something after being corrected. If you had "Chilton" and they said "Sudhan", it is Sudhan, and it stays Sudhan even if the next thing you hear is garbled.
- If what arrives next is unintelligible, say "sorry, the line broke up there" and ask about that ONE thing again. Do not rebuild the whole answer from the fragment.
- Never read back a value you are no longer confident about. Saying "31@gmail.com" when you have lost the name in front of it tells the caller you were not listening.

TAKING AN EMAIL ADDRESS OR A NUMBER -- TWO ATTEMPTS, THEN STOP:
- Ask once, plainly. Let them finish. People read addresses slowly and stop between the name and the domain; that pause is not your turn.
- Read it back ONCE, as a normal word: "kevinsudhan31 at gmail dot com, is that right?" Do not spell it out letter by letter. Spelling is slower, it garbles over a phone line, and it invites another round of the same.
- Only spell if they ask you to, and then spell it once.
- If it is still not right after TWO attempts, stop. Say: "let's not keep going round on this -- I'll take the rest of the details and confirm the address with you another way." Then move on and leave a note for the desk.
Looping on the same field is how a call gets abandoned. Three failed attempts is worse than not having the address at all.`;

const revert = process.argv.includes("--revert");

const [live, priya] = await Promise.all(
  [VAISHNAVI, PRIYA].map((id) => fetch(`${BASE}/agents/${id}`, { headers: H }).then((r) => r.json()))
);

const current = (live.systemPrompt ?? "").replace(/\r/g, "");

if (revert) {
  if (!existsSync(backupPath)) {
    console.error("no backup to revert to");
    process.exit(1);
  }
  const saved = JSON.parse(readFileSync(backupPath, "utf-8"));
  const r = await fetch(`${BASE}/agents/${VAISHNAVI}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ systemPrompt: saved.systemPrompt, agentConfig: saved.agentConfig }),
  });
  console.log(`reverted -> ${r.status}`);
  process.exit(0);
}

writeFileSync(
  backupPath,
  JSON.stringify({ systemPrompt: current, agentConfig: live.agentConfig }, null, 2)
);

/**
 * Priya's conversational tuning, kept and applied.
 *
 * Her language and calendar settings are hers -- those stay Vaishnavi's own.
 * What is copied is only the timing: when to start speaking, when to stop, how
 * long to wait on digits, and how much noise counts as an interruption. Those
 * are the numbers that have survived 139 real calls.
 */
const p = priya.agentConfig ?? {};
const v = live.agentConfig ?? {};

const tuned = {
  ...v,
  asrEndpointingSilenceMs: p.asrEndpointingSilenceMs,
  bargeInEnergyThreshold: p.bargeInEnergyThreshold,
  wordsForInterruption: p.wordsForInterruption,
  startSpeakingPlan: p.startSpeakingPlan,
  stopSpeakingPlan: p.stopSpeakingPlan,
  micSensitivity: p.micSensitivity,
  sarvamHighVadSensitivity: p.sarvamHighVadSensitivity,
  sarvamEndOfSpeechSilenceMs: p.sarvamEndOfSpeechSilenceMs,
  sarvamFirstTurnMinSpeechMs: p.sarvamFirstTurnMinSpeechMs,
  sarvamVadThreshold: p.sarvamVadThreshold,
  // Vaishnavi's own: the languages you enabled, and her own calendar.
  multilingualLanguages: v.multilingualLanguages,
  secondaryLanguages: v.secondaryLanguages,
  languageAutoDetect: v.languageAutoDetect,
  isMultilingual: v.isMultilingual,
  autoSwitchToEnglish: v.autoSwitchToEnglish,
  calendarCapability: v.calendarCapability,
};

const alreadyPrompted = current.includes(HEADING);
const nextPrompt = alreadyPrompted ? current : `${current.trim()}\n\n${BLOCK}`;

const r = await fetch(`${BASE}/agents/${VAISHNAVI}`, {
  method: "PATCH",
  headers: H,
  body: JSON.stringify({
    systemPrompt: nextPrompt,
    agentConfig: tuned,
    asrLanguage: priya.asrLanguage,
    asrBackgroundDenoising: true,
    asrAutoFallback: true,
    silenceTimeoutSeconds: priya.silenceTimeoutSeconds,
    status: "active",
  }),
});

if (!r.ok) {
  console.error(`PATCH failed ${r.status} ${(await r.text()).slice(0, 300)}`);
  process.exit(1);
}

const after = await fetch(`${BASE}/agents/${VAISHNAVI}`, { headers: H }).then((x) => x.json());
const ac = after.agentConfig ?? {};

console.log(`Vaishnavi (${VAISHNAVI})`);
console.log(`  prompt          : ${current.length} -> ${after.systemPrompt.length} chars`);
console.log(`  correction rule : ${after.systemPrompt.includes(HEADING) ? "present" : "MISSING"}`);
console.log(`  two-attempt rule: ${after.systemPrompt.includes("TWO ATTEMPTS") ? "present" : "MISSING"}`);
console.log(`  pause on digits : ${ac.startSpeakingPlan?.onNumberSeconds}s (was 0)`);
console.log(`  endpointing     : ${ac.asrEndpointingSilenceMs}ms`);
console.log(`  barge-in        : ${ac.bargeInEnergyThreshold}`);
console.log(`  denoising       : ${after.asrBackgroundDenoising}`);
console.log(`  asr language    : ${after.asrLanguage}`);
console.log(`  status          : ${after.status}`);
console.log(`  languages kept  : ${JSON.stringify(ac.multilingualLanguages)}`);
