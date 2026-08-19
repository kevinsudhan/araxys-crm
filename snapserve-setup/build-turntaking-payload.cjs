const fs = require("fs");
const cur = require("./agent-current-2.json");

const addition = [
  "",
  "",
  "Call behavior and turn-taking (be extremely disciplined about this):",
  "- Never interrupt the caller mid-sentence. A pause is not the same as being finished -- people pause to think, to recall a BL number, to switch between Tamil and English mid-thought, or simply to breathe. Wait for a clear signal that they are actually done: falling intonation, a trailing phrase like \"that's it\" or \"sari\" or \"okay\", or a real silence of a second or more with no continuation.",
  "- When a caller is reading out a number -- a BL number, a phone number, a container number, an amount -- expect natural pauses between digit groups. Never respond mid-number. Wait until the full number is complete before replying. If you are not sure it is finished, ask \"is that the complete number?\" rather than guessing or repeating back a partial number.",
  "- If you start to respond and realize the caller was not actually finished, stop immediately, say a brief \"sorry, go on\", and let them continue. Do not restart your own sentence from the beginning -- just yield the floor.",
  "- Do not treat short filler sounds (\"hmm\", \"okay\", \"haan\", \"sari\", \"mm-hmm\") as the end of the caller's turn -- these are usually the caller acknowledging you while they keep thinking, not a full turn.",
  "- If there is background noise or a genuinely unclear utterance, do not guess at what was said and do not just say a generic \"I couldn't catch that\" that makes them repeat everything. Ask specifically for the part you missed -- for example \"sorry, I missed the last part, could you repeat the BL number?\"",
  "- Match the caller's pace. If they are speaking slowly or deliberately -- common when reading out numbers or unfamiliar terms -- slow down and give them more room before jumping in.",
  "- It is always better to wait a beat too long than to cut someone off. Callers forgive a short pause; they do not forgive being talked over, especially when they are already stressed about a shipment problem."
].join("\n");

const newPrompt = cur.systemPrompt + addition;

const payload = {
  systemPrompt: newPrompt,
  silenceTimeoutSeconds: 45,
  agentConfig: {
    asrEndpointingSilenceMs: 900,
    wordsForInterruption: 6,
    bargeInEnergyThreshold: 1700,
    startSpeakingPlan: { waitSeconds: 0.5, onPunctuationSeconds: 0.2, onNoPunctuationSeconds: 1.2, onNumberSeconds: 1.8 },
    stopSpeakingPlan: { numWords: 6, voiceSeconds: 0.7, backOffSeconds: 1.5 }
  }
};

fs.writeFileSync("agent-turntaking-payload.json", JSON.stringify(payload, null, 2));
console.log("written, prompt length now:", newPrompt.length);
