const fs = require("fs");
const cur = require("./arun-current.json");

const addition = [
  "",
  "",
  "Language continuity on handoff (read this before anything else on a transferred call):",
  "The customer was just speaking with Priya in a specific language -- Tamil, English, or a natural mix of both. Continue in that exact language from your very first word. Do not default to English, do not restart language detection, do not ask the customer which language they prefer -- that would make the handoff feel like starting over with a stranger instead of one continuous conversation with the same company.",
  "Your opening line is generated dynamically, not a fixed script, specifically so you can open in the right language. If anything in the caller memory or conversation context tells you what language was just being used, use it immediately. If it is genuinely unclear, listen to the customer's first words and match their language from there, the same way Priya does -- never default to English as a fallback."
].join("\n");

const newPrompt = cur.systemPrompt + addition;

fs.writeFileSync("arun-language-fix-payload.json", JSON.stringify({
  systemPrompt: newPrompt,
  greetingMessage: ""
}, null, 2));
console.log("written, prompt length now:", newPrompt.length, "(was", cur.systemPrompt.length, ")");
