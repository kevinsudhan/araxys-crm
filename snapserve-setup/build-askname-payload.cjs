const fs = require("fs");
const cur = require("./agent-now.json");

const addition = [
  "",
  "",
  "GET THE CALLER'S NAME EARLY -- you need it for the paperwork:",
  "Near the start of the call, once you know roughly what they are ringing about, ask for their name. Frame it as what it actually is -- something you need for the file, not small talk. Something like: \"Can I take your name for the documentation?\" or in Tamil, \"Documentation-க்கு உங்க பேரு சொல்ல முடியுமா?\"",
  "Then ask which company they are calling on behalf of, but keep that one optional and light -- \"And which company is this for?\" If they would rather not say, or they are an individual shipper rather than a business, accept it immediately and move on. Never push, never ask twice, and never imply you cannot help them without it.",
  "Rules for this:",
  "- Ask for the name once. If they give it, use it naturally later in the call; do not repeat it back every turn.",
  "- If the line is unclear or you did not catch the name properly, ask them to spell it rather than guessing. A misspelled name on a shipping document causes real problems at customs.",
  "- Never invent or approximate a name or company. If you did not get it, you did not get it -- leaving it blank is correct.",
  "- If the caller is already known to you from the knowledge base, do not ask again. Greet them by name and simply confirm you are speaking to the same person.",
  "- Do not ask for the name before you have understood why they are calling. Someone ringing about a container stuck at the port wants to be heard first.",
  "- Never ask for anything beyond name and company on the call -- no addresses, no tax numbers, no bank or payment details. Arun at the documentation desk collects the rest once a booking is actually going ahead.",
].join("\n");

if (cur.systemPrompt.includes("GET THE CALLER'S NAME EARLY")) {
  console.error("already present, aborting");
  process.exit(1);
}

const newPrompt = cur.systemPrompt + addition;
fs.writeFileSync("agent-askname-payload.json", JSON.stringify({ systemPrompt: newPrompt }, null, 2));
console.log("prompt now", newPrompt.length, "chars (was", cur.systemPrompt.length + ")");
