/**
 * Puts Priya into listen-only mode so a voice OTP can be captured, and puts her back.
 *
 *   node scripts/otp-listen-mode.mjs on     # before requesting the OTP
 *   node scripts/otp-listen-mode.mjs off    # immediately after
 *
 * Meta verifies a WhatsApp sender number by calling it and reading a six-digit code
 * aloud. This number is answered by a voice agent, so without this the code arrives
 * while Priya is greeting the caller and the digits are lost under her own speech.
 *
 * Listen-only means: she does not speak first, she has no greeting, she does not
 * backchannel, and she waits far longer than usual before deciding the line is dead.
 * The code then lands in the transcript, which the call.completed webhook writes into
 * the CRM.
 *
 * "off" restores from snapserve-setup/agent-717-backup.json rather than from values
 * hardcoded here, so it cannot drift away from what the agent actually was.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
for (const line of readFileSync(join(root, "snapserve-setup", ".env"), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const SNAP = process.env.SNAPSERVE_BASE_URL;
const H = { Authorization: `Bearer ${process.env.SNAPSERVE_API_KEY}`, "Content-Type": "application/json" };
const AGENT = 717;

const mode = process.argv[2];
if (mode !== "on" && mode !== "off") {
  console.error("usage: node scripts/otp-listen-mode.mjs on|off");
  process.exit(1);
}

const backup = JSON.parse(readFileSync(join(root, "snapserve-setup", "agent-717-backup.json"), "utf-8"));

const listenOnly = {
  firstSpeaker: "user",
  greetingMessage: "",
  backchannelingEnabled: false,
  silenceTimeoutSeconds: 120,
  // A recorded announcement pauses between repetitions of the code. Normal endpointing
  // would treat those pauses as the caller finishing and cut the recording short.
  systemPrompt:
    "You are a silent recording line. Do not speak. Do not greet. Do not respond to " +
    "anything you hear, no matter what is said or asked. Listen and stay completely " +
    "silent for the entire call. If you hear numbers, do nothing -- do not read them " +
    "back, do not confirm them, do not comment on them.",
};

const restore = {
  firstSpeaker: backup.firstSpeaker,
  greetingMessage: backup.greetingMessage,
  backchannelingEnabled: backup.backchannelingEnabled,
  silenceTimeoutSeconds: backup.silenceTimeoutSeconds,
  systemPrompt: backup.systemPrompt,
};

const body = mode === "on" ? listenOnly : restore;
const r = await fetch(`${SNAP}/agents/${AGENT}`, { method: "PATCH", headers: H, body: JSON.stringify(body) });
if (!r.ok) {
  console.error("PATCH failed", r.status, await r.text());
  process.exit(1);
}

const now = await fetch(`${SNAP}/agents/${AGENT}`, { headers: H }).then((x) => x.json());
const silent = now.firstSpeaker === "user" && !now.greetingMessage;
console.log(mode === "on" ? "\nPriya is now LISTEN-ONLY." : "\nPriya is back to normal.");
console.log("  firstSpeaker:", now.firstSpeaker);
console.log("  greeting:", now.greetingMessage ? `"${now.greetingMessage.slice(0, 45)}..."` : "(none)");
console.log("  backchannel:", now.backchannelingEnabled);
console.log("  silence timeout:", now.silenceTimeoutSeconds + "s");
console.log("  prompt:", now.systemPrompt.length, "chars");

if (mode === "on") {
  if (!silent) console.log("\n  WARNING: she may still speak -- check the dashboard before triggering the OTP.");
  console.log("\nNow request the voice-call verification in Meta. When it is done:");
  console.log("  node scripts/otp-listen-mode.mjs off");
} else if (silent) {
  console.log("\n  WARNING: restore did not take. Do not demo until firstSpeaker is 'assistant'.");
}
