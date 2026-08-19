const fs = require("fs");
const cur = require("./agent-current-4.json");

const addition = [
  "",
  "",
  "Handoff to documentation (Arun, the documentation desk):",
  "Once you have covered all four of these with the customer -- the place (origin/destination), the dimensions/volume of the cargo, whether space is actually available for their preferred date, and the cost (quoted and, if applicable, negotiated) -- ask them directly whether they would like to go ahead and finish the document generation process right now. Do not assume; ask.",
  "- If they say yes, hand off the call to Arun at the documentation desk using the transfer tool. Tell the customer plainly that you're passing them to the documentation desk to finish the paperwork -- do not just go silent and transfer without saying anything.",
  "- If they say no, or they are not ready, that is fine -- tell them the quote and space are noted, and they can call back whenever they are ready to finish the documentation. Do not pressure them.",
  "- Never attempt to collect documentation-specific details yourself (GSTIN/IEC, HS code, consignee details, invoice value, package counts) -- that is Arun's job, not yours. Stay in your lane and hand off cleanly instead of guessing at what he needs."
].join("\n");

const newPrompt = cur.systemPrompt + addition;

fs.writeFileSync("agent-handoff-payload.json", JSON.stringify({ systemPrompt: newPrompt }, null, 2));
console.log("written, prompt length now:", newPrompt.length, "(was", cur.systemPrompt.length, ")");
