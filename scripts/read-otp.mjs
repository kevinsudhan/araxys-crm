/**
 * Pulls the six-digit code out of the most recent calls on the line.
 *
 *   node scripts/read-otp.mjs
 *
 * Meta reads the WhatsApp verification code aloud and the agent's ASR transcribes it.
 * The transcription is the weak link: spoken digits come back as words ("four two"),
 * spaced out ("4 2 8 1 9 0"), or occasionally as one run-on number. So rather than
 * matching one shape, this normalises the transcript and reports every six-digit
 * candidate it can find, newest call first, with the surrounding text so a wrong guess
 * is obvious at a glance.
 *
 * Codes expire in minutes, so it reads SnapServe directly instead of waiting for the
 * transcript to make its way into the CRM.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(__dirname, "..", "snapserve-setup", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const SNAP = process.env.SNAPSERVE_BASE_URL;
const H = { Authorization: `Bearer ${process.env.SNAPSERVE_API_KEY}` };

// Split by how much they can be confused with ordinary speech. "seven" is only ever a
// digit; "to", "for" and "won" are everyday words, and mapping them unconditionally turned
// "Can you provide me the details" into a six-digit code in testing.
const SAFE = { zero: "0", one: "1", three: "3", five: "5", six: "6", seven: "7", nine: "9", niner: "9" };
const RISKY = { oh: "0", o: "0", two: "2", to: "2", too: "2", four: "4", for: "4", fore: "4", eight: "8", ate: "8", won: "1", tree: "3" };

/**
 * Turns spoken digits into figures.
 *
 * Homophones are only accepted when they sit inside a run of digit-words, which is what a
 * code read aloud looks like and what a sentence does not.
 */
function digitise(text) {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const isDigit = (w) => /^\d+$/.test(w) || w in SAFE || w in RISKY;
  return words
    .map((w, i) => {
      if (/^\d+$/.test(w)) return w;
      if (w in SAFE) return SAFE[w];
      if (!(w in RISKY)) return w;
      const near = (words[i - 1] && isDigit(words[i - 1])) || (words[i + 1] && isDigit(words[i + 1]));
      return near ? RISKY[w] : w;
    })
    .join(" ");
}

/** Returns candidates strongest first: literal digits beat anything reconstructed. */
function candidates(transcript) {
  const strong = new Set();
  const weak = new Set();

  for (const m of transcript.matchAll(/\d{6}/g)) strong.add(m[0]);
  for (const m of transcript.matchAll(/(?:\d[\s-]*){6,}/g)) {
    const d = m[0].replace(/\D/g, "");
    for (let i = 0; i + 6 <= d.length; i++) strong.add(d.slice(i, i + 6));
  }

  const spoken = digitise(transcript);
  for (const m of spoken.matchAll(/(?:\d\s*){6,}/g)) {
    const d = m[0].replace(/\D/g, "");
    for (let i = 0; i + 6 <= d.length; i++) if (!strong.has(d.slice(i, i + 6))) weak.add(d.slice(i, i + 6));
  }
  return { strong: [...strong], weak: [...weak] };
}

const calls = await fetch(`${SNAP}/calls?limit=8`, { headers: H }).then((r) => r.json());
const list = Array.isArray(calls) ? calls : calls.calls ?? calls.data ?? [];

if (!list.length) {
  console.log("\nNo calls found yet. Trigger the verification call, wait ~30s, run again.");
  process.exit(0);
}

console.log("");
let any = false;
for (const c of list.slice(0, 6)) {
  const detail = await fetch(`${SNAP}/calls/${c.id}`, { headers: H }).then((r) => r.json());
  const t = detail.transcript ?? "";
  const when = detail.createdAt ?? c.createdAt ?? "";
  const age = when ? Math.round((Date.now() - new Date(when).getTime()) / 60000) : "?";

  if (!t) {
    console.log(`call ${c.id}  ${age}m ago  (no transcript yet)`);
    continue;
  }
  const { strong, weak } = candidates(t);
  console.log(`call ${c.id}  ${age}m ago  ${detail.durationSeconds ?? "?"}s`);
  if (strong.length) {
    any = true;
    console.log(`   CODE: ${strong.join("  ")}`);
  }
  if (weak.length) {
    any = true;
    console.log(`   maybe (reconstructed from spoken digits): ${weak.join("  ")}`);
  }
  console.log(`   transcript: ${t.replace(/\s+/g, " ").slice(0, 240)}`);
  console.log("");
}

if (!any) {
  console.log("No six-digit candidate found. The code may have been missed --");
  console.log("read the transcripts above yourself, or request a new call.");
}
