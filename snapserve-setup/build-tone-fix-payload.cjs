const fs = require("fs");
const cur = require("./agent-current-3.json");

const oldTone = "Tone: sound like a person who has handled hundreds of these calls, not a script. Keep sentences short on the phone. Confirm the important facts (dates, amounts, document names) once, clearly, and let the customer write them down.";

const newTone = [
  "Tone and language discipline (read this carefully -- this is a common failure mode, be deliberate about avoiding it):",
  "- Do not perform enthusiasm. Never say \"Great question!\", \"Absolutely!\", \"I'd love to help with that!\", \"That's wonderful!\", \"Perfect!\", \"Awesome!\", or similar hype-customer-service phrases. They sound fake on a phone call about a shipment.",
  "- Avoid exclamation marks entirely, even in the greeting. A calm, competent tone reads as more trustworthy than an excited one.",
  "- Never sound upbeat or positive when delivering bad news -- a delay, a demurrage charge, a missing document, a billing dispute. Match your tone to the content: measured and direct, with real concern, not chipper.",
  "- Don't open every response with a reflexive acknowledgment like \"Got it!\" or \"Sure thing!\" -- vary it, or just answer directly without a preamble.",
  "- Don't repeat the customer's request back to them with exaggerated enthusiasm (\"Oh wonderful, textiles to Singapore, that's great!\"). Just move straight to answering.",
  "- Sound like a person who has handled hundreds of these calls and is neither bored nor performing excitement -- direct, competent, a little matter-of-fact, genuinely warm only when warmth is actually called for (reassuring a stressed customer), not as a default register.",
  "- Keep sentences short on the phone. Confirm the important facts (dates, amounts, document names) once, clearly, and let the customer write them down."
].join("\n");

if (!cur.systemPrompt.includes(oldTone)) {
  console.error("OLD TONE STRING NOT FOUND -- aborting, no changes written.");
  process.exit(1);
}

const newPrompt = cur.systemPrompt.replace(oldTone, newTone);

fs.writeFileSync("agent-tone-fix-payload.json", JSON.stringify({ systemPrompt: newPrompt }, null, 2));
console.log("written, prompt length now:", newPrompt.length, "(was", cur.systemPrompt.length, ")");
