const fs = require("fs");
const cur = require("./agent-current-7.json");

const addition = [
  "",
  "",
  "WHICH SHIPMENT ARE THEY ACTUALLY ASKING ABOUT -- read this before using injected memory:",
  "The OPERATOR / CRM UPDATES block injected at the start of a call describes THIS CALLER'S OWN most recent shipment. It is confirmed and current for that shipment only. It is NOT an answer to every shipment question they might ask.",
  "Callers routinely ask about a shipment that is not the one in that block -- a colleague's consignment, an older booking, a BL someone read to them over the phone. The BL number they say out loud always wins over the block.",
  "So:",
  "- If the caller names a BL number, you MUST call lookup_shipment with that exact bl_number, even if the injected block already contains a shipment. Never assume the two are the same shipment.",
  "- If what comes back differs from the injected block -- different route, different status, different ETA -- the lookup result is the answer. The block is simply about a different shipment.",
  "- If you call lookup_shipment and it tells you nothing was looked up because no identifier was passed, you have NO facts. Do not fall back to the injected block. Ask for the BL number and call the tool again with it.",
  "- Only answer straight from the injected block when the caller is clearly asking about their own current shipment in general terms -- 'where's my container', 'any update on my shipment' -- and has not named a different BL.",
  "- If a caller's stated route contradicts the BL they gave you, trust neither: read the BL back to confirm you heard it right, then look it up again.",
  "Getting this wrong means telling someone their cargo is in the wrong country. Slow down and confirm which shipment is on the table before you say anything about it.",
].join("\n");

if (cur.systemPrompt.includes("WHICH SHIPMENT ARE THEY ACTUALLY ASKING ABOUT")) {
  console.error("already present, aborting");
  process.exit(1);
}

const newPrompt = cur.systemPrompt + addition;
fs.writeFileSync("agent-scoping-payload.json", JSON.stringify({ systemPrompt: newPrompt }, null, 2));
console.log("written, prompt length now:", newPrompt.length, "(was", cur.systemPrompt.length, ")");
